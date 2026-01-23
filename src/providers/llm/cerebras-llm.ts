/**
 * Cerebras LLM Provider
 * Implements ultra-fast streaming chat with function calling using Cerebras Cloud SDK
 * 
 * API Reference: https://inference-docs.cerebras.ai/api-reference/chat-completions
 * Features: ~100ms TTFT, streaming responses, tool use support
 */

import Cerebras from '@cerebras/cerebras_cloud_sdk';
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

interface CerebrasLLMConfig extends LLMConfig {
  model: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  seed?: number;
}

export class CerebrasLLMProvider extends LLMProvider {
  private client: Cerebras | null = null;

  constructor(config: CerebrasLLMConfig, logger: Logger) {
    super(config, logger);
  }

  getName(): string {
    return 'cerebras';
  }

  getCapabilities(): LLMProviderCapabilities {
    return {
      supportsStreaming: true,
      supportsFunctionCalling: true,
      supportsParallelToolCalls: true,
      supportsVision: false,
      maxContextTokens: 128000, // Llama 3.3 70B supports 128k context
      maxOutputTokens: 8192
    };
  }

  async initialize(): Promise<void> {
    this.validateConfig();
    
    this.client = new Cerebras({
      apiKey: this.config.credentials.apiKey
    });
    
    this.isInitialized = true;
    this.logger.info('Cerebras LLM provider initialized', { model: this.config.model });
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
      const cerebrasMessages = this.convertMessages(messages, systemPrompt);
      const cerebrasTools = tools ? this.convertTools(tools) : undefined;

      const response = await this.client.chat.completions.create({
        model: this.config.model,
        messages: cerebrasMessages,
        tools: cerebrasTools,
        temperature: this.config.temperature ?? 0.3,
        max_tokens: this.config.maxTokens ?? 2048,
        top_p: this.config.topP ?? 0.9,
        stream: false
      });

      return this.parseResponse(response, startTime);
    } catch (error) {
      throw this.createError(
        `Cerebras generation failed: ${(error as Error).message}`,
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

    const cerebrasMessages = this.convertMessages(messages, systemPrompt);
    const cerebrasTools = tools ? this.convertTools(tools) : undefined;
    
    return new CerebrasStreamSession(
      events,
      this.logger,
      this.client,
      {
        model: this.config.model,
        messages: cerebrasMessages,
        tools: cerebrasTools,
        temperature: this.config.temperature ?? 0.3,
        maxTokens: this.config.maxTokens ?? 2048,
        topP: this.config.topP ?? 0.9
      }
    );
  }

  async countTokens(messages: ChatMessage[]): Promise<number> {
    // Rough estimation: ~4 chars per token for Llama models
    const totalChars = messages.reduce((sum, msg) => {
      const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
      return sum + content.length;
    }, 0);
    return Math.ceil(totalChars / 4);
  }

  /**
   * Convert our ChatMessage format to Cerebras format
   */
  private convertMessages(messages: ChatMessage[], systemPrompt?: string): any[] {
    const cerebrasMessages: any[] = [];

    // Add system prompt as first message if provided
    if (systemPrompt) {
      cerebrasMessages.push({
        role: 'system',
        content: systemPrompt
      });
    }

    // Convert chat messages
    for (const msg of messages) {
      if (msg.role === 'system') {
        cerebrasMessages.push({
          role: 'system',
          content: msg.content
        });
      } else if (msg.role === 'user') {
        cerebrasMessages.push({
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

        cerebrasMessages.push(assistantMsg);
      } else if (msg.role === 'tool') {
        // Tool response message
        cerebrasMessages.push({
          role: 'tool',
          tool_call_id: msg.toolCallId,
          content: msg.content
        });
      }
    }

    return cerebrasMessages;
  }

  /**
   * Convert our ToolDefinition format to Cerebras function calling format
   */
  private convertTools(tools: ToolDefinition[]): any[] {
    return tools.map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters
      }
    }));
  }

  /**
   * Parse Cerebras response into our LLMResponse format
   */
  private parseResponse(response: any, startTime: number): LLMResponse {
    const choice = response.choices?.[0];
    const message = choice?.message;
    
    let textContent = message?.content || '';
    const toolCalls: ToolCall[] = [];

    // Parse tool calls if present
    if (message?.tool_calls && message.tool_calls.length > 0) {
      for (const tc of message.tool_calls) {
        toolCalls.push({
          id: tc.id,
          type: 'function',
          function: {
            name: tc.function.name,
            arguments: tc.function.arguments
          }
        });
      }
    }

    let finishReason: 'stop' | 'tool_calls' | 'length' | 'error' = 'stop';
    if (toolCalls.length > 0) {
      finishReason = 'tool_calls';
    } else if (choice?.finish_reason === 'length') {
      finishReason = 'length';
    }

    return {
      content: textContent,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      finishReason,
      usage: {
        promptTokens: response.usage?.prompt_tokens || 0,
        completionTokens: response.usage?.completion_tokens || 0,
        totalTokens: response.usage?.total_tokens || 0
      },
      latencyMs: Date.now() - startTime
    };
  }
}

interface CerebrasStreamConfig {
  model: string;
  messages: any[];
  tools?: any[];
  temperature: number;
  maxTokens: number;
  topP: number;
}

class CerebrasStreamSession extends LLMStreamSession {
  private client: Cerebras;
  private streamConfig: CerebrasStreamConfig;
  private abortController: AbortController | null = null;

  constructor(
    events: LLMStreamEvents | undefined,
    logger: Logger,
    client: Cerebras,
    config: CerebrasStreamConfig
  ) {
    super(events, logger);
    this.client = client;
    this.streamConfig = config;
  }

  async start(): Promise<void> {
    this.startTime = Date.now();
    this.isActive = true;
    this.abortController = new AbortController();

    try {
      const stream = await this.client.chat.completions.create({
        model: this.streamConfig.model,
        messages: this.streamConfig.messages,
        tools: this.streamConfig.tools,
        temperature: this.streamConfig.temperature,
        max_tokens: this.streamConfig.maxTokens,
        top_p: this.streamConfig.topP,
        stream: true
      });

      let fullContent = '';
      const toolCalls: ToolCall[] = [];
      let promptTokens = 0;
      let completionTokens = 0;
      
      // Track tool call accumulation
      const toolCallsMap = new Map<number, { id: string; name: string; arguments: string }>();

      for await (const chunk of stream) {
        if (!this.isActive) break;

        const choice = (chunk as any).choices?.[0];
        const delta = choice?.delta;
        
        // Process text content
        if (delta?.content) {
          fullContent += delta.content;
          this.processToken(delta.content);
        }

        // Process tool calls
        if (delta?.tool_calls) {
          for (const toolCallDelta of delta.tool_calls) {
            const index = toolCallDelta.index;
            
            if (!toolCallsMap.has(index)) {
              toolCallsMap.set(index, {
                id: toolCallDelta.id || '',
                name: '',
                arguments: ''
              });
            }
            
            const toolCall = toolCallsMap.get(index)!;
            
            if (toolCallDelta.id) {
              toolCall.id = toolCallDelta.id;
            }
            if (toolCallDelta.function?.name) {
              toolCall.name += toolCallDelta.function.name;
            }
            if (toolCallDelta.function?.arguments) {
              toolCall.arguments += toolCallDelta.function.arguments;
            }
          }
        }

        // Update usage if available
        const usage = (chunk as any).usage;
        if (usage) {
          promptTokens = usage.prompt_tokens || 0;
          completionTokens = usage.completion_tokens || 0;
        }
      }

      // Convert accumulated tool calls to final format
      for (const [_, toolCallData] of toolCallsMap) {
        const toolCall: ToolCall = {
          id: toolCallData.id,
          type: 'function',
          function: {
            name: toolCallData.name,
            arguments: toolCallData.arguments
          }
        };
        toolCalls.push(toolCall);
        this.emitToolCall(toolCall);
      }

      // Emit completion
      const finalResponse: LLMResponse = {
        content: fullContent,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        finishReason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
        usage: {
          promptTokens,
          completionTokens,
          totalTokens: promptTokens + completionTokens
        },
        latencyMs: Date.now() - this.startTime
      };

      this.emitComplete(finalResponse);

    } catch (error) {
      if (this.isActive) {
        this.emitError(error as Error);
      }
    }
  }

  abort(): void {
    this.isActive = false;
    this.abortController?.abort();
  }
}

// Register the provider
import { LLMProviderFactory } from '../base/llm-provider';
LLMProviderFactory.register('cerebras', CerebrasLLMProvider as any);

export default CerebrasLLMProvider;
