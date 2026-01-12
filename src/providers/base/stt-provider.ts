/**
 * STT Provider Abstract Base Class
 * All STT providers must implement this interface
 */

import { Readable, Transform } from 'stream';
import {
  STTConfig,
  TranscriptionResult,
  STTStreamEvents,
  ProviderError,
  Logger,
  SupportedLanguage
} from '../../types';

export interface STTProviderCapabilities {
  supportsStreaming: boolean;
  supportedLanguages: SupportedLanguage[];
  supportedEncodings: string[];
  supportsWordTimestamps: boolean;
  supportsPunctuation: boolean;
  supportsInterimResults: boolean;
  maxAudioDurationSeconds: number;
}

export abstract class STTProvider {
  protected config: STTConfig;
  protected logger: Logger;
  protected isInitialized: boolean = false;

  constructor(config: STTConfig, logger: Logger) {
    this.config = config;
    this.logger = logger.child({ provider: this.getName(), type: 'stt' });
  }

  /**
   * Get the provider name
   */
  abstract getName(): string;

  /**
   * Get provider capabilities
   */
  abstract getCapabilities(): STTProviderCapabilities;

  /**
   * Initialize the provider (connect, validate credentials, etc.)
   */
  abstract initialize(): Promise<void>;

  /**
   * Transcribe a complete audio buffer
   * Used for non-streaming scenarios
   */
  abstract transcribe(
    audio: Buffer,
    language?: SupportedLanguage
  ): Promise<TranscriptionResult>;

  /**
   * Create a streaming transcription session
   * Returns a transform stream that accepts audio chunks and emits transcription events
   */
  abstract createStreamingSession(
    events: STTStreamEvents,
    language?: SupportedLanguage
  ): STTStreamSession;

  /**
   * Validate the configuration
   */
  protected validateConfig(): void {
    if (!this.config.credentials?.apiKey) {
      throw new ProviderError(
        'API key is required',
        this.getName(),
        'INVALID_CONFIG'
      );
    }
  }

  /**
   * Check if language is supported
   */
  protected isLanguageSupported(language: SupportedLanguage): boolean {
    const capabilities = this.getCapabilities();
    return capabilities.supportedLanguages.includes(language) || language === 'auto';
  }

  /**
   * Get the effective language (resolve 'auto' to default)
   */
  protected getEffectiveLanguage(language?: SupportedLanguage): SupportedLanguage {
    return language || this.config.language || 'en-IN';
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
 * Streaming STT Session
 * Manages a single streaming transcription session
 */
export abstract class STTStreamSession {
  protected events: STTStreamEvents;
  protected logger: Logger;
  protected isActive: boolean = false;
  protected startTime: number = 0;

  constructor(events: STTStreamEvents, logger: Logger) {
    this.events = events;
    this.logger = logger;
  }

  /**
   * Start the streaming session
   */
  abstract start(): Promise<void>;

  /**
   * Write audio data to the stream
   */
  abstract write(audioChunk: Buffer): void;

  /**
   * Signal end of audio input
   */
  abstract end(): Promise<void>;

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
   * Emit partial transcript
   */
  protected emitPartial(result: TranscriptionResult): void {
    result.latencyMs = Date.now() - this.startTime;
    this.events.onPartialTranscript(result);
  }

  /**
   * Emit final transcript
   */
  protected emitFinal(result: TranscriptionResult): void {
    result.latencyMs = Date.now() - this.startTime;
    this.events.onFinalTranscript(result);
  }

  /**
   * Emit error
   */
  protected emitError(error: Error): void {
    this.logger.error('STT stream error', { error: error.message });
    this.events.onError(error);
  }

  /**
   * Emit end of stream
   */
  protected emitEnd(): void {
    this.isActive = false;
    this.events.onEnd();
  }
}

/**
 * Factory for creating STT providers
 */
export class STTProviderFactory {
  private static providers: Map<string, new (config: STTConfig, logger: Logger) => STTProvider> = new Map();

  /**
   * Register a provider implementation
   */
  static register(
    type: string,
    providerClass: new (config: STTConfig, logger: Logger) => STTProvider
  ): void {
    this.providers.set(type, providerClass);
  }

  /**
   * Create a provider instance
   */
  static create(config: STTConfig, logger: Logger): STTProvider {
    const ProviderClass = this.providers.get(config.type);
    if (!ProviderClass) {
      throw new ProviderError(
        `Unknown STT provider: ${config.type}`,
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
