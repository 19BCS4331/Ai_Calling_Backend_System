/**
 * TTS Provider Abstract Base Class
 * All TTS providers must implement this interface
 */

import {
  TTSConfig,
  TTSResult,
  TTSStreamEvents,
  ProviderError,
  Logger,
  SupportedLanguage,
  VoiceConfig,
  AudioFormat
} from '../../types';

export interface TTSProviderCapabilities {
  supportsStreaming: boolean;
  supportedLanguages: SupportedLanguage[];
  supportedVoices: VoiceInfo[];
  supportedAudioFormats: string[];
  supportsSSML: boolean;
  maxTextLength: number;
}

export interface VoiceInfo {
  id: string;
  name: string;
  language: SupportedLanguage;
  gender: 'male' | 'female' | 'neutral';
  description?: string;
}

export abstract class TTSProvider {
  protected config: TTSConfig;
  protected logger: Logger;
  protected isInitialized: boolean = false;

  constructor(config: TTSConfig, logger: Logger) {
    this.config = config;
    this.logger = logger.child({ provider: this.getName(), type: 'tts' });
  }

  /**
   * Get the provider name
   */
  abstract getName(): string;

  /**
   * Get provider capabilities
   */
  abstract getCapabilities(): TTSProviderCapabilities;

  /**
   * Initialize the provider
   */
  abstract initialize(): Promise<void>;

  /**
   * Synthesize speech from text (non-streaming)
   * Returns complete audio buffer
   */
  abstract synthesize(
    text: string,
    voice?: VoiceConfig,
    language?: SupportedLanguage
  ): Promise<TTSResult>;

  /**
   * Create a streaming TTS session
   * Streams audio chunks as they are generated
   */
  abstract createStreamingSession(
    events: TTSStreamEvents,
    voice?: VoiceConfig,
    language?: SupportedLanguage
  ): TTSStreamSession;

  /**
   * Get available voices for a language
   */
  abstract getVoices(language?: SupportedLanguage): Promise<VoiceInfo[]>;

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
  }

  /**
   * Check if language is supported
   */
  protected isLanguageSupported(language: SupportedLanguage): boolean {
    const capabilities = this.getCapabilities();
    return capabilities.supportedLanguages.includes(language);
  }

  /**
   * Get default voice for language
   */
  protected getDefaultVoice(language: SupportedLanguage): VoiceConfig {
    return this.config.voice || {
      voiceId: 'default',
      language,
      gender: 'female'
    };
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
 * Streaming TTS Session
 * Manages a single streaming TTS session
 */
export abstract class TTSStreamSession {
  protected events: TTSStreamEvents;
  protected logger: Logger;
  protected isActive: boolean = false;
  protected startTime: number = 0;
  protected totalAudioBytes: number = 0;

  constructor(events: TTSStreamEvents, logger: Logger) {
    this.events = events;
    this.logger = logger;
  }

  /**
   * Start the streaming session with initial configuration
   */
  abstract start(): Promise<void>;

  /**
   * Send text to be synthesized
   * Can be called multiple times for streaming text input
   */
  abstract sendText(text: string): void;

  /**
   * Signal that no more text will be sent
   * Waits for all audio to be generated
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
   * Get total audio bytes generated
   */
  getTotalAudioBytes(): number {
    return this.totalAudioBytes;
  }

  /**
   * Emit audio chunk event
   */
  protected emitAudioChunk(chunk: Buffer): void {
    this.totalAudioBytes += chunk.length;
    this.events.onAudioChunk(chunk);
  }

  /**
   * Emit completion event
   */
  protected emitComplete(result: TTSResult): void {
    this.isActive = false;
    result.latencyMs = Date.now() - this.startTime;
    this.events.onComplete(result);
  }

  /**
   * Emit error event
   */
  protected emitError(error: Error): void {
    this.logger.error('TTS stream error', { error: error.message });
    this.events.onError(error);
  }
}

/**
 * Factory for creating TTS providers
 */
export class TTSProviderFactory {
  private static providers: Map<string, new (config: TTSConfig, logger: Logger) => TTSProvider> = new Map();

  /**
   * Register a provider implementation
   */
  static register(
    type: string,
    providerClass: new (config: TTSConfig, logger: Logger) => TTSProvider
  ): void {
    this.providers.set(type, providerClass);
  }

  /**
   * Create a provider instance
   */
  static create(config: TTSConfig, logger: Logger): TTSProvider {
    const ProviderClass = this.providers.get(config.type);
    if (!ProviderClass) {
      throw new ProviderError(
        `Unknown TTS provider: ${config.type}`,
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
