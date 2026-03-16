/**
 * OpenRouter LLM Provider
 * Implements streaming chat with function calling via OpenRouter's OpenAI-compatible API
 * 
 * API Reference: https://openrouter.ai/docs/api-reference/overview
 * Features: Access to 200+ models, streaming SSE, tool calling, provider routing
 * 
 * Key details:
 * - Base URL: https://openrouter.ai/api/v1/chat/completions
 * - Auth: Bearer token (OPENROUTER_API_KEY)
 * - Streaming: SSE with `stream: true`, comment lines (": OPENROUTER PROCESSING") must be ignored
 * - Tool calling: OpenAI-compatible format, passed through for supported models
 * - Finish reasons normalized to: tool_calls, stop, length, content_filter, error
 * - Usage returned in final streaming chunk with empty choices array
 */

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

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

interface OpenRouterLLMConfig extends LLMConfig {
  model: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  seed?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  // OpenRouter-specific
  route?: 'fallback';
  transforms?: string[];
}

export class OpenRouterLLMProvider extends LLMProvider {
  private apiKey: string = '';

  constructor(config: OpenRouterLLMConfig, logger: Logger) {
    super(config, logger);
  }

  getName(): string {
    return 'openrouter';
  }

  getCapabilities(): LLMProviderCapabilities {
    return {
      supportsStreaming: true,
      supportsFunctionCalling: true,
      supportsParallelToolCalls: true,
      supportsVision: true,
      maxContextTokens: 1000000, // Varies by model; set high for router
      maxOutputTokens: 16384
    };
  }

  async initialize(): Promise<void> {
    this.validateConfig();
    this.apiKey = this.config.credentials.apiKey;
    this.isInitialized = true;
    this.logger.info('OpenRouter LLM provider initialized', { model: this.config.model });
  }

  async generate(
    messages: ChatMessage[],
    tools?: ToolDefinition[],
    systemPrompt?: string
  ): Promise<LLMResponse> {
    if (!this.apiKey) {
      throw this.createError('Provider not initialized', 'NOT_INITIALIZED');
    }

    const startTime = Date.now();

    try {
      const body = this.buildRequestBody(messages, tools, systemPrompt, false);

      const response = await fetch(OPENROUTER_API_URL, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`OpenRouter API error ${response.status}: ${errorBody}`);
      }

      const data = await response.json();
      return this.parseResponse(data, startTime);
    } catch (error) {
      throw this.createError(
        `OpenRouter generation failed: ${(error as Error).message}`,
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
    if (!this.apiKey) {
      throw this.createError('Provider not initialized', 'NOT_INITIALIZED');
    }

    return new OpenRouterStreamSession(
      this.apiKey,
      this.config as OpenRouterLLMConfig,
      messages,
      tools,
      systemPrompt,
      this.logger,
      events
    );
  }

  async countTokens(messages: ChatMessage[]): Promise<number> {
    // Rough estimation: ~4 chars per token
    const totalChars = messages.reduce((sum, msg) => sum + (msg.content?.length || 0), 0);
    return Math.ceil(totalChars / 4);
  }

  async shutdown(): Promise<void> {
    this.apiKey = '';
    this.isInitialized = false;
    this.logger.info('OpenRouter LLM provider cleaned up');
  }

  private buildHeaders(): Record<string, string> {
    return {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.OPENROUTER_HTTP_REFERER || 'https://ai-calling-app.local',
      'X-Title': process.env.OPENROUTER_SITE_NAME || 'AI Calling System'
    };
  }

  private buildRequestBody(
    messages: ChatMessage[],
    tools?: ToolDefinition[],
    systemPrompt?: string,
    stream: boolean = false
  ): any {
    const orMessages = convertMessages(messages, systemPrompt);
    const orTools = tools && tools.length > 0 ? convertTools(tools) : undefined;

    const body: any = {
      model: this.config.model,
      messages: orMessages,
      stream,
      temperature: this.config.temperature ?? 0.3,
      max_tokens: this.config.maxTokens ?? 2048,
    };

    if (this.config.topP !== undefined) body.top_p = this.config.topP;
    if ((this.config as OpenRouterLLMConfig).seed !== undefined) body.seed = (this.config as OpenRouterLLMConfig).seed;
    if ((this.config as OpenRouterLLMConfig).frequencyPenalty !== undefined) body.frequency_penalty = (this.config as OpenRouterLLMConfig).frequencyPenalty;
    if ((this.config as OpenRouterLLMConfig).presencePenalty !== undefined) body.presence_penalty = (this.config as OpenRouterLLMConfig).presencePenalty;
    if ((this.config as OpenRouterLLMConfig).route) body.route = (this.config as OpenRouterLLMConfig).route;
    if ((this.config as OpenRouterLLMConfig).transforms) body.transforms = (this.config as OpenRouterLLMConfig).transforms;

    if (orTools) {
      body.tools = orTools;
      body.tool_choice = 'auto';
    }

    return body;
  }

  private parseResponse(data: any, startTime: number): LLMResponse {
    const choice = data.choices?.[0];
    if (!choice) {
      throw new Error('No choices in OpenRouter response');
    }

    const message = choice.message;
    const toolCalls: ToolCall[] = [];

    if (message.tool_calls && message.tool_calls.length > 0) {
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
    if (toolCalls.length > 0 || choice.finish_reason === 'tool_calls') {
      finishReason = 'tool_calls';
    } else if (choice.finish_reason === 'length') {
      finishReason = 'length';
    } else if (choice.finish_reason === 'error') {
      finishReason = 'error';
    }

    return {
      content: message.content || '',
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      finishReason,
      usage: {
        promptTokens: data.usage?.prompt_tokens || 0,
        completionTokens: data.usage?.completion_tokens || 0,
        totalTokens: data.usage?.total_tokens || 0
      },
      latencyMs: Date.now() - startTime
    };
  }
}

/**
 * OpenRouter streaming session with SSE parsing
 */
class OpenRouterStreamSession extends LLMStreamSession {
  private apiKey: string;
  private config: OpenRouterLLMConfig;
  private messages: ChatMessage[];
  private tools?: ToolDefinition[];
  private systemPrompt?: string;
  private aborted = false;
  private abortController: AbortController | null = null;

  constructor(
    apiKey: string,
    config: OpenRouterLLMConfig,
    messages: ChatMessage[],
    tools: ToolDefinition[] | undefined,
    systemPrompt: string | undefined,
    logger: Logger,
    events?: LLMStreamEvents
  ) {
    super(events, logger);
    this.apiKey = apiKey;
    this.config = config;
    this.messages = messages;
    this.tools = tools;
    this.systemPrompt = systemPrompt;
  }

  async start(): Promise<void> {
    const startTime = Date.now();
    let firstChunkTime: number | null = null;
    let accumulatedContent = '';

    // Tool call accumulation (streamed incrementally)
    const toolCallsMap = new Map<number, {
      id: string;
      type: string;
      function: {
        name: string;
        arguments: string;
      };
    }>();

    this.abortController = new AbortController();

    try {
      const orMessages = convertMessages(this.messages, this.systemPrompt);
      const orTools = this.tools && this.tools.length > 0 ? convertTools(this.tools) : undefined;

      const body: any = {
        model: this.config.model,
        messages: orMessages,
        stream: true,
        temperature: this.config.temperature ?? 0.3,
        max_tokens: this.config.maxTokens ?? 2048,
      };

      if (this.config.topP !== undefined) body.top_p = this.config.topP;
      if (this.config.seed !== undefined) body.seed = this.config.seed;

      if (orTools) {
        body.tools = orTools;
        body.tool_choice = 'auto';
      }

      this.logger.info('Starting OpenRouter stream', {
        model: this.config.model,
        messageCount: orMessages.length,
        toolCount: orTools?.length || 0,
        tools: orTools?.map((t: any) => t.function.name)
      });

      const response = await fetch(OPENROUTER_API_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': process.env.OPENROUTER_HTTP_REFERER || 'https://ai-calling-app.local',
          'X-Title': process.env.OPENROUTER_SITE_NAME || 'AI Calling System'
        },
        body: JSON.stringify(body),
        signal: this.abortController.signal
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`OpenRouter API error ${response.status}: ${errorBody}`);
      }

      if (!response.body) {
        throw new Error('No response body for streaming');
      }

      // Parse SSE stream
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let promptTokens = 0;
      let completionTokens = 0;
      let finishReason: string | null = null;

      while (true) {
        if (this.aborted) {
          reader.cancel();
          this.logger.info('OpenRouter stream aborted by user');
          break;
        }

        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Process complete SSE lines
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const line of lines) {
          const trimmed = line.trim();

          // Skip empty lines
          if (!trimmed) continue;

          // Skip SSE comments (e.g., ": OPENROUTER PROCESSING")
          if (trimmed.startsWith(':')) continue;

          // Parse data lines
          if (!trimmed.startsWith('data: ')) continue;

          const data = trimmed.slice(6); // Remove "data: " prefix

          // Stream end signal
          if (data === '[DONE]') continue;

          let chunk: any;
          try {
            chunk = JSON.parse(data);
          } catch {
            this.logger.warn('Failed to parse SSE chunk', { data: data.substring(0, 200) });
            continue;
          }

          // Check for mid-stream errors
          if (chunk.error) {
            throw new Error(`OpenRouter stream error: ${chunk.error.message || JSON.stringify(chunk.error)}`);
          }

          if (!firstChunkTime) {
            firstChunkTime = Date.now();
            const ttft = firstChunkTime - startTime;
            this.logger.info('OpenRouter TTFT', { ttft, model: this.config.model });
          }

          const choice = chunk.choices?.[0];

          // Final usage chunk (empty choices array)
          if (chunk.usage && (!chunk.choices || chunk.choices.length === 0)) {
            promptTokens = chunk.usage.prompt_tokens || 0;
            completionTokens = chunk.usage.completion_tokens || 0;
            continue;
          }

          if (!choice) continue;

          const delta = choice.delta;
          if (choice.finish_reason) {
            finishReason = choice.finish_reason;
          }

          if (!delta) continue;

          // Handle content tokens
          if (delta.content) {
            accumulatedContent += delta.content;
            this.processToken(delta.content);
          }

          // Handle streaming tool calls
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
                if (toolCallDelta.function?.name) existing.function.name += toolCallDelta.function.name;
                if (toolCallDelta.function?.arguments) {
                  existing.function.arguments += toolCallDelta.function.arguments;
                }
              }
            }
          }
        }
      }

      // Emit tool calls if any
      let toolCalls: ToolCall[] | undefined = undefined;
      if (toolCallsMap.size > 0) {
        toolCalls = Array.from(toolCallsMap.values()).map(tc => ({
          id: tc.id,
          type: 'function' as const,
          function: {
            name: tc.function.name,
            arguments: tc.function.arguments
          }
        }));

        this.logger.info('OpenRouter tool calls detected', {
          count: toolCalls.length,
          tools: toolCalls.map(tc => tc.function.name)
        });

        for (const toolCall of toolCalls) {
          this.emitToolCall(toolCall);
        }
      }

      // Determine finish reason
      let mappedFinishReason: 'stop' | 'length' | 'tool_calls' | 'error' = 'stop';
      if (toolCalls && toolCalls.length > 0) {
        mappedFinishReason = 'tool_calls';
      } else if (finishReason === 'tool_calls') {
        mappedFinishReason = 'tool_calls';
      } else if (finishReason === 'length') {
        mappedFinishReason = 'length';
      } else if (finishReason === 'error') {
        mappedFinishReason = 'error';
      }

      this.emitComplete({
        content: accumulatedContent,
        finishReason: mappedFinishReason,
        toolCalls,
        usage: {
          promptTokens,
          completionTokens,
          totalTokens: promptTokens + completionTokens
        },
        latencyMs: Date.now() - startTime
      });

    } catch (error) {
      if (this.aborted && (error as any)?.name === 'AbortError') {
        // Expected abort, don't emit error
        return;
      }
      this.logger.error('OpenRouter stream error', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
      this.emitError(error as Error);
    }
  }

  abort(): void {
    this.aborted = true;
    this.abortController?.abort();
  }
}

// ============================================================================
// Shared utility functions
// ============================================================================

function convertMessages(messages: ChatMessage[], systemPrompt?: string): any[] {
  const orMessages: any[] = [];

  if (systemPrompt) {
    orMessages.push({
      role: 'system',
      content: systemPrompt
    });
  }

  for (const msg of messages) {
    if (msg.role === 'system') {
      orMessages.push({
        role: 'system',
        content: msg.content
      });
    } else if (msg.role === 'user') {
      orMessages.push({
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

      orMessages.push(assistantMsg);
    } else if (msg.role === 'tool') {
      orMessages.push({
        role: 'tool',
        tool_call_id: msg.toolCallId,
        name: msg.name,
        content: msg.content || 'No result'
      });
    }
  }

  return orMessages;
}

function convertTools(tools: ToolDefinition[]): any[] {
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

// Register the provider
import { LLMProviderFactory } from '../base/llm-provider';
LLMProviderFactory.register('openrouter', OpenRouterLLMProvider);

export default OpenRouterLLMProvider;
