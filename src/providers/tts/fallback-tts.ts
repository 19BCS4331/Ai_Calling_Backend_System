/**
 * Fallback TTS Provider
 * Wraps multiple TTS providers and falls back to alternatives if primary fails
 * 
 * Features:
 * - Primary/fallback provider chain
 * - Automatic failover on errors
 * - Optional parallel hedging (race multiple providers)
 */

import {
  TTSConfig,
  TTSResult,
  TTSStreamEvents,
  Logger,
  SupportedLanguage,
  VoiceConfig
} from '../../types';
import { TTSProvider, TTSProviderCapabilities, TTSStreamSession, VoiceInfo, TTSProviderFactory } from '../base/tts-provider';

export interface FallbackTTSConfig extends TTSConfig {
  primaryProvider: TTSConfig;
  fallbackProviders: TTSConfig[];
  enableHedging?: boolean;  // If true, race multiple providers
  hedgingDelayMs?: number;  // Delay before starting fallback in hedging mode
  maxRetries?: number;
}

export class FallbackTTSProvider extends TTSProvider {
  private primaryProvider: TTSProvider;
  private fallbackProviders: TTSProvider[] = [];
  private fallbackConfig: FallbackTTSConfig;

  constructor(config: FallbackTTSConfig, logger: Logger) {
    super(config, logger);
    this.fallbackConfig = config;
    
    // Create primary provider
    this.primaryProvider = TTSProviderFactory.create(config.primaryProvider, logger);
    
    // Create fallback providers
    for (const fallbackConfig of config.fallbackProviders) {
      this.fallbackProviders.push(TTSProviderFactory.create(fallbackConfig, logger));
    }
    
    this.logger.info('Fallback TTS provider initialized', {
      primary: config.primaryProvider.type,
      fallbacks: config.fallbackProviders.map(f => f.type),
      hedging: config.enableHedging
    });
  }

  getName(): string {
    return 'fallback';
  }

  getCapabilities(): TTSProviderCapabilities {
    // Return primary provider's capabilities
    return this.primaryProvider.getCapabilities();
  }

  async initialize(): Promise<void> {
    // Initialize all providers
    await this.primaryProvider.initialize();
    for (const fallback of this.fallbackProviders) {
      await fallback.initialize();
    }
    this.isInitialized = true;
  }

  async synthesize(
    text: string,
    voice?: VoiceConfig,
    language?: SupportedLanguage
  ): Promise<TTSResult> {
    const providers = [this.primaryProvider, ...this.fallbackProviders];
    
    if (this.fallbackConfig.enableHedging) {
      return this.synthesizeWithHedging(text, voice, language, providers);
    }
    
    return this.synthesizeWithFallback(text, voice, language, providers);
  }

  private async synthesizeWithFallback(
    text: string,
    voice: VoiceConfig | undefined,
    language: SupportedLanguage | undefined,
    providers: TTSProvider[]
  ): Promise<TTSResult> {
    let lastError: Error | null = null;
    
    for (const provider of providers) {
      try {
        this.logger.debug('Attempting TTS synthesis', { provider: provider.getName() });
        const result = await provider.synthesize(text, voice, language);
        return result;
      } catch (error) {
        lastError = error as Error;
        this.logger.warn('TTS provider failed, trying fallback', {
          provider: provider.getName(),
          error: lastError.message
        });
      }
    }
    
    throw lastError || new Error('All TTS providers failed');
  }

  private async synthesizeWithHedging(
    text: string,
    voice: VoiceConfig | undefined,
    language: SupportedLanguage | undefined,
    providers: TTSProvider[]
  ): Promise<TTSResult> {
    const hedgingDelay = this.fallbackConfig.hedgingDelayMs || 200;
    
    // Start primary immediately
    const primaryPromise = this.primaryProvider.synthesize(text, voice, language);
    
    // Start fallbacks after delay
    const fallbackPromises = this.fallbackProviders.map((provider, index) => {
      return new Promise<TTSResult>((resolve, reject) => {
        setTimeout(async () => {
          try {
            const result = await provider.synthesize(text, voice, language);
            resolve(result);
          } catch (error) {
            reject(error);
          }
        }, hedgingDelay * (index + 1));
      });
    });

    // Race all providers
    try {
      const result = await Promise.race([primaryPromise, ...fallbackPromises]);
      this.logger.debug('Hedging: First provider responded');
      return result;
    } catch (error) {
      // If race fails, try fallback chain
      return this.synthesizeWithFallback(text, voice, language, providers);
    }
  }

  createStreamingSession(
    events: TTSStreamEvents,
    voice?: VoiceConfig,
    language?: SupportedLanguage
  ): TTSStreamSession {
    return new FallbackTTSStreamSession(
      events,
      this.logger,
      this.primaryProvider,
      this.fallbackProviders,
      voice,
      language,
      this.fallbackConfig.enableHedging || false,
      this.fallbackConfig.hedgingDelayMs || 200
    );
  }

  async getVoices(language?: SupportedLanguage): Promise<VoiceInfo[]> {
    return this.primaryProvider.getVoices(language);
  }

  async shutdown(): Promise<void> {
    await this.primaryProvider.shutdown();
    for (const fallback of this.fallbackProviders) {
      await fallback.shutdown();
    }
    this.isInitialized = false;
  }
}

/**
 * Fallback TTS Streaming Session
 * Handles streaming with automatic failover
 */
class FallbackTTSStreamSession extends TTSStreamSession {
  private primaryProvider: TTSProvider;
  private fallbackProviders: TTSProvider[];
  private voice?: VoiceConfig;
  private language?: SupportedLanguage;
  private enableHedging: boolean;
  private hedgingDelayMs: number;
  
  private currentSession: TTSStreamSession | null = null;
  private pendingTexts: string[] = [];
  private hasStarted: boolean = false;
  private hasFailed: boolean = false;

  constructor(
    events: TTSStreamEvents,
    logger: Logger,
    primaryProvider: TTSProvider,
    fallbackProviders: TTSProvider[],
    voice?: VoiceConfig,
    language?: SupportedLanguage,
    enableHedging: boolean = false,
    hedgingDelayMs: number = 200
  ) {
    super(events, logger);
    this.primaryProvider = primaryProvider;
    this.fallbackProviders = fallbackProviders;
    this.voice = voice;
    this.language = language;
    this.enableHedging = enableHedging;
    this.hedgingDelayMs = hedgingDelayMs;
  }

  async start(): Promise<void> {
    this.startTime = Date.now();
    this.isActive = true;
    
    // Try primary provider first
    try {
      await this.startWithProvider(this.primaryProvider);
      this.hasStarted = true;
    } catch (error) {
      this.logger.warn('Primary TTS session failed to start, trying fallback', {
        error: (error as Error).message
      });
      await this.tryFallbackProviders();
    }
  }

  private async startWithProvider(provider: TTSProvider): Promise<void> {
    const wrappedEvents: TTSStreamEvents = {
      onAudioChunk: (chunk: Buffer) => {
        this.emitAudioChunk(chunk);
      },
      onComplete: (result: TTSResult) => {
        this.emitComplete(result);
      },
      onError: async (error: Error) => {
        this.logger.warn('TTS stream error, attempting fallback', { error: error.message });
        this.hasFailed = true;
        
        // Try to recover with fallback
        if (this.fallbackProviders.length > 0) {
          await this.tryFallbackProviders();
          // Replay pending texts on new session
          for (const text of this.pendingTexts) {
            this.currentSession?.sendText(text);
          }
        } else {
          this.emitError(error);
        }
      }
    };

    this.currentSession = provider.createStreamingSession(wrappedEvents, this.voice, this.language);
    await this.currentSession.start();
  }

  private async tryFallbackProviders(): Promise<void> {
    for (const fallback of this.fallbackProviders) {
      try {
        this.logger.info('Trying fallback TTS provider', { provider: fallback.getName() });
        await this.startWithProvider(fallback);
        this.hasFailed = false;
        return;
      } catch (error) {
        this.logger.warn('Fallback TTS provider also failed', {
          provider: fallback.getName(),
          error: (error as Error).message
        });
      }
    }
    
    // All providers failed
    this.emitError(new Error('All TTS providers failed'));
  }

  sendText(text: string): void {
    if (!this.isActive) return;
    
    // Store text for potential replay on fallback
    this.pendingTexts.push(text);
    
    if (this.currentSession && !this.hasFailed) {
      this.currentSession.sendText(text);
    }
  }

  async end(): Promise<void> {
    if (!this.isActive) return;
    
    if (this.currentSession) {
      await this.currentSession.end();
    }
    
    this.isActive = false;
  }

  abort(): void {
    this.isActive = false;
    if (this.currentSession) {
      this.currentSession.abort();
    }
  }
}

// Register the fallback provider
TTSProviderFactory.register('fallback', FallbackTTSProvider as any);
