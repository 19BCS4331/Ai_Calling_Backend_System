/**
 * MCP (Model Context Protocol) Server
 * Exposes n8n workflows as tools for the voice agent
 * 
 * Protocol Reference: https://modelcontextprotocol.io/specification/2025-11-25
 */

import { v4 as uuidv4 } from 'uuid';
import {
  MCPServerConfig,
  MCPToolDefinition,
  MCPRequest,
  MCPResponse,
  MCPError,
  ToolDefinition,
  RegisteredTool,
  ToolExecutionContext,
  Logger
} from '../types';
import { ToolRegistry } from '../tools/tool-registry';

const MCP_PROTOCOL_VERSION = '2025-11-25';

interface MCPCapabilities {
  tools?: { listChanged?: boolean };
  resources?: { subscribe?: boolean; listChanged?: boolean };
  prompts?: { listChanged?: boolean };
}

interface MCPServerState {
  initialized: boolean;
  clientInfo?: { name: string; version: string };
  capabilities: MCPCapabilities;
}

export class MCPServer {
  private config: MCPServerConfig;
  private logger: Logger;
  private state: MCPServerState;
  private toolRegistry: ToolRegistry;
  private n8nWebhooks: Map<string, N8nWebhookTool> = new Map();
  private requestId: number = 0;

  constructor(
    config: MCPServerConfig,
    toolRegistry: ToolRegistry,
    logger: Logger
  ) {
    this.config = config;
    this.toolRegistry = toolRegistry;
    this.logger = logger.child({ component: 'mcp-server', server: config.name });
    
    this.state = {
      initialized: false,
      capabilities: {
        tools: { listChanged: true }
      }
    };
  }

  /**
   * Handle incoming MCP request
   */
  async handleRequest(request: MCPRequest): Promise<MCPResponse> {
    this.logger.debug('MCP request received', { method: request.method, id: request.id });

    try {
      switch (request.method) {
        case 'initialize':
          return this.handleInitialize(request);
        
        case 'initialized':
          return this.handleInitialized(request);
        
        case 'tools/list':
          return this.handleToolsList(request);
        
        case 'tools/call':
          return this.handleToolsCall(request);
        
        case 'ping':
          return this.createResponse(request.id, {});
        
        default:
          return this.createErrorResponse(request.id, {
            code: -32601,
            message: `Method not found: ${request.method}`
          });
      }
    } catch (error) {
      this.logger.error('MCP request failed', { error: (error as Error).message });
      return this.createErrorResponse(request.id, {
        code: -32603,
        message: (error as Error).message
      });
    }
  }

  /**
   * Handle initialize request
   */
  private handleInitialize(request: MCPRequest): MCPResponse {
    const params = request.params as {
      protocolVersion: string;
      clientInfo: { name: string; version: string };
      capabilities?: MCPCapabilities;
    };

    this.state.clientInfo = params.clientInfo;
    this.logger.info('MCP client connected', { 
      client: params.clientInfo,
      protocolVersion: params.protocolVersion 
    });

    return this.createResponse(request.id, {
      protocolVersion: MCP_PROTOCOL_VERSION,
      serverInfo: {
        name: this.config.name,
        version: '1.0.0'
      },
      capabilities: this.state.capabilities
    });
  }

  /**
   * Handle initialized notification
   */
  private handleInitialized(request: MCPRequest): MCPResponse {
    this.state.initialized = true;
    this.logger.info('MCP session initialized');
    return this.createResponse(request.id, {});
  }

  /**
   * Handle tools/list request
   */
  private handleToolsList(request: MCPRequest): MCPResponse {
    const tools: MCPToolDefinition[] = [];

    // Add tools from registry
    for (const def of this.toolRegistry.getDefinitions()) {
      tools.push({
        name: def.name,
        description: def.description,
        inputSchema: {
          type: 'object',
          properties: def.parameters.properties,
          required: def.parameters.required
        }
      });
    }

    // Add n8n webhook tools
    for (const [name, webhook] of this.n8nWebhooks) {
      tools.push({
        name,
        description: webhook.description,
        inputSchema: webhook.inputSchema
      });
    }

    return this.createResponse(request.id, { tools });
  }

  /**
   * Handle tools/call request
   */
  private async handleToolsCall(request: MCPRequest): Promise<MCPResponse> {
    const params = request.params as {
      name: string;
      arguments?: Record<string, unknown>;
    };

    const { name, arguments: args } = params;

    // Check if it's an n8n webhook tool
    if (this.n8nWebhooks.has(name)) {
      return this.executeN8nTool(request.id, name, args || {});
    }

    // Execute from tool registry
    const result = await this.toolRegistry.execute({
      toolName: name,
      arguments: args || {},
      sessionId: 'mcp-session',
      callContext: {}
    });

    if (result.success) {
      return this.createResponse(request.id, {
        content: [
          {
            type: 'text',
            text: typeof result.result === 'string' 
              ? result.result 
              : JSON.stringify(result.result, null, 2)
          }
        ],
        isError: false
      });
    } else {
      return this.createResponse(request.id, {
        content: [{ type: 'text', text: result.error || 'Unknown error' }],
        isError: true
      });
    }
  }

  /**
   * Execute n8n webhook tool
   */
  private async executeN8nTool(
    requestId: string | number,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<MCPResponse> {
    const webhook = this.n8nWebhooks.get(toolName)!;
    
    try {
      const response = await fetch(webhook.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(webhook.apiKey && { 'Authorization': `Bearer ${webhook.apiKey}` })
        },
        body: JSON.stringify(args),
        signal: AbortSignal.timeout(webhook.timeout || this.config.timeout || 30000)
      });

      if (!response.ok) {
        throw new Error(`n8n webhook failed: ${response.status} ${response.statusText}`);
      }

      const result = await response.json();

      this.logger.info('n8n tool executed', { tool: toolName, success: true });

      return this.createResponse(requestId, {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2)
          }
        ],
        isError: false
      });

    } catch (error) {
      this.logger.error('n8n tool execution failed', { 
        tool: toolName, 
        error: (error as Error).message 
      });

      return this.createResponse(requestId, {
        content: [{ type: 'text', text: (error as Error).message }],
        isError: true
      });
    }
  }

  /**
   * Register an n8n webhook as a tool
   */
  registerN8nWebhook(tool: N8nWebhookTool): void {
    this.n8nWebhooks.set(tool.name, tool);
    this.logger.info('n8n webhook registered', { name: tool.name });

    // Also register in the main tool registry for LLM access
    const registeredTool: RegisteredTool = {
      definition: {
        name: tool.name,
        description: tool.description,
        parameters: {
          type: 'object',
          properties: tool.inputSchema.properties as any,
          required: tool.inputSchema.required
        }
      },
      handler: async (args: Record<string, unknown>) => {
        const response = await fetch(tool.webhookUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(tool.apiKey && { 'Authorization': `Bearer ${tool.apiKey}` })
          },
          body: JSON.stringify(args)
        });
        return response.json();
      },
      timeout: tool.timeout
    };

    this.toolRegistry.register(registeredTool);
  }

  /**
   * Unregister an n8n webhook tool
   */
  unregisterN8nWebhook(name: string): void {
    this.n8nWebhooks.delete(name);
    this.toolRegistry.unregister(name);
    this.logger.info('n8n webhook unregistered', { name });
  }

  /**
   * Create a successful response
   */
  private createResponse(id: string | number, result: unknown): MCPResponse {
    return {
      jsonrpc: '2.0',
      id,
      result
    };
  }

  /**
   * Create an error response
   */
  private createErrorResponse(id: string | number, error: MCPError): MCPResponse {
    return {
      jsonrpc: '2.0',
      id,
      error
    };
  }

  /**
   * Send a notification (for tools/list_changed, etc.)
   */
  createNotification(method: string, params?: unknown): MCPRequest {
    return {
      jsonrpc: '2.0',
      id: ++this.requestId,
      method,
      params
    };
  }

  /**
   * Get server status
   */
  getStatus(): { initialized: boolean; toolCount: number; webhookCount: number } {
    return {
      initialized: this.state.initialized,
      toolCount: this.toolRegistry.size,
      webhookCount: this.n8nWebhooks.size
    };
  }
}

/**
 * n8n Webhook Tool Definition
 */
export interface N8nWebhookTool {
  name: string;
  description: string;
  webhookUrl: string;
  apiKey?: string;
  timeout?: number;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/**
 * Pre-defined n8n workflow tools for common use cases
 */
export function createCommonN8nTools(baseUrl: string, apiKey?: string): N8nWebhookTool[] {
  return [
    {
      name: 'create_loan_application',
      description: 'Create a new loan application in the CRM system',
      webhookUrl: `${baseUrl}/webhook/create-loan`,
      apiKey,
      inputSchema: {
        type: 'object',
        properties: {
          customer_name: { type: 'string', description: 'Full name of the customer' },
          phone_number: { type: 'string', description: 'Customer phone number' },
          loan_amount: { type: 'number', description: 'Requested loan amount in INR' },
          loan_type: { type: 'string', description: 'Type of loan: personal, home, vehicle, business' },
          monthly_income: { type: 'number', description: 'Monthly income in INR' }
        },
        required: ['customer_name', 'phone_number', 'loan_amount', 'loan_type']
      }
    },
    {
      name: 'fetch_customer_details',
      description: 'Fetch customer details from CRM by phone number or customer ID',
      webhookUrl: `${baseUrl}/webhook/fetch-customer`,
      apiKey,
      inputSchema: {
        type: 'object',
        properties: {
          phone_number: { type: 'string', description: 'Customer phone number' },
          customer_id: { type: 'string', description: 'Customer ID in CRM' }
        },
        required: []
      }
    },
    {
      name: 'send_payment_link',
      description: 'Send a payment link to customer via SMS/WhatsApp',
      webhookUrl: `${baseUrl}/webhook/send-payment-link`,
      apiKey,
      inputSchema: {
        type: 'object',
        properties: {
          phone_number: { type: 'string', description: 'Customer phone number' },
          amount: { type: 'number', description: 'Payment amount in INR' },
          description: { type: 'string', description: 'Payment description' },
          due_date: { type: 'string', description: 'Payment due date (YYYY-MM-DD)' }
        },
        required: ['phone_number', 'amount']
      }
    },
    {
      name: 'book_appointment',
      description: 'Book an appointment for the customer',
      webhookUrl: `${baseUrl}/webhook/book-appointment`,
      apiKey,
      inputSchema: {
        type: 'object',
        properties: {
          customer_name: { type: 'string', description: 'Customer name' },
          phone_number: { type: 'string', description: 'Customer phone number' },
          appointment_type: { type: 'string', description: 'Type: consultation, follow-up, document-submission' },
          preferred_date: { type: 'string', description: 'Preferred date (YYYY-MM-DD)' },
          preferred_time: { type: 'string', description: 'Preferred time slot (e.g., "10:00 AM")' },
          branch: { type: 'string', description: 'Branch location' }
        },
        required: ['customer_name', 'phone_number', 'appointment_type', 'preferred_date']
      }
    },
    {
      name: 'update_crm_record',
      description: 'Update customer record in CRM',
      webhookUrl: `${baseUrl}/webhook/update-crm`,
      apiKey,
      inputSchema: {
        type: 'object',
        properties: {
          customer_id: { type: 'string', description: 'Customer ID' },
          field: { type: 'string', description: 'Field to update' },
          value: { type: 'string', description: 'New value' },
          notes: { type: 'string', description: 'Notes about the update' }
        },
        required: ['customer_id', 'field', 'value']
      }
    },
    {
      name: 'check_loan_status',
      description: 'Check the status of a loan application',
      webhookUrl: `${baseUrl}/webhook/loan-status`,
      apiKey,
      inputSchema: {
        type: 'object',
        properties: {
          application_id: { type: 'string', description: 'Loan application ID' },
          phone_number: { type: 'string', description: 'Customer phone number for lookup' }
        },
        required: []
      }
    },
    {
      name: 'send_document_request',
      description: 'Request documents from customer via SMS/Email',
      webhookUrl: `${baseUrl}/webhook/request-documents`,
      apiKey,
      inputSchema: {
        type: 'object',
        properties: {
          phone_number: { type: 'string', description: 'Customer phone number' },
          email: { type: 'string', description: 'Customer email' },
          document_types: { 
            type: 'array', 
            items: { type: 'string' },
            description: 'List of required documents: aadhar, pan, salary_slip, bank_statement, etc.'
          },
          deadline: { type: 'string', description: 'Submission deadline (YYYY-MM-DD)' }
        },
        required: ['phone_number', 'document_types']
      }
    }
  ];
}

export default MCPServer;
