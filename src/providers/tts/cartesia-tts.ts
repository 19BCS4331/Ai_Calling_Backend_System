/**
 * Cartesia AI Text-to-Speech Provider
 * Implements WebSocket streaming TTS using Cartesia's Sonic 3 model
 * 
 * API Reference: https://docs.cartesia.ai/api-reference/tts/websocket
 */

import WebSocket from 'ws';
import {
  TTSConfig,
  TTSResult,
  TTSStreamEvents,
  Logger,
  SupportedLanguage,
  VoiceConfig,
  AudioFormat,
  ProviderError
} from '../../types';
import { TTSProvider, TTSProviderCapabilities, TTSStreamSession, VoiceInfo } from '../base/tts-provider';

const CARTESIA_TTS_WS_URL = 'wss://api.cartesia.ai/tts/websocket';
const CARTESIA_API_VERSION = '2025-04-16';

// Cartesia voice mappings - recommended voices for voice agents
const CARTESIA_VOICES: VoiceInfo[] = [
  // Voice agent voices (stable, realistic)
  { id: 'f786b574-daa5-4673-aa0c-cbe3e8534c02', name: 'Katie', language: 'en-IN', gender: 'female', description: 'Stable, realistic - ideal for voice agents' },
  { id: '228fca29-3a0a-435c-8728-5cb483251068', name: 'Kiefer', language: 'en-IN', gender: 'male', description: 'Stable, realistic - ideal for voice agents' },
  // Expressive voices
  { id: '6ccbfb76-1fc6-48f7-b71d-91ac6298247b', name: 'Tessa', language: 'en-IN', gender: 'female', description: 'Expressive and emotive' },
  { id: 'c961b81c-a935-4c17-bfb3-ba2239de8c2f', name: 'Kyle', language: 'en-IN', gender: 'male', description: 'Expressive and emotive' },
  // Default voice from docs
  { id: '694f9389-aac1-45b6-b726-9d9369183238', name: 'Default', language: 'en-IN', gender: 'neutral', description: 'Default Cartesia voice' },
  { id: 'a0e99841-438c-4a64-b679-ae501e7d6091', name: 'Sample', language: 'en-IN', gender: 'neutral', description: 'Sample voice from docs' }
];

// Cartesia supported languages
const CARTESIA_LANGUAGES: SupportedLanguage[] = [
  'en-IN', 'hi-IN', 'ta-IN', 'te-IN', 'bn-IN', 'mr-IN', 'gu-IN', 'pa-IN', 'kn-IN', 'ml-IN'
];

// Audio quality presets
type AudioQualityMode = 'web' | 'telephony';

const AUDIO_QUALITY_PRESETS = {
  web: {
    encoding: 'pcm_s16le',
    sampleRate: 44100,   // CD quality
    bitsPerSample: 16
  },
  telephony: {
    encoding: 'pcm_s16le',  // Use pcm_mulaw for actual Twilio deployment
    sampleRate: 8000,       // Telephony standard
    bitsPerSample: 16
  }
};

interface CartesiaTTSConfig extends TTSConfig {
  modelId?: string;
  speed?: number;         // Speed control
  emotion?: string[];     // Emotion controls
  audioQuality?: AudioQualityMode;  // 'web' for high quality, 'telephony' for phone calls
}

export class CartesiaTTSProvider extends TTSProvider {
  private modelId: string;
  private audioQuality: AudioQualityMode;

  constructor(config: CartesiaTTSConfig, logger: Logger) {
    super(config, logger);
    this.modelId = config.modelId || 'sonic-3';
    this.audioQuality = config.audioQuality || 'web';  // Default to high quality
  }

  getName(): string {
    return 'cartesia';
  }

  getCapabilities(): TTSProviderCapabilities {
    return {
      supportsStreaming: true,
      supportedLanguages: CARTESIA_LANGUAGES,
      supportedVoices: CARTESIA_VOICES,
      supportedAudioFormats: ['pcm', 'wav', 'mp3'],
      supportsSSML: false,
      maxTextLength: 10000
    };
  }

  async initialize(): Promise<void> {
    this.validateConfig();
    this.isInitialized = true;
    this.logger.info('Cartesia TTS provider initialized', { model: this.modelId });
  }

  async synthesize(
    text: string,
    voice?: VoiceConfig,
    language?: SupportedLanguage
  ): Promise<TTSResult> {
    const startTime = Date.now();
    const effectiveVoice = voice || this.getDefaultVoice(language || 'en-IN');

    return new Promise((resolve, reject) => {
      const session = this.createStreamingSession(
        {
          onAudioChunk: () => {},
          onComplete: (result) => resolve(result),
          onError: (error) => reject(error)
        },
        effectiveVoice,
        language
      );

      const audioChunks: Buffer[] = [];
      session.start().then(() => {
        const originalEmit = (session as any).emitAudioChunk.bind(session);
        (session as any).emitAudioChunk = (chunk: Buffer) => {
          audioChunks.push(chunk);
          originalEmit(chunk);
        };

        session.sendText(text);
        session.end().then(() => {
          const preset = AUDIO_QUALITY_PRESETS[this.audioQuality];
          resolve({
            audioContent: Buffer.concat(audioChunks),
            audioFormat: { encoding: 'LINEAR16', sampleRateHertz: preset.sampleRate, channels: 1 },
            durationMs: 0,
            latencyMs: Date.now() - startTime
          });
        });
      }).catch(reject);
    });
  }

  createStreamingSession(
    events: TTSStreamEvents,
    voice?: VoiceConfig,
    language?: SupportedLanguage
  ): TTSStreamSession {
    const effectiveVoice = voice || this.config.voice || { voiceId: 'f786b574-daa5-4673-aa0c-cbe3e8534c02' };
    const effectiveLanguage = language || 'en-IN';
    const qualityPreset = AUDIO_QUALITY_PRESETS[this.audioQuality];

    return new CartesiaTTSStreamSession(
      events,
      this.logger,
      this.config.credentials!.apiKey!,
      this.modelId,
      effectiveVoice,
      effectiveLanguage,
      qualityPreset
    );
  }

  async getVoices(language?: SupportedLanguage): Promise<VoiceInfo[]> {
    if (language) {
      return CARTESIA_VOICES.filter(v => v.language.startsWith(language.split('-')[0]));
    }
    return CARTESIA_VOICES;
  }

  protected getDefaultVoice(language: SupportedLanguage): VoiceConfig {
    // Use Katie (female, stable) as default for voice agents
    return {
      voiceId: 'f786b574-daa5-4673-aa0c-cbe3e8534c02',
      language,
      gender: 'female'
    };
  }
}

/**
 * Cartesia TTS Streaming Session
 */
interface AudioQualityPreset {
  encoding: string;
  sampleRate: number;
  bitsPerSample: number;
}

class CartesiaTTSStreamSession extends TTSStreamSession {
  private ws: WebSocket | null = null;
  private apiKey: string;
  private modelId: string;
  private voice: VoiceConfig;
  private language: SupportedLanguage;
  private contextId: string;
  private isConnected: boolean = false;
  private pendingTexts: string[] = [];
  private completionResolver: (() => void) | null = null;
  private pcmBuffer: Buffer[] = [];  // Accumulate PCM chunks
  private qualityPreset: AudioQualityPreset;

  constructor(
    events: TTSStreamEvents,
    logger: Logger,
    apiKey: string,
    modelId: string,
    voice: VoiceConfig,
    language: SupportedLanguage,
    qualityPreset: AudioQualityPreset
  ) {
    super(events, logger);
    this.apiKey = apiKey;
    this.modelId = modelId;
    this.voice = voice;
    this.language = language;
    this.qualityPreset = qualityPreset;
    this.contextId = `ctx-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  async start(): Promise<void> {
    this.isActive = true;
    this.startTime = Date.now();

    return new Promise((resolve, reject) => {
      const wsUrl = `${CARTESIA_TTS_WS_URL}?api_key=${this.apiKey}&cartesia_version=${CARTESIA_API_VERSION}`;

      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.isConnected = true;
        this.logger.debug('Cartesia TTS WebSocket connected');
        
        // Send any pending texts
        this.flushPendingTexts();
        resolve();
      };

      this.ws.onmessage = (event) => {
        this.handleMessage(event.data);
      };

      this.ws.onerror = (error) => {
        this.logger.error('Cartesia TTS WebSocket error', { error });
        this.emitError(new Error('WebSocket error'));
        reject(error);
      };

      this.ws.onclose = (event) => {
        this.isConnected = false;
        this.logger.debug('Cartesia TTS WebSocket closed', { code: event.code });
        
        if (this.completionResolver) {
          this.completionResolver();
          this.completionResolver = null;
        }
      };

      // Connection timeout
      setTimeout(() => {
        if (!this.isConnected) {
          this.ws?.close();
          reject(new Error('Connection timeout'));
        }
      }, 10000);
    });
  }

  sendText(text: string): void {
    if (!this.isActive) {
      this.logger.warn('Attempted to send text to inactive Cartesia TTS session');
      return;
    }

    if (this.isConnected && this.ws?.readyState === WebSocket.OPEN) {
      this.sendTextMessage(text);
    } else {
      this.pendingTexts.push(text);
      this.logger.debug('Queued text for Cartesia TTS', { queueLength: this.pendingTexts.length });
    }
  }

  private flushPendingTexts(): void {
    while (this.pendingTexts.length > 0) {
      const text = this.pendingTexts.shift()!;
      this.sendTextMessage(text);
    }
  }

  // Track if this is the first message (needs full config) vs continuation
  private messagesSent: number = 0;
  
  private sendTextMessage(text: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.logger.warn('Cannot send text - WebSocket not ready');
      return;
    }

    // Get voice ID - handle both voiceId and id properties
    const voiceId = this.voice.voiceId || (this.voice as any).id || 'f786b574-daa5-4673-aa0c-cbe3e8534c02';

    // Map language to Cartesia format (e.g., 'en-US' -> 'en', 'hi-IN' -> 'hi')
    const lang = this.language === 'unknown' ? 'en' : this.language.split('-')[0];

    // Use continue: true to keep context open for more text
    // This allows streaming multiple sentences to the same context
    const message = {
      model_id: this.modelId,
      transcript: text,
      voice: {
        mode: 'id',
        id: voiceId
      },
      language: lang,
      context_id: this.contextId,
      output_format: {
        container: 'raw',
        encoding: this.qualityPreset.encoding,
        sample_rate: this.qualityPreset.sampleRate
      },
      add_timestamps: false,
      continue: true  // Keep context open for more input
    };

    this.messagesSent++;
    this.logger.debug('Sending text to Cartesia TTS', { 
      textLength: text.length, 
      contextId: this.contextId,
      messageNum: this.messagesSent 
    });
    this.ws.send(JSON.stringify(message));
  }
  
  /**
   * Signal end of input - send final message with continue: false
   */
  private sendEndSignal(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    
    // Send empty transcript with continue: false to signal end
    const message = {
      model_id: this.modelId,
      transcript: '',
      voice: {
        mode: 'id',
        id: this.voice.voiceId || (this.voice as any).id || 'f786b574-daa5-4673-aa0c-cbe3e8534c02'
      },
      language: this.language === 'unknown' ? 'en' : this.language.split('-')[0],
      context_id: this.contextId,
      output_format: {
        container: 'raw',
        encoding: this.qualityPreset.encoding,
        sample_rate: this.qualityPreset.sampleRate
      },
      add_timestamps: false,
      continue: false  // Signal end of input
    };
    
    this.logger.debug('Sending end signal to Cartesia TTS', { contextId: this.contextId });
    this.ws.send(JSON.stringify(message));
  }

  async end(): Promise<void> {
    if (!this.isActive) return;

    return new Promise((resolve) => {
      this.completionResolver = resolve;

      // Send end signal to close the context
      this.sendEndSignal();
      
      // Wait for done message or timeout
      setTimeout(() => {
        if (this.completionResolver) {
          this.logger.debug('Cartesia TTS session end timeout - finalizing');
          this.completionResolver = null;
          this.finalizeSession();
          resolve();
        }
      }, 15000);
    });
  }

  abort(): void {
    if (!this.isActive) return;

    this.logger.debug('Aborting Cartesia TTS session');
    
    // Send cancel message
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        context_id: this.contextId,
        cancel: true
      }));
    }

    this.finalizeSession();
  }

  // Buffer for accumulating PCM before emitting as WAV
  // Target ~100ms chunks to reduce boundary artifacts while maintaining low latency
  private streamBuffer: Buffer[] = [];
  private streamBufferBytes: number = 0;
  // 100ms at 22050Hz, 16-bit = 22050 * 0.1 * 2 = 4410 bytes
  // But Cartesia uses 44100Hz typically, so 44100 * 0.1 * 2 = 8820 bytes
  private readonly MIN_CHUNK_BYTES = 8000; // ~90ms at 44.1kHz 16-bit
  
  private handleMessage(data: WebSocket.Data): void {
    try {
      const message = JSON.parse(data.toString());

      switch (message.type) {
        case 'chunk':
          if (message.data) {
            const pcmChunk = Buffer.from(message.data, 'base64');
            
            // Accumulate PCM chunks
            this.streamBuffer.push(pcmChunk);
            this.streamBufferBytes += pcmChunk.length;
            
            // Emit when we have enough data for smooth playback
            if (this.streamBufferBytes >= this.MIN_CHUNK_BYTES) {
              this.flushStreamBuffer();
            }
            
            // Track for metrics
            this.pcmBuffer.push(pcmChunk);
          }
          break;

        case 'done':
          // Flush any remaining buffered audio
          if (this.streamBufferBytes > 0) {
            this.flushStreamBuffer();
          }
          
          this.logger.debug('Cartesia TTS generation complete', { 
            contextId: this.contextId,
            pcmChunks: this.pcmBuffer.length,
            totalBytes: this.pcmBuffer.reduce((sum, b) => sum + b.length, 0)
          });
          
          // Reset for next stream
          this.pcmBuffer = [];
          this.streamBuffer = [];
          this.streamBufferBytes = 0;
          
          if (this.completionResolver) {
            this.completionResolver();
            this.completionResolver = null;
          }
          this.finalizeSession();
          break;

        case 'flush_done':
          this.logger.debug('Cartesia TTS flush complete', { flushId: message.flush_id });
          break;

        case 'timestamps':
          // Word timestamps - could be used for lip sync, etc.
          break;

        case 'error':
          this.logger.error('Cartesia TTS error', { error: message.error });
          this.emitError(new Error(message.error || 'Unknown Cartesia error'));
          break;

        default:
          if (message.error) {
            this.logger.error('Cartesia TTS error response', { error: message.error });
            this.emitError(new Error(message.error));
          }
      }
    } catch (error) {
      this.logger.error('Failed to parse Cartesia message', { error });
    }
  }

  /**
   * Flush accumulated PCM buffer as a single WAV chunk
   */
  private flushStreamBuffer(): void {
    if (this.streamBuffer.length === 0) return;
    
    // Concatenate all buffered PCM chunks
    const pcmData = Buffer.concat(this.streamBuffer);
    
    // Wrap with WAV header and emit
    const wavChunk = this.pcmToWav(
      pcmData,
      this.qualityPreset.sampleRate,
      1,
      this.qualityPreset.bitsPerSample
    );
    this.emitAudioChunk(wavChunk);
    
    // Reset buffer
    this.streamBuffer = [];
    this.streamBufferBytes = 0;
  }
  
  /**
   * Create WAV header for streaming audio
   * Uses placeholder size that browser will handle
   */
  private createWavHeader(dataSize: number, sampleRate: number, channels: number, bitsPerSample: number): Buffer {
    const byteRate = sampleRate * channels * (bitsPerSample / 8);
    const blockAlign = channels * (bitsPerSample / 8);
    const headerSize = 44;
    
    const wavHeader = Buffer.alloc(headerSize);
    
    // RIFF header
    wavHeader.write('RIFF', 0);
    wavHeader.writeUInt32LE(36 + dataSize, 4);
    wavHeader.write('WAVE', 8);
    
    // fmt chunk
    wavHeader.write('fmt ', 12);
    wavHeader.writeUInt32LE(16, 16);           // Subchunk1Size (16 for PCM)
    wavHeader.writeUInt16LE(1, 20);            // AudioFormat (1 = PCM)
    wavHeader.writeUInt16LE(channels, 22);     // NumChannels
    wavHeader.writeUInt32LE(sampleRate, 24);   // SampleRate
    wavHeader.writeUInt32LE(byteRate, 28);     // ByteRate
    wavHeader.writeUInt16LE(blockAlign, 32);   // BlockAlign
    wavHeader.writeUInt16LE(bitsPerSample, 34);// BitsPerSample
    
    // data chunk
    wavHeader.write('data', 36);
    wavHeader.writeUInt32LE(dataSize, 40);
    
    return wavHeader;
  }

  /**
   * Convert raw PCM audio to WAV format for browser playback
   */
  private pcmToWav(pcmData: Buffer, sampleRate: number, channels: number, bitsPerSample: number): Buffer {
    const header = this.createWavHeader(pcmData.length, sampleRate, channels, bitsPerSample);
    return Buffer.concat([header, pcmData]);
  }

  private finalizeSession(): void {
    this.isActive = false;

    if (this.ws) {
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.close();
      }
      this.ws = null;
    }

    this.emitComplete({
      audioContent: Buffer.alloc(0),
      audioFormat: { encoding: 'LINEAR16', sampleRateHertz: this.qualityPreset.sampleRate, channels: 1 },
      durationMs: 0,
      latencyMs: Date.now() - this.startTime
    });
  }
}

// Register the provider
import { TTSProviderFactory } from '../base/tts-provider';
TTSProviderFactory.register('cartesia', CartesiaTTSProvider as any);

export default CartesiaTTSProvider;
