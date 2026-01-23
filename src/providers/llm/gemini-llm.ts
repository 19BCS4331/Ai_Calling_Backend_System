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
  
  // Explicit caching for guaranteed cost savings
  // Minimum: 1024 tokens for Gemini 2.5 Flash
  // Creates cache with system prompt + tools, reuses for all requests in session
  private cachedContentName: string | null = null;
  private cacheCreationPromise: Promise<string | null> | null = null;
  private cachedSystemPrompt: string | null = null;
  private cachedToolsHash: string | null = null;

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

  /**
   * Pre-warm cache with system prompt and tools before first user input
   * This eliminates ~1.5s latency on the first LLM request
   * Call this during pipeline startup after tools are registered
   */
  async prewarmCache(systemPrompt?: string, tools?: ToolDefinition[]): Promise<void> {
    if (!this.client) {
      this.logger.warn('Cannot prewarm cache - provider not initialized');
      return;
    }

    // Nothing to cache
    if (!systemPrompt && (!tools || tools.length === 0)) {
      this.logger.debug('Skipping cache prewarm - no system prompt or tools');
      return;
    }

    const functionDeclarations = tools ? this.convertTools(tools) : undefined;
    const effectiveSystemPrompt = systemPrompt || this.config.systemPrompt;

    this.logger.info('Pre-warming Gemini cache', {
      hasSystemPrompt: !!effectiveSystemPrompt,
      systemPromptLength: effectiveSystemPrompt?.length || 0,
      toolCount: tools?.length || 0
    });

    const startTime = Date.now();

    // Create cache asynchronously (don't block pipeline start)
    await this.getOrCreateCache(effectiveSystemPrompt, functionDeclarations);

    const duration = Date.now() - startTime;
    this.logger.info('Cache pre-warming complete', {
      durationMs: duration,
      cacheName: this.cachedContentName
    });
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
    const effectiveSystemPrompt = systemPrompt || this.config.systemPrompt;

    // Get or create explicit cache for system prompt + tools
    const cacheName = await this.getOrCreateCache(effectiveSystemPrompt, functionDeclarations);
    
    return new GeminiStreamSession(
      events,
      this.logger,
      this.client,
      {
        model: this.config.model,
        contents,
        // If cache exists, reference it instead of sending system prompt + tools
        cachedContentName: cacheName,
        systemPrompt: cacheName ? undefined : effectiveSystemPrompt,
        tools: cacheName ? undefined : functionDeclarations,
        temperature: this.config.temperature ?? 0.7,
        topP: this.config.topP ?? 0.95,
        topK: this.config.topK ?? 40,
        maxOutputTokens: this.config.maxTokens ?? 2048
      }
    );
  }

  /**
   * Get existing cache or create a new one for system prompt + tools
   * Uses explicit caching API for guaranteed cost savings
   */
  private async getOrCreateCache(
    systemPrompt?: string,
    tools?: any[]
  ): Promise<string | null> {
    if (!this.client) return null;
    
    // Nothing to cache
    if (!systemPrompt && (!tools || tools.length === 0)) {
      return null;
    }

    // Check if we already have a valid cache
    const toolsHash = tools ? JSON.stringify(tools).slice(0, 100) : '';
    if (this.cachedContentName && 
        this.cachedSystemPrompt === systemPrompt && 
        this.cachedToolsHash === toolsHash) {
      return this.cachedContentName;
    }

    // If cache creation is in progress, wait for it
    if (this.cacheCreationPromise) {
      return this.cacheCreationPromise;
    }

    // Create new cache
    this.cacheCreationPromise = this.createExplicitCache(systemPrompt, tools);
    const cacheName = await this.cacheCreationPromise;
    this.cacheCreationPromise = null;
    
    if (cacheName) {
      this.cachedContentName = cacheName;
      this.cachedSystemPrompt = systemPrompt || null;
      this.cachedToolsHash = toolsHash;
    }
    
    return cacheName;
  }

  /**
   * Create explicit cache with system prompt + tools
   * Requires model version suffix (e.g., gemini-2.5-flash-preview-05-20)
   */
  private async createExplicitCache(
    systemPrompt?: string,
    tools?: any[]
  ): Promise<string | null> {
    if (!this.client) return null;

    try {
      // Model must have explicit version for caching
      const modelForCache = this.config.model.includes('-') 
        ? `models/${this.config.model}` 
        : `models/${this.config.model}-preview-05-20`;

      this.logger.info('Creating explicit cache', {
        model: modelForCache,
        hasSystemPrompt: !!systemPrompt,
        systemPromptLength: systemPrompt?.length || 0,
        toolCount: tools?.length || 0
      });

      const cache = await this.client.caches.create({
        model: modelForCache,
        config: {
          displayName: `voice-agent-cache-${Date.now()}`,
          systemInstruction: systemPrompt,
          tools: tools ? [{ functionDeclarations: tools }] : undefined,
          ttl: '3600s', // 1 hour TTL
        }
      });

      if (cache?.name) {
        this.logger.info('Explicit cache created', {
          cacheName: cache.name,
          usageMetadata: (cache as any).usageMetadata
        });
        return cache.name;
      }
      
      return null;
    } catch (error) {
      this.logger.warn('Failed to create explicit cache, falling back to no cache', {
        error: (error as Error).message
      });
      return null;
    }
  }

  /**
   * Clean up resources when the session ends
   */
  async cleanup(): Promise<void> {
    if (this.cachedContentName && this.client) {
      try {
        await this.client.caches.delete({ name: this.cachedContentName });
        this.logger.info('Explicit cache deleted', { cacheName: this.cachedContentName });
      } catch (error) {
        this.logger.warn('Failed to delete cache', { error: (error as Error).message });
      }
    }
    this.cachedContentName = null;
    this.cachedSystemPrompt = null;
    this.cachedToolsHash = null;
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
  cachedContentName?: string | null;  // Explicit cache reference
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
      // Build config - use explicit cache if available for guaranteed savings
      const config: any = {
        temperature: this.streamConfig.temperature,
        topP: this.streamConfig.topP,
        topK: this.streamConfig.topK,
        maxOutputTokens: this.streamConfig.maxOutputTokens
      };

      // If we have an explicit cache, reference it (system prompt + tools are cached)
      if (this.streamConfig.cachedContentName) {
        config.cachedContent = this.streamConfig.cachedContentName;
        this.logger.info('Using explicit cache', {
          cacheName: this.streamConfig.cachedContentName
        });
      } else {
        // No cache - send system prompt and tools directly
        if (this.streamConfig.systemPrompt) {
          config.systemInstruction = this.streamConfig.systemPrompt;
        }
        if (this.streamConfig.tools) {
          config.tools = [{ functionDeclarations: this.streamConfig.tools }];
        }
      }

      const response = await this.client.models.generateContentStream({
        model: this.streamConfig.model,
        contents: this.streamConfig.contents,
        config
      });

      let fullContent = '';
      const toolCalls: ToolCall[] = [];
      let promptTokens = 0;
      let completionTokens = 0;
      let cachedContentTokenCount = 0;

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

        // Update usage metadata - includes cachedContentTokenCount for explicit caching
        if (chunk.usageMetadata) {
          promptTokens = chunk.usageMetadata.promptTokenCount || 0;
          completionTokens = chunk.usageMetadata.candidatesTokenCount || 0;
          
          const metadata = chunk.usageMetadata as any;
          cachedContentTokenCount = metadata.cachedContentTokenCount || 0;
          
          // Log token usage with cache info
          this.logger.info('Gemini token usage', {
            promptTokens,
            completionTokens,
            cachedContentTokenCount,
            // Calculate savings: cached tokens get 75% discount
            effectiveCost: cachedContentTokenCount > 0 
              ? `${promptTokens - (cachedContentTokenCount * 0.75)} effective tokens (${Math.round((cachedContentTokenCount / promptTokens) * 100)}% cached)`
              : `${promptTokens} tokens (no cache)`
          });
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
          totalTokens: promptTokens + completionTokens,
          cachedContentTokenCount
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
