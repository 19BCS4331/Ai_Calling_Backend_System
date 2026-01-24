/**
 * Groq LLM Provider
 * Implements ultra-fast streaming chat with function calling using Groq API
 * 
 * API Reference: https://console.groq.com/docs/api-reference
 * Features: 300-1000+ tokens/sec, streaming responses, parallel tool calling support
 */

import Groq from 'groq-sdk';
import {
  LLMConfig,
  ChatMessage,
  ToolDefinition,
  LLMResponse,
  LLMStreamChunk,
  LLMStreamEvents,
  ProviderError,
  Logger,
  ToolCall
} from '../../types';
import { LLMProvider, LLMProviderCapabilities, LLMStreamSession } from '../base/llm-provider';

interface GroqLLMConfig extends LLMConfig {
  model: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  seed?: number;
}

export class GroqLLMProvider extends LLMProvider {
  private client: Groq | null = null;

  constructor(config: GroqLLMConfig, logger: Logger) {
    super(config, logger);
  }

  getName(): string {
    return 'groq';
  }

  getCapabilities(): LLMProviderCapabilities {
    return {
      supportsStreaming: true,
      supportsFunctionCalling: true,
      supportsParallelToolCalls: true,
      supportsVision: false,
      maxContextTokens: 128000, // Llama 4 and 3.3 support 128k context
      maxOutputTokens: 8192
    };
  }

  async initialize(): Promise<void> {
    this.validateConfig();
    
    this.client = new Groq({
      apiKey: this.config.credentials.apiKey
    });
    
    this.isInitialized = true;
    this.logger.info('Groq LLM provider initialized', { model: this.config.model });
  }

  async generate(
    messages: ChatMessage[],
    tools?: ToolDefinition[],
    systemPrompt?: string
  ): Promise<LLMResponse> {
    if (!this.client) {
      throw this.createError('Provider not initialized', 'NOT_INITIALIZED');
    }

    const startTime = Date.now();
    
    try {
      const groqMessages = this.convertMessages(messages, systemPrompt);
      const groqTools = tools ? this.convertTools(tools) : undefined;

      const response = await this.client.chat.completions.create({
        model: this.config.model,
        messages: groqMessages,
        tools: groqTools,
        temperature: this.config.temperature ?? 0.3,
        max_tokens: this.config.maxTokens ?? 2048,
        top_p: this.config.topP ?? 0.9,
        stream: false
      });

      return this.parseResponse(response, startTime);
    } catch (error) {
      throw this.createError(
        `Groq generation failed: ${(error as Error).message}`,
        'GENERATION_FAILED',
        true,
        error as Error
      );
    }
  }

  async generateStream(
    messages: ChatMessage[],
    tools?: ToolDefinition[],
    systemPrompt?: string,
    events?: LLMStreamEvents
  ): Promise<LLMStreamSession> {
    if (!this.client) {
      throw this.createError('Provider not initialized', 'NOT_INITIALIZED');
    }

    const session = new GroqStreamSession(
      this.client,
      this.config,
      messages,
      tools,
      systemPrompt,
      this.logger,
      events
    );

    return session;
  }

  startStreamSession(
    messages: ChatMessage[],
    tools?: ToolDefinition[],
    systemPrompt?: string
  ): LLMStreamSession {
    return new GroqStreamSession(
      this.client!,
      this.config,
      messages,
      tools,
      systemPrompt,
      this.logger
    );
  }

  /**
   * Convert our message format to Groq format
   */
  private convertMessages(messages: ChatMessage[], systemPrompt?: string): any[] {
    const groqMessages: any[] = [];

    // Add system prompt if provided
    if (systemPrompt) {
      groqMessages.push({
        role: 'system',
        content: systemPrompt
      });
    }

    // Convert messages
    for (const msg of messages) {
      if (msg.role === 'system') {
        groqMessages.push({
          role: 'system',
          content: msg.content
        });
      } else if (msg.role === 'user') {
        groqMessages.push({
          role: 'user',
          content: msg.content
        });
      } else if (msg.role === 'assistant') {
        const assistantMsg: any = {
          role: 'assistant',
          content: msg.content || null
        };

        // Add tool calls if present
        if (msg.toolCalls && msg.toolCalls.length > 0) {
          assistantMsg.tool_calls = msg.toolCalls.map(tc => ({
            id: tc.id,
            type: 'function',
            function: {
              name: tc.function.name,
              arguments: tc.function.arguments
            }
          }));
        }

        groqMessages.push(assistantMsg);
      } else if (msg.role === 'tool') {
        // Groq expects tool messages with tool_call_id
        groqMessages.push({
          role: 'tool',
          tool_call_id: msg.toolCallId,
          name: msg.name,
          content: msg.content || 'No result'
        });
      }
    }

    return groqMessages;
  }

  /**
   * Convert our ToolDefinition format to Groq function calling format
   * Groq supports standard OpenAI-compatible tool definitions
   */
  private convertTools(tools: ToolDefinition[]): any[] {
    return tools.map(tool => {
      const parameters = tool.parameters || {
        type: 'object',
        properties: {},
        required: []
      };
      
      this.logger.info('Converting tool for Groq', {
        name: tool.name,
        description: tool.description?.substring(0, 100),
        parameterCount: tool.parameters?.properties ? Object.keys(tool.parameters.properties).length : 0
      });
      
      return {
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters
        }
      };
    });
  }

  /**
   * Parse Groq response into our format
   */
  private parseResponse(response: any, startTime: number): LLMResponse {
    const choice = response.choices[0];
    const message = choice.message;

    const llmResponse: LLMResponse = {
      content: message.content || '',
      finishReason: choice.finish_reason,
      usage: {
        promptTokens: response.usage?.prompt_tokens || 0,
        completionTokens: response.usage?.completion_tokens || 0,
        totalTokens: response.usage?.total_tokens || 0
      },
      latencyMs: Date.now() - startTime
    };

    // Parse tool calls if present
    if (message.tool_calls && message.tool_calls.length > 0) {
      llmResponse.toolCalls = message.tool_calls.map((tc: any) => ({
        id: tc.id,
        type: 'function',
        function: {
          name: tc.function.name,
          arguments: tc.function.arguments
        }
      }));
    }

    return llmResponse;
  }

  /**
   * Parse tool calls from streaming delta
   */
  private parseToolCallsFromDelta(toolCalls: any[]): ToolCall[] {
    return toolCalls.map(tc => ({
      id: tc.id || '',
      type: 'function',
      function: {
        name: tc.function?.name || '',
        arguments: tc.function?.arguments || ''
      }
    }));
  }

  async countTokens(messages: ChatMessage[]): Promise<number> {
    // Rough estimation: ~4 chars per token
    const totalChars = messages.reduce((sum, msg) => sum + (msg.content?.length || 0), 0);
    return Math.ceil(totalChars / 4);
  }

  async shutdown(): Promise<void> {
    this.client = null;
    this.isInitialized = false;
    this.logger.info('Groq LLM provider cleaned up');
  }
}

/**
 * Groq streaming session with event-based interface
 */
class GroqStreamSession extends LLMStreamSession {
  private client: Groq;
  private config: GroqLLMConfig;
  private messages: ChatMessage[];
  private tools?: ToolDefinition[];
  private systemPrompt?: string;
  private aborted = false;

  constructor(
    client: Groq,
    config: GroqLLMConfig,
    messages: ChatMessage[],
    tools: ToolDefinition[] | undefined,
    systemPrompt: string | undefined,
    logger: Logger,
    events?: LLMStreamEvents
  ) {
    super(events, logger);
    this.client = client;
    this.config = config;
    this.messages = messages;
    this.tools = tools;
    this.systemPrompt = systemPrompt;
  }

  async start(): Promise<void> {
    const startTime = Date.now();
    let firstChunkTime: number | null = null;
    let accumulatedContent = '';
    let currentSentence = '';
    
    // Tool call accumulation
    const toolCallsMap = new Map<number, {
      id: string;
      type: string;
      function: {
        name: string;
        arguments: string;
      };
    }>();

    try {
      const groqMessages = this.convertMessages(this.messages, this.systemPrompt);
      const groqTools = this.tools ? this.convertTools(this.tools) : undefined;

      this.logger.info('Starting Groq stream', {
        model: this.config.model,
        messageCount: groqMessages.length,
        toolCount: groqTools?.length || 0,
        tools: groqTools?.map((t: any) => t.function.name)
      });

      const stream = await this.client.chat.completions.create({
        model: this.config.model,
        messages: groqMessages,
        tools: groqTools,
        tool_choice: groqTools && groqTools.length > 0 ? 'auto' : undefined,
        temperature: this.config.temperature ?? 0.3,
        max_tokens: this.config.maxTokens ?? 2048,
        top_p: this.config.topP ?? 0.9,
        stream: true
      });

      for await (const chunk of stream) {
        if (this.aborted) {
          this.logger.info('Groq stream aborted by user');
          break;
        }

        if (!firstChunkTime) {
          firstChunkTime = Date.now();
          const ttft = firstChunkTime - startTime;
          this.logger.info('Groq TTFT', { ttft, model: this.config.model });
        }

        const delta = chunk.choices[0]?.delta;
        const finishReason = chunk.choices[0]?.finish_reason;

        if (!delta) continue;

        // Handle content
        if (delta.content) {
          const content = delta.content;
          accumulatedContent += content;
          
          // Process token through base class method for sentence detection
          this.processToken(content);
        }

        // Handle tool calls
        if (delta.tool_calls) {
          for (const toolCallDelta of delta.tool_calls) {
            const index = toolCallDelta.index;
            
            if (!toolCallsMap.has(index)) {
              toolCallsMap.set(index, {
                id: toolCallDelta.id || '',
                type: 'function',
                function: {
                  name: toolCallDelta.function?.name || '',
                  arguments: toolCallDelta.function?.arguments || ''
                }
              });
            } else {
              const existing = toolCallsMap.get(index)!;
              if (toolCallDelta.id) existing.id = toolCallDelta.id;
              if (toolCallDelta.function?.name) existing.function.name = toolCallDelta.function.name;
              if (toolCallDelta.function?.arguments) {
                existing.function.arguments += toolCallDelta.function.arguments;
              }
            }
          }
        }

        // Handle completion
        if (finishReason) {
          let toolCalls: ToolCall[] | undefined = undefined;
          
          // Emit tool calls if any
          if (toolCallsMap.size > 0) {
            toolCalls = Array.from(toolCallsMap.values()).map(tc => ({
              id: tc.id,
              type: 'function' as const,
              function: {
                name: tc.function.name,
                arguments: tc.function.arguments
              }
            }));

            this.logger.info('Groq tool calls detected', {
              count: toolCalls.length,
              tools: toolCalls.map(tc => tc.function.name)
            });

            for (const toolCall of toolCalls) {
              this.emitToolCall(toolCall);
            }
          }

          // Emit completion through base class method
          this.emitComplete({
            content: accumulatedContent,
            finishReason: (finishReason === 'function_call' ? 'tool_calls' : finishReason) as 'stop' | 'length' | 'tool_calls' | 'error',
            toolCalls,
            usage: {
              promptTokens: 0,
              completionTokens: 0,
              totalTokens: 0
            },
            latencyMs: Date.now() - startTime
          });

          break;
        }
      }
    } catch (error) {
      this.logger.error('Groq stream error', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
      this.emitError(error as Error);
    }
  }

  abort(): void {
    this.aborted = true;
  }

  private convertMessages(messages: ChatMessage[], systemPrompt?: string): any[] {
    const groqMessages: any[] = [];

    if (systemPrompt) {
      groqMessages.push({
        role: 'system',
        content: systemPrompt
      });
    }

    for (const msg of messages) {
      if (msg.role === 'system') {
        groqMessages.push({
          role: 'system',
          content: msg.content
        });
      } else if (msg.role === 'user') {
        groqMessages.push({
          role: 'user',
          content: msg.content
        });
      } else if (msg.role === 'assistant') {
        const assistantMsg: any = {
          role: 'assistant',
          content: msg.content || null
        };

        if (msg.toolCalls && msg.toolCalls.length > 0) {
          assistantMsg.tool_calls = msg.toolCalls.map(tc => ({
            id: tc.id,
            type: 'function',
            function: {
              name: tc.function.name,
              arguments: tc.function.arguments
            }
          }));
        }

        groqMessages.push(assistantMsg);
      } else if (msg.role === 'tool') {
        groqMessages.push({
          role: 'tool',
          tool_call_id: msg.toolCallId,
          name: msg.name,
          content: msg.content || 'No result'
        });
      }
    }

    return groqMessages;
  }

  private convertTools(tools: ToolDefinition[]): any[] {
    return tools.map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters || {
          type: 'object',
          properties: {},
          required: []
        }
      }
    }));
  }
}

// Register the provider
import { LLMProviderFactory } from '../base/llm-provider';
LLMProviderFactory.register('groq', GroqLLMProvider);
