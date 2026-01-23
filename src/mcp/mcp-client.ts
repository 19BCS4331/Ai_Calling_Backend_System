/**
 * MCP (Model Context Protocol) Client
 * Connects to external MCP servers (like n8n) to discover and execute tools dynamically
 * 
 * Uses the official @modelcontextprotocol/sdk for proper protocol handling
 */

import { EventEmitter } from 'events';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import {
  ToolDefinition,
  RegisteredTool,
  Logger
} from '../types';
import { ToolRegistry } from '../tools/tool-registry';

export type MCPTransportType = 'stdio' | 'sse' | 'websocket' | 'http';

export interface MCPClientConfig {
  name: string;
  transport: MCPTransportType;
  // For stdio transport
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  // For HTTP/SSE/WebSocket transport
  url?: string;
  apiKey?: string;
  // General options
  timeout?: number;
  reconnect?: boolean;
  reconnectInterval?: number;
  // Tool configurations for filtering and renaming
  toolConfigs?: Array<{
    mcp_function_name: string;
    enabled: boolean;
    custom_name?: string;
  }>;
}

interface MCPToolInfo {
  name: string;
  description?: string;
  inputSchema?: {
    type: string;
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

/**
 * MCP Client using official SDK
 * Manages connection to an external MCP server and registers discovered tools
 */
export class MCPClient extends EventEmitter {
  private config: MCPClientConfig;
  private toolRegistry: ToolRegistry;
  private logger: Logger;
  private client: Client | null = null;
  private transport: StreamableHTTPClientTransport | SSEClientTransport | null = null;
  private isConnected: boolean = false;
  private discoveredTools: MCPToolInfo[] = [];

  constructor(config: MCPClientConfig, toolRegistry: ToolRegistry, logger: Logger) {
    super();
    this.config = {
      timeout: 30000,
      reconnect: true,
      reconnectInterval: 5000,
      ...config
    };
    this.toolRegistry = toolRegistry;
    this.logger = logger.child({ component: 'mcp-client', server: config.name });
  }

  /**
   * Connect to the MCP server
   */
  async connect(): Promise<void> {
    this.logger.info('Connecting to MCP server', { 
      name: this.config.name, 
      transport: this.config.transport,
      url: this.config.url
    });

    if (!this.config.url) {
      throw new Error('URL is required for MCP connection');
    }

    try {
      const url = new URL(this.config.url);
      
      // Create headers with required Accept headers for MCP/SSE
      const headers: Record<string, string> = {
        'Accept': 'application/json, text/event-stream'
      };
      
      if (this.config.apiKey) {
        headers['Authorization'] = `Bearer ${this.config.apiKey}`;
      }

      // Create transport based on config
      if (this.config.transport === 'sse') {
        this.logger.info('Using SSE transport');
        this.transport = new SSEClientTransport(url, {
          requestInit: { headers }
        });
      } else {
        // Default to Streamable HTTP transport
        this.logger.info('Using Streamable HTTP transport');
        this.transport = new StreamableHTTPClientTransport(url, {
          requestInit: { headers }
        });
      }

      // Create MCP client
      this.client = new Client({
        name: 'voice-agent-mcp-client',
        version: '1.0.0'
      });

      // Connect to the server with timeout
      this.logger.info('Initializing MCP connection...');
      
      const connectionTimeout = this.config.timeout || 30000;
      const connectPromise = this.client.connect(this.transport);
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error(`MCP connection timeout after ${connectionTimeout}ms`)), connectionTimeout)
      );
      
      await Promise.race([connectPromise, timeoutPromise]);
      
      this.isConnected = true;
      this.logger.info('MCP connection established');

      // Discover available tools
      await this.discoverTools();
      
      this.emit('connected');
    } catch (error) {
      this.logger.error('Failed to connect to MCP server', { error: (error as Error).message });
      throw error;
    }
  }

  /**
   * Disconnect from the MCP server
   */
  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
    }
    if (this.transport) {
      await this.transport.close();
      this.transport = null;
    }
    this.isConnected = false;
    this.discoveredTools = [];
    this.emit('disconnected');
    this.logger.info('Disconnected from MCP server');
  }

  /**
   * Discover tools from the MCP server
   */
  private async discoverTools(): Promise<void> {
    if (!this.client) {
      throw new Error('Client not connected');
    }

    this.logger.info('Discovering tools from MCP server');

    try {
      const result = await this.client.listTools();
      const tools = result.tools || [];
      
      this.logger.info('Discovered tools', { count: tools.length });

      this.discoveredTools = [];
      
      for (const mcpTool of tools) {
        this.discoveredTools.push({
          name: mcpTool.name,
          description: mcpTool.description,
          inputSchema: mcpTool.inputSchema as MCPToolInfo['inputSchema']
        });

        // Register the tool in the tool registry
        await this.registerToolFromMCP(mcpTool);
      }

      this.emit('tools_discovered', this.discoveredTools);
    } catch (error) {
      this.logger.error('Failed to discover tools', { error: (error as Error).message });
      throw error;
    }
  }

  /**
   * Register a discovered MCP tool in the tool registry
   */
  private async registerToolFromMCP(mcpTool: MCPToolInfo): Promise<void> {
    // Check if this tool has a configuration
    const toolConfig = this.config.toolConfigs?.find(
      c => c.mcp_function_name === mcpTool.name
    );

    // Skip if disabled in configuration
    if (toolConfig && !toolConfig.enabled) {
      this.logger.info('Skipping disabled MCP tool', { 
        name: mcpTool.name, 
        server: this.config.name 
      });
      return;
    }

    // Use custom name if configured, otherwise use original name
    const toolName = toolConfig?.custom_name || mcpTool.name;
    
    const registeredTool: RegisteredTool = {
      definition: {
        name: toolName,
        description: mcpTool.description || `MCP tool: ${mcpTool.name}`,
        parameters: {
          type: 'object',
          properties: (mcpTool.inputSchema?.properties || {}) as Record<string, import('../types').ToolParameterSchema>,
          required: mcpTool.inputSchema?.required || []
        }
      },
      handler: async (args: Record<string, unknown>) => {
        return this.executeTool(mcpTool.name, args);
      },
      metadata: {
        source: 'mcp',
        server: this.config.name,
        originalName: mcpTool.name,
        customName: toolConfig?.custom_name
      }
    };

    this.toolRegistry.register(registeredTool);
    this.logger.info('Registered MCP tool', { 
      name: toolName, 
      originalName: mcpTool.name,
      server: this.config.name,
      customized: !!toolConfig?.custom_name
    });
  }

  /**
   * Execute a tool on the MCP server
   */
  async executeTool(toolName: string, args: Record<string, unknown>): Promise<unknown> {
    if (!this.client || !this.isConnected) {
      throw new Error('MCP client not connected');
    }

    this.logger.info('Executing MCP tool', { tool: toolName, args });

    try {
      const result = await this.client.callTool({
        name: toolName,
        arguments: args
      });

      this.logger.info('MCP tool executed', { tool: toolName, result });
      
      // Extract content from result
      if (result.content && Array.isArray(result.content)) {
        // Return text content if available
        const textContent = result.content.find((c: { type: string }) => c.type === 'text');
        if (textContent && 'text' in textContent) {
          try {
            return JSON.parse(textContent.text as string);
          } catch {
            return textContent.text;
          }
        }
      }
      
      return result;
    } catch (error) {
      this.logger.error('MCP tool execution failed', { tool: toolName, error: (error as Error).message });
      throw error;
    }
  }

  /**
   * Get list of discovered tools
   */
  getTools(): ToolDefinition[] {
    return this.discoveredTools.map(tool => ({
      name: `mcp_${this.config.name}_${tool.name}`,
      description: tool.description || `MCP tool: ${tool.name}`,
      parameters: {
        type: 'object' as const,
        properties: (tool.inputSchema?.properties || {}) as Record<string, import('../types').ToolParameterSchema>,
        required: tool.inputSchema?.required || []
      }
    }));
  }

  /**
   * Check if connected
   */
  isActive(): boolean {
    return this.isConnected;
  }

  /**
   * Refresh tools from server
   */
  async refreshTools(): Promise<void> {
    if (this.isConnected) {
      await this.discoverTools();
    }
  }
}

/**
 * Manager for multiple MCP client connections
 */
export class MCPClientManager {
  private clients: Map<string, MCPClient> = new Map();
  private toolRegistry: ToolRegistry;
  private logger: Logger;

  constructor(toolRegistry: ToolRegistry, logger: Logger) {
    this.toolRegistry = toolRegistry;
    this.logger = logger.child({ component: 'mcp-client-manager' });
  }

  /**
   * Add and connect to a new MCP server
   * @param config - MCP server configuration
   * @param toolRegistry - Optional session-specific tool registry. If not provided, uses the global registry.
   */
  async addServer(config: MCPClientConfig, toolRegistry?: ToolRegistry): Promise<MCPClient> {
    if (this.clients.has(config.name)) {
      throw new Error(`MCP server "${config.name}" already exists`);
    }

    // Use provided tool registry or fall back to global registry
    const registryToUse = toolRegistry || this.toolRegistry;
    const client = new MCPClient(config, registryToUse, this.logger);
    await client.connect();
    
    this.clients.set(config.name, client);
    this.logger.info('Added MCP server', { name: config.name });
    
    return client;
  }

  /**
   * Remove and disconnect from an MCP server
   */
  async removeServer(name: string): Promise<void> {
    const client = this.clients.get(name);
    if (client) {
      await client.disconnect();
      this.clients.delete(name);
      this.logger.info('Removed MCP server', { name });
    }
  }

  /**
   * Get a client by name
   */
  getClient(name: string): MCPClient | undefined {
    return this.clients.get(name);
  }

  /**
   * Get all connected clients
   */
  getAllClients(): MCPClient[] {
    return Array.from(this.clients.values());
  }

  /**
   * List all server names
   */
  listServers(): string[] {
    return Array.from(this.clients.keys());
  }

  /**
   * Get status of all connected clients
   */
  getStatus(): Array<{ name: string; connected: boolean; toolCount: number }> {
    return Array.from(this.clients.entries()).map(([name, client]) => ({
      name,
      connected: client.isActive(),
      toolCount: client.getTools().length
    }));
  }

  /**
   * Disconnect all clients
   */
  async disconnectAll(): Promise<void> {
    for (const client of this.clients.values()) {
      await client.disconnect();
    }
    this.clients.clear();
  }
}
