/**
 * Reverie Language Technologies Text-to-Speech Provider
 * Implements REST API for TTS in Indian languages
 * 
 * API Reference: https://docs.reverieinc.com/endpoints/text-to-speech
 */

import {
  TTSConfig,
  TTSResult,
  TTSStreamEvents,
  Logger,
  SupportedLanguage,
  VoiceConfig,
  ProviderError
} from '../../types';
import { TTSProvider, TTSProviderCapabilities, TTSStreamSession, VoiceInfo } from '../base/tts-provider';

const REVERIE_API_URL = 'https://revapi.reverieinc.com/';

// Reverie voice mappings based on documentation
const REVERIE_VOICES: VoiceInfo[] = [
  // Hindi
  { id: 'hi_male', name: 'Hindi Male', language: 'hi-IN', gender: 'male' },
  { id: 'hi_male_2', name: 'Hindi Male 2', language: 'hi-IN', gender: 'male' },
  { id: 'hi_male_3', name: 'Hindi Male 3', language: 'hi-IN', gender: 'male' },
  { id: 'hi_male_4', name: 'Hindi Male 4', language: 'hi-IN', gender: 'male' },
  { id: 'hi_female', name: 'Hindi Female', language: 'hi-IN', gender: 'female' },
  { id: 'hi_female_2', name: 'Hindi Female 2', language: 'hi-IN', gender: 'female' },
  { id: 'hi_female_3', name: 'Hindi Female 3', language: 'hi-IN', gender: 'female' },
  // Tamil
  { id: 'ta_male', name: 'Tamil Male', language: 'ta-IN', gender: 'male' },
  { id: 'ta_female', name: 'Tamil Female', language: 'ta-IN', gender: 'female' },
  // Telugu
  { id: 'te_male', name: 'Telugu Male', language: 'te-IN', gender: 'male' },
  { id: 'te_male_2', name: 'Telugu Male 2', language: 'te-IN', gender: 'male' },
  { id: 'te_female', name: 'Telugu Female', language: 'te-IN', gender: 'female' },
  { id: 'te_female_2', name: 'Telugu Female 2', language: 'te-IN', gender: 'female' },
  // Malayalam
  { id: 'ml_male', name: 'Malayalam Male', language: 'ml-IN', gender: 'male' },
  { id: 'ml_female', name: 'Malayalam Female', language: 'ml-IN', gender: 'female' },
  // Kannada
  { id: 'kn_male', name: 'Kannada Male', language: 'kn-IN', gender: 'male' },
  { id: 'kn_male_2', name: 'Kannada Male 2', language: 'kn-IN', gender: 'male' },
  { id: 'kn_female', name: 'Kannada Female', language: 'kn-IN', gender: 'female' },
  { id: 'kn_female_2', name: 'Kannada Female 2', language: 'kn-IN', gender: 'female' },
  // Bengali
  { id: 'bn_male', name: 'Bengali Male', language: 'bn-IN', gender: 'male' },
  { id: 'bn_male_2', name: 'Bengali Male 2', language: 'bn-IN', gender: 'male' },
  { id: 'bn_female', name: 'Bengali Female', language: 'bn-IN', gender: 'female' },
  { id: 'bn_female_2', name: 'Bengali Female 2', language: 'bn-IN', gender: 'female' },
  // Marathi
  { id: 'mr_male', name: 'Marathi Male', language: 'mr-IN', gender: 'male' },
  { id: 'mr_male_2', name: 'Marathi Male 2', language: 'mr-IN', gender: 'male' },
  { id: 'mr_male_3', name: 'Marathi Male 3', language: 'mr-IN', gender: 'male' },
  { id: 'mr_female', name: 'Marathi Female', language: 'mr-IN', gender: 'female' },
  { id: 'mr_female_2', name: 'Marathi Female 2', language: 'mr-IN', gender: 'female' },
  { id: 'mr_female_3', name: 'Marathi Female 3', language: 'mr-IN', gender: 'female' },
  // Gujarati
  { id: 'gu_male', name: 'Gujarati Male', language: 'gu-IN', gender: 'male' },
  { id: 'gu_female', name: 'Gujarati Female', language: 'gu-IN', gender: 'female' },
  // Punjabi
  { id: 'pa_male', name: 'Punjabi Male', language: 'pa-IN', gender: 'male' },
  { id: 'pa_female', name: 'Punjabi Female', language: 'pa-IN', gender: 'female' },
  // English (Indian)
  { id: 'en_male', name: 'English Male', language: 'en-IN', gender: 'male' },
  { id: 'en_male_2', name: 'English Male 2', language: 'en-IN', gender: 'male' },
  { id: 'en_female', name: 'English Female', language: 'en-IN', gender: 'female' },
  { id: 'en_female_2', name: 'English Female 2', language: 'en-IN', gender: 'female' },
  // Odia
  { id: 'or_male', name: 'Odia Male', language: 'en-IN', gender: 'male' },
  { id: 'or_female', name: 'Odia Female', language: 'en-IN', gender: 'female' },
  // Assamese
  { id: 'as_male', name: 'Assamese Male', language: 'en-IN', gender: 'male' },
  { id: 'as_female', name: 'Assamese Female', language: 'en-IN', gender: 'female' }
];

interface ReverieTTSConfig extends TTSConfig {
  appId?: string;
}

export class ReverieTTSProvider extends TTSProvider {
  private appId: string;

  constructor(config: ReverieTTSConfig, logger: Logger) {
    super(config, logger);
    this.appId = config.appId || config.credentials.projectId || '';
  }

  getName(): string {
    return 'reverie';
  }

  getCapabilities(): TTSProviderCapabilities {
    return {
      supportsStreaming: false, // Reverie uses REST, not WebSocket streaming
      supportedLanguages: [
        'en-IN', 'hi-IN', 'ta-IN', 'te-IN', 'ml-IN',
        'kn-IN', 'bn-IN', 'mr-IN', 'gu-IN', 'pa-IN'
      ],
      supportedVoices: REVERIE_VOICES,
      supportedAudioFormats: ['WAV', 'MP3'],
      supportsSSML: false,
      maxTextLength: 5000
    };
  }

  async initialize(): Promise<void> {
    this.validateConfig();
    
    if (!this.appId) {
      throw this.createError('App ID is required for Reverie', 'INVALID_CONFIG');
    }
    
    this.isInitialized = true;
    this.logger.info('Reverie TTS provider initialized');
  }

  async synthesize(
    text: string,
    voice?: VoiceConfig,
    language?: SupportedLanguage
  ): Promise<TTSResult> {
    const startTime = Date.now();
    const effectiveVoice = voice || this.getDefaultVoiceForLanguage(language || 'hi-IN');

    try {
      const response = await fetch(REVERIE_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'REV-API-KEY': this.config.credentials.apiKey,
          'REV-APP-ID': this.appId,
          'REV-APPNAME': 'tts',
          'speaker': effectiveVoice.voiceId
        },
        body: JSON.stringify({
          text: [text],
          speed: effectiveVoice.speakingRate ?? 1.0,
          pitch: effectiveVoice.pitch ?? 0,
          format: this.config.audioFormat?.encoding || 'WAV'
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw this.createError(
          `Reverie TTS API error: ${response.status} - ${errorText}`,
          'API_ERROR',
          response.status >= 500
        );
      }

      // Reverie returns audio directly as binary
      const audioBuffer = Buffer.from(await response.arrayBuffer());

      return {
        audioContent: audioBuffer,
        audioFormat: {
          encoding: (this.config.audioFormat?.encoding as any) || 'LINEAR16',
          sampleRateHertz: this.config.audioFormat?.sampleRateHertz || 22050,
          channels: 1
        },
        durationMs: this.estimateAudioDuration(audioBuffer.length),
        latencyMs: Date.now() - startTime
      };
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw this.createError(
        `Reverie TTS request failed: ${(error as Error).message}`,
        'REQUEST_FAILED',
        true,
        error as Error
      );
    }
  }

  createStreamingSession(
    events: TTSStreamEvents,
    voice?: VoiceConfig,
    language?: SupportedLanguage
  ): TTSStreamSession {
    // Reverie doesn't support streaming, so we simulate it with chunked REST calls
    return new ReverieTTSStreamSession(
      events,
      this.logger,
      this,
      voice || this.getDefaultVoiceForLanguage(language || 'hi-IN')
    );
  }

  async getVoices(language?: SupportedLanguage): Promise<VoiceInfo[]> {
    if (!language) return REVERIE_VOICES;
    return REVERIE_VOICES.filter(v => v.language === language);
  }

  private getDefaultVoiceForLanguage(language: SupportedLanguage): VoiceConfig {
    const langPrefix = language.split('-')[0];
    const defaultVoice = REVERIE_VOICES.find(v => 
      v.language === language && v.gender === 'female'
    ) || REVERIE_VOICES.find(v => 
      v.id.startsWith(langPrefix) && v.gender === 'female'
    ) || REVERIE_VOICES[0];

    return {
      voiceId: defaultVoice.id,
      language,
      gender: defaultVoice.gender
    };
  }

  private estimateAudioDuration(bytes: number): number {
    // Estimate for WAV at 22050 Hz, 16-bit mono
    return Math.round((bytes / (22050 * 2)) * 1000);
  }
}

class ReverieTTSStreamSession extends TTSStreamSession {
  private provider: ReverieTTSProvider;
  private voice: VoiceConfig;
  private textQueue: string[] = [];
  private isProcessing: boolean = false;
  private audioChunks: Buffer[] = [];

  constructor(
    events: TTSStreamEvents,
    logger: Logger,
    provider: ReverieTTSProvider,
    voice: VoiceConfig
  ) {
    super(events, logger);
    this.provider = provider;
    this.voice = voice;
  }

  async start(): Promise<void> {
    this.startTime = Date.now();
    this.isActive = true;
    this.logger.debug('Reverie TTS session started (simulated streaming)');
  }

  sendText(text: string): void {
    if (!this.isActive) return;
    
    this.textQueue.push(text);
    this.processQueue();
  }

  async end(): Promise<void> {
    // Wait for queue to be processed
    while (this.textQueue.length > 0 || this.isProcessing) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    const totalAudio = Buffer.concat(this.audioChunks);
    
    this.emitComplete({
      audioContent: totalAudio,
      audioFormat: {
        encoding: 'LINEAR16',
        sampleRateHertz: 22050,
        channels: 1
      },
      durationMs: Math.round((totalAudio.length / (22050 * 2)) * 1000),
      latencyMs: Date.now() - this.startTime
    });

    this.isActive = false;
  }

  abort(): void {
    this.isActive = false;
    this.textQueue = [];
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.textQueue.length === 0) return;
    
    this.isProcessing = true;

    while (this.textQueue.length > 0 && this.isActive) {
      const text = this.textQueue.shift()!;
      
      try {
        const result = await this.provider.synthesize(text, this.voice);
        this.audioChunks.push(result.audioContent);
        this.emitAudioChunk(result.audioContent);
      } catch (error) {
        this.emitError(error as Error);
      }
    }

    this.isProcessing = false;
  }
}

// Register the provider
import { TTSProviderFactory } from '../base/tts-provider';
TTSProviderFactory.register('reverie', ReverieTTSProvider as any);

export default ReverieTTSProvider;
