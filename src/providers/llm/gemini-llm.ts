/**
 * Google Gemini LLM Provider
 * Implements streaming chat with function calling using @google/genai SDK
 * 
 * API Reference: https://ai.google.dev/gemini-api/docs/function-calling
 */

import { GoogleGenAI, Type, Content, Part, FunctionCall, GenerateContentResponse } from '@google/genai';
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

interface GeminiLLMConfig extends LLMConfig {
  model: string;
  safetySettings?: any[];
  generationConfig?: {
    temperature?: number;
    topP?: number;
    topK?: number;
    maxOutputTokens?: number;
    stopSequences?: string[];
  };
}

export class GeminiLLMProvider extends LLMProvider {
  private client: GoogleGenAI | null = null;

  constructor(config: GeminiLLMConfig, logger: Logger) {
    super(config, logger);
  }

  getName(): string {
    return 'gemini';
  }

  getCapabilities(): LLMProviderCapabilities {
    return {
      supportsStreaming: true,
      supportsFunctionCalling: true,
      supportsParallelToolCalls: true,
      supportsVision: true,
      maxContextTokens: 1000000, // Gemini 2.5 Flash supports 1M tokens
      maxOutputTokens: 8192
    };
  }

  async initialize(): Promise<void> {
    this.validateConfig();
    
    this.client = new GoogleGenAI({
      apiKey: this.config.credentials.apiKey
    });
    
    this.isInitialized = true;
    this.logger.info('Gemini LLM provider initialized', { model: this.config.model });
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
      const contents = this.convertMessages(messages);
      const functionDeclarations = tools ? this.convertTools(tools) : undefined;

      const response = await this.client.models.generateContent({
        model: this.config.model,
        contents: contents,
        config: {
          systemInstruction: systemPrompt || this.config.systemPrompt,
          tools: functionDeclarations ? [{ functionDeclarations }] : undefined,
          temperature: this.config.temperature ?? 0.7,
          topP: this.config.topP ?? 0.95,
          topK: this.config.topK ?? 40,
          maxOutputTokens: this.config.maxTokens ?? 2048
        }
      });

      return this.parseResponse(response, startTime);
    } catch (error) {
      throw this.createError(
        `Gemini generation failed: ${(error as Error).message}`,
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

    const contents = this.convertMessages(messages);
    const functionDeclarations = tools ? this.convertTools(tools) : undefined;

    return new GeminiStreamSession(
      events,
      this.logger,
      this.client,
      {
        model: this.config.model,
        contents,
        systemPrompt: systemPrompt || this.config.systemPrompt,
        tools: functionDeclarations,
        temperature: this.config.temperature ?? 0.7,
        topP: this.config.topP ?? 0.95,
        topK: this.config.topK ?? 40,
        maxOutputTokens: this.config.maxTokens ?? 2048
      }
    );
  }

  async countTokens(messages: ChatMessage[]): Promise<number> {
    if (!this.client) {
      throw this.createError('Provider not initialized', 'NOT_INITIALIZED');
    }

    try {
      const contents = this.convertMessages(messages);
      const result = await this.client.models.countTokens({
        model: this.config.model,
        contents
      });
      return result.totalTokens || 0;
    } catch (error) {
      this.logger.warn('Token counting failed, returning estimate', { error });
      // Rough estimate: 4 chars per token
      const totalChars = messages.reduce((sum, m) => sum + m.content.length, 0);
      return Math.ceil(totalChars / 4);
    }
  }

  private convertMessages(messages: ChatMessage[]): Content[] {
    return messages.map(msg => {
      const parts: Part[] = [];

      if (msg.content) {
        parts.push({ text: msg.content });
      }

      // Handle tool results
      if (msg.role === 'tool' && msg.toolCallId) {
        return {
          role: 'function' as const,
          parts: [{
            functionResponse: {
              name: msg.name || 'unknown',
              response: { result: msg.content }
            }
          }]
        };
      }

      // Handle tool calls in assistant messages
      if (msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          parts.push({
            functionCall: {
              name: tc.function.name,
              args: JSON.parse(tc.function.arguments)
            }
          });
        }
      }

      return {
        role: this.mapRole(msg.role),
        parts
      };
    });
  }

  private mapRole(role: string): 'user' | 'model' {
    switch (role) {
      case 'user':
        return 'user';
      case 'assistant':
      case 'system':
      default:
        return 'model';
    }
  }

  private convertTools(tools: ToolDefinition[]): any[] {
    // Deduplicate tools by sanitized name to avoid Gemini API errors
    const seenNames = new Set<string>();
    const uniqueTools: any[] = [];
    
    for (const tool of tools) {
      const sanitizedName = this.sanitizeToolName(tool.name);
      
      // Skip duplicate tool names
      if (seenNames.has(sanitizedName)) {
        this.logger.warn('Skipping duplicate tool', { original: tool.name, sanitized: sanitizedName });
        continue;
      }
      
      seenNames.add(sanitizedName);
      uniqueTools.push({
        name: sanitizedName,
        description: tool.description,
        parameters: {
          type: Type.OBJECT,
          properties: this.convertProperties(tool.parameters.properties),
          required: tool.parameters.required || []
        }
      });
    }
    
    this.logger.info('Converted tools for Gemini', {
      originalCount: tools.length,
      uniqueCount: uniqueTools.length,
      toolNames: uniqueTools.map(t => t.name)
    });
    
    return uniqueTools;
  }

  /**
   * Sanitize tool name to conform to Gemini's requirements:
   * - Must start with a letter or underscore
   * - Must be alphanumeric (a-z, A-Z, 0-9), underscores (_), dots (.), colons (:), or dashes (-)
   * - Maximum length of 64 characters
   */
  private sanitizeToolName(name: string): string {
    // Replace invalid characters with underscores
    let sanitized = name.replace(/[^a-zA-Z0-9_.\-:]/g, '_');
    
    // Ensure it starts with a letter or underscore
    if (!/^[a-zA-Z_]/.test(sanitized)) {
      sanitized = '_' + sanitized;
    }
    
    // Truncate to 64 characters max
    if (sanitized.length > 64) {
      sanitized = sanitized.substring(0, 64);
    }
    
    return sanitized;
  }

  private convertProperties(properties: Record<string, any>): Record<string, any> {
    const converted: Record<string, any> = {};
    
    for (const [key, prop] of Object.entries(properties)) {
      converted[key] = {
        type: this.mapType(prop.type),
        description: prop.description,
        ...(prop.enum && { enum: prop.enum }),
        ...(prop.items && { items: this.convertProperties({ item: prop.items }).item })
      };
    }
    
    return converted;
  }

  private mapType(type: string): any {
    const typeMap: Record<string, any> = {
      'string': Type.STRING,
      'number': Type.NUMBER,
      'boolean': Type.BOOLEAN,
      'array': Type.ARRAY,
      'object': Type.OBJECT
    };
    return typeMap[type] || Type.STRING;
  }

  private parseResponse(response: GenerateContentResponse, startTime: number): LLMResponse {
    const candidate = response.candidates?.[0];
    const content = candidate?.content;
    
    let textContent = '';
    const toolCalls: ToolCall[] = [];

    if (content?.parts) {
      for (const part of content.parts) {
        if (part.text) {
          textContent += part.text;
        }
        if (part.functionCall) {
          toolCalls.push({
            id: `call_${Date.now()}_${toolCalls.length}`,
            type: 'function',
            function: {
              name: part.functionCall.name || '',
              arguments: JSON.stringify(part.functionCall.args || {})
            }
          });
        }
      }
    }

    let finishReason: 'stop' | 'tool_calls' | 'length' | 'error' = 'stop';
    if (toolCalls.length > 0) {
      finishReason = 'tool_calls';
    } else if (candidate?.finishReason === 'MAX_TOKENS') {
      finishReason = 'length';
    }

    return {
      content: textContent,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      finishReason,
      usage: {
        promptTokens: response.usageMetadata?.promptTokenCount || 0,
        completionTokens: response.usageMetadata?.candidatesTokenCount || 0,
        totalTokens: response.usageMetadata?.totalTokenCount || 0
      },
      latencyMs: Date.now() - startTime
    };
  }
}

interface GeminiStreamConfig {
  model: string;
  contents: Content[];
  systemPrompt?: string;
  tools?: any[];
  temperature: number;
  topP: number;
  topK: number;
  maxOutputTokens: number;
}

class GeminiStreamSession extends LLMStreamSession {
  private client: GoogleGenAI;
  private streamConfig: GeminiStreamConfig;
  private abortController: AbortController | null = null;

  constructor(
    events: LLMStreamEvents | undefined,
    logger: Logger,
    client: GoogleGenAI,
    config: GeminiStreamConfig
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
      const response = await this.client.models.generateContentStream({
        model: this.streamConfig.model,
        contents: this.streamConfig.contents,
        config: {
          systemInstruction: this.streamConfig.systemPrompt,
          tools: this.streamConfig.tools ? [{ functionDeclarations: this.streamConfig.tools }] : undefined,
          temperature: this.streamConfig.temperature,
          topP: this.streamConfig.topP,
          topK: this.streamConfig.topK,
          maxOutputTokens: this.streamConfig.maxOutputTokens
        }
      });

      let fullContent = '';
      const toolCalls: ToolCall[] = [];
      let promptTokens = 0;
      let completionTokens = 0;

      for await (const chunk of response) {
        if (!this.isActive) break;

        const candidate = chunk.candidates?.[0];
        const content = candidate?.content;

        if (content?.parts) {
          for (const part of content.parts) {
            if (part.text) {
              fullContent += part.text;
              this.processToken(part.text);
            }
            if (part.functionCall) {
              this.logger.info('Gemini function call detected', {
                name: part.functionCall.name,
                args: part.functionCall.args
              });
              
              const toolCall: ToolCall = {
                id: `call_${Date.now()}_${toolCalls.length}`,
                type: 'function',
                function: {
                  name: part.functionCall.name || '',
                  arguments: JSON.stringify(part.functionCall.args || {})
                }
              };
              toolCalls.push(toolCall);
              this.emitToolCall(toolCall);
            }
          }
        }

        // Update usage metadata
        if (chunk.usageMetadata) {
          promptTokens = chunk.usageMetadata.promptTokenCount || 0;
          completionTokens = chunk.usageMetadata.candidatesTokenCount || 0;
        }
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
LLMProviderFactory.register('gemini', GeminiLLMProvider as any);

export default GeminiLLMProvider;
