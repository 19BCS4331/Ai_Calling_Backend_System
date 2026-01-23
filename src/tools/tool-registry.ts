/**
 * Tool Registry
 * Manages tool registration, discovery, and execution
 * Supports both local tools and MCP-based n8n workflow tools
 */

import {
  ToolDefinition,
  ToolParameterSchema,
  ToolExecutionRequest,
  ToolExecutionResult,
  RegisteredTool,
  ToolExecutionContext,
  Logger
} from '../types';

export class ToolRegistry {
  private tools: Map<string, RegisteredTool> = new Map();
  private logger: Logger;
  private defaultTimeout: number;

  constructor(logger: Logger, defaultTimeout: number = 30000) {
    this.logger = logger.child({ component: 'tool-registry' });
    this.defaultTimeout = defaultTimeout;
  }

  /**
   * Register a tool
   */
  register(tool: RegisteredTool): void {
    if (this.tools.has(tool.definition.name)) {
      this.logger.warn('Overwriting existing tool', { name: tool.definition.name });
    }
    
    this.tools.set(tool.definition.name, tool);
    this.logger.info('Tool registered', { name: tool.definition.name });
  }

  /**
   * Register multiple tools at once
   */
  registerMany(tools: RegisteredTool[]): void {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  /**
   * Unregister a tool
   */
  unregister(name: string): void {
    if (this.tools.delete(name)) {
      this.logger.info('Tool unregistered', { name });
    }
  }

  /**
   * Get all tool definitions (for LLM)
   */
  getDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map(t => t.definition);
  }

  /**
   * Get compressed tool definitions to reduce token usage
   * Shortens descriptions and removes unnecessary metadata
   */
  getCompressedDefinitions(maxTools?: number): ToolDefinition[] {
    const tools = Array.from(this.tools.values()).map(t => ({
      name: t.definition.name,
      // Truncate description to max 100 chars
      description: t.definition.description 
        ? t.definition.description.slice(0, 100) + (t.definition.description.length > 100 ? '...' : '')
        : t.definition.name,
      parameters: this.compressParameters(t.definition.parameters)
    }));

    // If maxTools specified, prioritize essential tools
    if (maxTools && tools.length > maxTools) {
      // Essential tools always included
      const essentialNames = ['end_call', 'transfer_call', 'hold_call', 'get_current_time'];
      const essential = tools.filter(t => essentialNames.includes(t.name));
      const others = tools.filter(t => !essentialNames.includes(t.name));
      
      // Take essential + fill remaining slots with other tools
      const remaining = maxTools - essential.length;
      return [...essential, ...others.slice(0, Math.max(0, remaining))];
    }

    return tools;
  }

  /**
   * Compress parameter schema to reduce tokens
   */
  private compressParameters(params: ToolDefinition['parameters']): ToolDefinition['parameters'] {
    if (!params.properties) return params;

    const compressed: Record<string, any> = {};
    for (const [key, prop] of Object.entries(params.properties)) {
      compressed[key] = {
        type: prop.type,
        // Truncate description to 50 chars max
        description: prop.description 
          ? (prop.description.length > 50 ? prop.description.slice(0, 50) + '...' : prop.description)
          : ''
      };
      // Keep enum if present (important for valid values)
      if (prop.enum) {
        compressed[key].enum = prop.enum;
      }
      // Keep items if present (required for array types)
      if ((prop as any).items) {
        compressed[key].items = (prop as any).items;
      }
    }

    return {
      type: params.type,
      properties: compressed as Record<string, ToolParameterSchema>,
      required: params.required
    };
  }

  /**
   * Get a specific tool
   */
  getTool(name: string): RegisteredTool | undefined {
    return this.tools.get(name);
  }

  /**
   * Check if a tool exists
   */
  hasTool(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Execute a tool
   */
  async execute(request: ToolExecutionRequest): Promise<ToolExecutionResult> {
    const startTime = Date.now();
    const tool = this.tools.get(request.toolName);

    if (!tool) {
      return {
        success: false,
        error: `Tool not found: ${request.toolName}`,
        latencyMs: Date.now() - startTime
      };
    }

    const context: ToolExecutionContext = {
      sessionId: request.sessionId,
      tenantId: '', // Will be populated from session
      callContext: request.callContext,
      logger: this.logger.child({ tool: request.toolName })
    };

    const timeout = tool.timeout || this.defaultTimeout;

    try {
      const result = await this.executeWithTimeout(
        tool.handler(request.arguments, context),
        timeout
      );

      return {
        success: true,
        result,
        latencyMs: Date.now() - startTime
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      this.logger.error('Tool execution failed', {
        tool: request.toolName,
        error: errorMessage
      });

      return {
        success: false,
        error: errorMessage,
        latencyMs: Date.now() - startTime
      };
    }
  }

  /**
   * Execute with timeout
   */
  private async executeWithTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Tool execution timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      promise
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }

  /**
   * Get tool count
   */
  get size(): number {
    return this.tools.size;
  }

  /**
   * List all tool names
   */
  listTools(): string[] {
    return Array.from(this.tools.keys());
  }

  /**
   * Clear all tools
   */
  clear(): void {
    this.tools.clear();
    this.logger.info('All tools cleared');
  }
}

/**
 * Built-in tools for common operations
 */
export const builtInTools: RegisteredTool[] = [
  {
    definition: {
      name: 'get_current_time',
      description: 'Get the current date and time in the specified timezone',
      parameters: {
        type: 'object',
        properties: {
          timezone: {
            type: 'string',
            description: 'Timezone like "Asia/Kolkata" or "UTC"'
          }
        },
        required: []
      }
    },
    handler: async (args) => {
      const timezone = (args.timezone as string) || 'Asia/Kolkata';
      const now = new Date();
      return {
        datetime: now.toLocaleString('en-IN', { timeZone: timezone }),
        timezone,
        timestamp: now.toISOString()
      };
    }
  },
  {
    definition: {
      name: 'end_call',
      description: 'End the current call politely',
      parameters: {
        type: 'object',
        properties: {
          reason: {
            type: 'string',
            description: 'Reason for ending the call'
          }
        },
        required: []
      }
    },
    handler: async (args, context) => {
      context.logger.info('Call ended by agent', { reason: args.reason });
      return { status: 'call_ended', reason: args.reason };
    }
  },
  {
    definition: {
      name: 'transfer_call',
      description: 'Transfer the call to a human agent or another department',
      parameters: {
        type: 'object',
        properties: {
          department: {
            type: 'string',
            description: 'Department to transfer to (e.g., "sales", "support", "billing")'
          },
          reason: {
            type: 'string',
            description: 'Reason for transfer'
          }
        },
        required: ['department']
      }
    },
    handler: async (args, context) => {
      context.logger.info('Call transfer requested', { 
        department: args.department, 
        reason: args.reason 
      });
      return { 
        status: 'transfer_initiated', 
        department: args.department,
        message: `Transferring to ${args.department} department`
      };
    }
  },
  {
    definition: {
      name: 'hold_call',
      description: 'Put the caller on hold briefly',
      parameters: {
        type: 'object',
        properties: {
          duration_seconds: {
            type: 'number',
            description: 'Expected hold duration in seconds'
          },
          reason: {
            type: 'string',
            description: 'Reason for putting on hold'
          }
        },
        required: []
      }
    },
    handler: async (args) => {
      return { 
        status: 'on_hold', 
        duration: args.duration_seconds || 30,
        reason: args.reason || 'Processing your request'
      };
    }
  }
];

export default ToolRegistry;
