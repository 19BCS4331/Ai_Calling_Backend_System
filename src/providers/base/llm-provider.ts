/**
 * LLM Provider Abstract Base Class
 * All LLM providers must implement this interface
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

export interface LLMProviderCapabilities {
  supportsStreaming: boolean;
  supportsFunctionCalling: boolean;
  supportsParallelToolCalls: boolean;
  supportsVision: boolean;
  maxContextTokens: number;
  maxOutputTokens: number;
}

export abstract class LLMProvider {
  protected config: LLMConfig;
  protected logger: Logger;
  protected isInitialized: boolean = false;

  constructor(config: LLMConfig, logger: Logger) {
    this.config = config;
    this.logger = logger.child({ provider: this.getName(), type: 'llm' });
  }

  /**
   * Get the provider name
   */
  abstract getName(): string;

  /**
   * Get provider capabilities
   */
  abstract getCapabilities(): LLMProviderCapabilities;

  /**
   * Initialize the provider
   */
  abstract initialize(): Promise<void>;

  /**
   * Generate a response (non-streaming)
   */
  abstract generate(
    messages: ChatMessage[],
    tools?: ToolDefinition[],
    systemPrompt?: string
  ): Promise<LLMResponse>;

  /**
   * Generate a streaming response
   * Returns a stream that emits LLMStreamChunks
   */
  abstract generateStream(
    messages: ChatMessage[],
    tools?: ToolDefinition[],
    systemPrompt?: string,
    events?: LLMStreamEvents
  ): Promise<LLMStreamSession>;

  /**
   * Count tokens in messages (for cost estimation)
   */
  abstract countTokens(messages: ChatMessage[]): Promise<number>;

  /**
   * Validate configuration
   */
  protected validateConfig(): void {
    if (!this.config.credentials?.apiKey) {
      throw new ProviderError(
        'API key is required',
        this.getName(),
        'INVALID_CONFIG'
      );
    }
    if (!this.config.model) {
      throw new ProviderError(
        'Model name is required',
        this.getName(),
        'INVALID_CONFIG'
      );
    }
  }

  /**
   * Create a provider error with context
   */
  protected createError(
    message: string,
    code: string,
    retryable: boolean = false,
    originalError?: Error
  ): ProviderError {
    return new ProviderError(
      message,
      this.getName(),
      code,
      retryable,
      originalError
    );
  }

  /**
   * Cleanup resources
   */
  async shutdown(): Promise<void> {
    this.isInitialized = false;
    this.logger.info('Provider shutdown complete');
  }
}

/**
 * LLM Streaming Session
 * Manages a single streaming generation session with sentence-level chunking
 */
export abstract class LLMStreamSession {
  protected events?: LLMStreamEvents;
  protected logger: Logger;
  protected isActive: boolean = false;
  protected startTime: number = 0;
  protected accumulatedContent: string = '';
  protected sentenceBuffer: string = '';

  constructor(events: LLMStreamEvents | undefined, logger: Logger) {
    this.events = events;
    this.logger = logger;
  }

  /**
   * Start the streaming session
   */
  abstract start(): Promise<void>;

  /**
   * Abort the streaming session
   */
  abstract abort(): void;

  /**
   * Check if session is active
   */
  isSessionActive(): boolean {
    return this.isActive;
  }

  /**
   * Get session duration in milliseconds
   */
  getSessionDuration(): number {
    if (this.startTime === 0) return 0;
    return Date.now() - this.startTime;
  }

  /**
   * Process incoming token and emit sentence when complete
   * Sentence detection for low-latency TTS chunking
   */
  protected processToken(token: string): void {
    this.accumulatedContent += token;
    this.sentenceBuffer += token;

    // Emit token event
    if (this.events?.onToken) {
      this.events.onToken({
        content: token,
        isComplete: false
      });
    }

    // Check for sentence boundaries for TTS chunking
    const sentenceEnders = /[.!?।॥]\s*$/;
    const colonNewline = /:\s*\n/;
    
    if (sentenceEnders.test(this.sentenceBuffer) || colonNewline.test(this.sentenceBuffer)) {
      const sentence = this.sentenceBuffer.trim();
      if (sentence.length > 0 && this.events?.onSentence) {
        this.events.onSentence(sentence);
      }
      this.sentenceBuffer = '';
    }
  }

  /**
   * Flush any remaining content as final sentence
   */
  protected flushSentenceBuffer(): void {
    if (this.sentenceBuffer.trim().length > 0 && this.events?.onSentence) {
      this.events.onSentence(this.sentenceBuffer.trim());
    }
    this.sentenceBuffer = '';
  }

  /**
   * Emit tool call event
   */
  protected emitToolCall(toolCall: ToolCall): void {
    if (this.events?.onToolCall) {
      this.events.onToolCall(toolCall);
    }
  }

  /**
   * Emit completion event
   */
  protected emitComplete(response: LLMResponse): void {
    this.flushSentenceBuffer();
    this.isActive = false;
    if (this.events?.onComplete) {
      this.events.onComplete(response);
    }
  }

  /**
   * Emit error event
   */
  protected emitError(error: Error): void {
    this.logger.error('LLM stream error', { error: error.message });
    if (this.events?.onError) {
      this.events.onError(error);
    }
  }
}

/**
 * Factory for creating LLM providers
 */
export class LLMProviderFactory {
  private static providers: Map<string, new (config: LLMConfig, logger: Logger) => LLMProvider> = new Map();

  /**
   * Register a provider implementation
   */
  static register(
    type: string,
    providerClass: new (config: LLMConfig, logger: Logger) => LLMProvider
  ): void {
    this.providers.set(type, providerClass);
  }

  /**
   * Create a provider instance
   */
  static create(config: LLMConfig, logger: Logger): LLMProvider {
    const ProviderClass = this.providers.get(config.type);
    if (!ProviderClass) {
      throw new ProviderError(
        `Unknown LLM provider: ${config.type}`,
        'factory',
        'UNKNOWN_PROVIDER'
      );
    }
    return new ProviderClass(config, logger);
  }

  /**
   * Get list of registered providers
   */
  static getRegisteredProviders(): string[] {
    return Array.from(this.providers.keys());
  }
}
