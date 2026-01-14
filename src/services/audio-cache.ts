/**
 * Audio Cache Service
 * Pre-generates and caches common TTS phrases for instant playback
 * Reduces latency by ~200ms for cached responses
 */

import { EventEmitter } from 'events';
import { TTSProvider } from '../providers/base/tts-provider';
import { SupportedLanguage, Logger } from '../types';

export interface CachedPhrase {
  id: string;
  text: string;
  language: SupportedLanguage;
  audioBuffer: Buffer;
  durationMs: number;
  createdAt: Date;
}

export interface FillerPhrase {
  id: string;
  text: string;
  language: SupportedLanguage;
  category: 'tool_execution' | 'thinking' | 'acknowledgment' | 'greeting' | 'closing';
}

export interface AudioCacheConfig {
  enabled: boolean;
  maxCacheSize: number;  // Max number of cached phrases
  preloadOnStart: boolean;
  ttlMs: number;  // Time to live for cached audio
}

/**
 * Default filler phrases for different languages and categories
 */
export const DEFAULT_FILLER_PHRASES: FillerPhrase[] = [
  // English fillers
  { id: 'en_tool_1', text: 'Let me check that for you.', language: 'en-IN', category: 'tool_execution' },
  { id: 'en_tool_2', text: 'One moment please.', language: 'en-IN', category: 'tool_execution' },
  { id: 'en_tool_3', text: 'Just a second.', language: 'en-IN', category: 'tool_execution' },
  { id: 'en_tool_4', text: 'Let me look that up.', language: 'en-IN', category: 'tool_execution' },
  { id: 'en_think_1', text: 'Let me think about that.', language: 'en-IN', category: 'thinking' },
  { id: 'en_ack_1', text: 'I understand.', language: 'en-IN', category: 'acknowledgment' },
  { id: 'en_ack_2', text: 'Got it.', language: 'en-IN', category: 'acknowledgment' },
  { id: 'en_greet_1', text: 'Hello! How can I help you today?', language: 'en-IN', category: 'greeting' },
  { id: 'en_close_1', text: 'Is there anything else I can help you with?', language: 'en-IN', category: 'closing' },
  { id: 'en_close_2', text: 'Thank you for calling. Goodbye!', language: 'en-IN', category: 'closing' },
  
  // Hindi fillers
  { id: 'hi_tool_1', text: 'एक मिनट रुकिए, मैं देखता हूं।', language: 'hi-IN', category: 'tool_execution' },
  { id: 'hi_tool_2', text: 'बस एक सेकंड।', language: 'hi-IN', category: 'tool_execution' },
  { id: 'hi_tool_3', text: 'मैं अभी चेक करता हूं।', language: 'hi-IN', category: 'tool_execution' },
  { id: 'hi_think_1', text: 'मुझे सोचने दीजिए।', language: 'hi-IN', category: 'thinking' },
  { id: 'hi_ack_1', text: 'समझ गया।', language: 'hi-IN', category: 'acknowledgment' },
  { id: 'hi_ack_2', text: 'जी हां।', language: 'hi-IN', category: 'acknowledgment' },
  { id: 'hi_greet_1', text: 'नमस्ते! मैं आपकी कैसे मदद कर सकता हूं?', language: 'hi-IN', category: 'greeting' },
  { id: 'hi_close_1', text: 'क्या कुछ और मदद चाहिए?', language: 'hi-IN', category: 'closing' },
  { id: 'hi_close_2', text: 'धन्यवाद। अलविदा!', language: 'hi-IN', category: 'closing' },

  // Tamil fillers
  { id: 'ta_tool_1', text: 'ஒரு நிமிடம் பாருங்கள்.', language: 'ta-IN', category: 'tool_execution' },
  { id: 'ta_ack_1', text: 'புரிந்தது.', language: 'ta-IN', category: 'acknowledgment' },
  
  // Telugu fillers
  { id: 'te_tool_1', text: 'ఒక్క నిమిషం చూస్తాను.', language: 'te-IN', category: 'tool_execution' },
  { id: 'te_ack_1', text: 'అర్థమైంది.', language: 'te-IN', category: 'acknowledgment' },
];

export class AudioCacheService extends EventEmitter {
  private cache: Map<string, CachedPhrase> = new Map();
  private ttsProvider: TTSProvider | null = null;
  private logger: Logger;
  private config: AudioCacheConfig;
  private isInitialized: boolean = false;

  constructor(logger: Logger, config?: Partial<AudioCacheConfig>) {
    super();
    this.logger = logger.child({ component: 'audio-cache' });
    this.config = {
      enabled: true,
      maxCacheSize: 100,
      preloadOnStart: true,
      ttlMs: 24 * 60 * 60 * 1000, // 24 hours
      ...config
    };
  }

  /**
   * Initialize the cache with a TTS provider
   */
  async initialize(ttsProvider: TTSProvider, languages: SupportedLanguage[] = ['en-IN', 'hi-IN']): Promise<void> {
    if (!this.config.enabled) {
      this.logger.info('Audio cache is disabled');
      return;
    }

    this.ttsProvider = ttsProvider;
    
    if (this.config.preloadOnStart) {
      await this.preloadPhrases(languages);
    }
    
    this.isInitialized = true;
    this.logger.info('Audio cache initialized', { 
      cacheSize: this.cache.size,
      languages 
    });
  }

  /**
   * Preload common phrases for specified languages
   * Serialized to avoid TTS provider rate limiting (e.g., Cartesia concurrency limit)
   * Only caches English phrases as Cartesia doesn't support Hindi text well
   */
  async preloadPhrases(languages: SupportedLanguage[]): Promise<void> {
    // Only cache English phrases - Cartesia TTS doesn't handle Hindi/Indic text
    const phrasesToLoad = DEFAULT_FILLER_PHRASES.filter(
      phrase => phrase.language === 'en-IN'
    );

    this.logger.info('Preloading audio cache', { 
      phraseCount: phrasesToLoad.length,
      languages,
      note: 'Only caching English phrases for Cartesia TTS compatibility'
    });

    // Serialize caching to avoid rate limiting (Cartesia has concurrency limit of 2)
    let succeeded = 0;
    let failed = 0;

    for (const phrase of phrasesToLoad) {
      try {
        const result = await this.cachePhrase(phrase.id, phrase.text, phrase.language);
        if (result) {
          succeeded++;
        } else {
          failed++;
        }
        // Small delay between requests to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        failed++;
        this.logger.debug('Failed to cache phrase', { id: phrase.id, error: (error as Error).message });
      }
    }

    this.logger.info('Audio cache preload complete', { succeeded, failed });
  }

  /**
   * Cache a single phrase
   */
  async cachePhrase(id: string, text: string, language: SupportedLanguage): Promise<CachedPhrase | null> {
    if (!this.ttsProvider) {
      this.logger.warn('Cannot cache phrase - TTS provider not initialized');
      return null;
    }

    // Check cache size limit
    if (this.cache.size >= this.config.maxCacheSize) {
      this.evictOldest();
    }

    try {
      const result = await this.ttsProvider.synthesize(text, undefined, language);
      
      const cached: CachedPhrase = {
        id,
        text,
        language,
        audioBuffer: result.audioContent,
        durationMs: result.durationMs,
        createdAt: new Date()
      };

      this.cache.set(id, cached);
      this.logger.debug('Cached phrase', { id, text: text.substring(0, 30), language });
      
      return cached;
    } catch (error) {
      this.logger.error('Failed to cache phrase', { 
        id, 
        text: text.substring(0, 30),
        error: (error as Error).message 
      });
      return null;
    }
  }

  /**
   * Get cached audio by phrase ID
   */
  getCachedAudio(id: string): CachedPhrase | null {
    const cached = this.cache.get(id);
    
    if (!cached) {
      return null;
    }

    // Check TTL
    if (Date.now() - cached.createdAt.getTime() > this.config.ttlMs) {
      this.cache.delete(id);
      return null;
    }

    return cached;
  }

  /**
   * Get a random filler phrase for a category and language
   * Always uses English phrases since Cartesia TTS doesn't support Hindi/Indic text
   */
  getFillerPhrase(
    category: FillerPhrase['category'], 
    language: SupportedLanguage
  ): CachedPhrase | null {
    // Always use English phrases - only English is cached for Cartesia compatibility
    const matchingPhrases = DEFAULT_FILLER_PHRASES.filter(
      p => p.category === category && p.language === 'en-IN'
    );

    if (matchingPhrases.length === 0) {
      return null;
    }

    // Pick random phrase from English pool
    const phrase = matchingPhrases[Math.floor(Math.random() * matchingPhrases.length)];
    
    return this.getCachedAudio(phrase.id);
  }

  /**
   * Get a tool execution filler for the specified language
   */
  getToolFiller(language: SupportedLanguage): CachedPhrase | null {
    return this.getFillerPhrase('tool_execution', language);
  }

  /**
   * Check if a phrase is cached
   */
  isCached(id: string): boolean {
    return this.cache.has(id);
  }

  /**
   * Clear the cache
   */
  clear(): void {
    this.cache.clear();
    this.logger.info('Audio cache cleared');
  }

  /**
   * Get cache statistics
   */
  getStats(): { size: number; maxSize: number; hitRate: number } {
    return {
      size: this.cache.size,
      maxSize: this.config.maxCacheSize,
      hitRate: 0 // TODO: Track hit/miss ratio
    };
  }

  /**
   * Evict oldest cache entry
   */
  private evictOldest(): void {
    let oldest: string | null = null;
    let oldestTime = Date.now();

    for (const [id, phrase] of this.cache.entries()) {
      if (phrase.createdAt.getTime() < oldestTime) {
        oldestTime = phrase.createdAt.getTime();
        oldest = id;
      }
    }

    if (oldest) {
      this.cache.delete(oldest);
      this.logger.debug('Evicted oldest cache entry', { id: oldest });
    }
  }

  /**
   * Check if cache is ready
   */
  isReady(): boolean {
    return this.isInitialized && this.config.enabled;
  }
}

export default AudioCacheService;
