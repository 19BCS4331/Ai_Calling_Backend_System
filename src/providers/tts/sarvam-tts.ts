/**
 * Sarvam AI Text-to-Speech Provider
 * Implements WebSocket streaming TTS using Sarvam's Bulbul v2 model
 * 
 * API Reference: https://docs.sarvam.ai/api-reference-docs/api-guides-tutorials/text-to-speech/streaming-api
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

const SARVAM_TTS_WS_URL = 'wss://api.sarvam.ai/text-to-speech/ws';
const SARVAM_TTS_REST_URL = 'https://api.sarvam.ai/text-to-speech/generate';

// Sarvam voice mappings based on documentation
const SARVAM_VOICES: VoiceInfo[] = [
  { id: 'anushka', name: 'Anushka', language: 'hi-IN', gender: 'female', description: 'Clear and Professional' },
  { id: 'vidya', name: 'Vidya', language: 'hi-IN', gender: 'female', description: 'Warm and Natural' },
  { id: 'manisha', name: 'Manisha', language: 'hi-IN', gender: 'female', description: 'Friendly' },
  { id: 'arya', name: 'Arya', language: 'hi-IN', gender: 'female', description: 'Energetic' },
  { id: 'abhilash', name: 'Abhilash', language: 'hi-IN', gender: 'male', description: 'Deep and Authoritative' },
  { id: 'karun', name: 'Karun', language: 'hi-IN', gender: 'male', description: 'Calm and Soothing' },
  { id: 'hitesh', name: 'Hitesh', language: 'hi-IN', gender: 'male', description: 'Professional' }
];

interface SarvamTTSConfig extends TTSConfig {
  minBufferSize?: number;
  maxChunkLength?: number;
  pitch?: number;
  pace?: number;
  outputAudioBitrate?: string;
}

export class SarvamTTSProvider extends TTSProvider {
  constructor(config: SarvamTTSConfig, logger: Logger) {
    super(config, logger);
  }

  getName(): string {
    return 'sarvam';
  }

  getCapabilities(): TTSProviderCapabilities {
    return {
      supportsStreaming: true,
      supportedLanguages: [
        'en-IN', 'hi-IN', 'ta-IN', 'te-IN', 'ml-IN',
        'kn-IN', 'bn-IN', 'mr-IN', 'gu-IN', 'pa-IN'
      ],
      supportedVoices: SARVAM_VOICES,
      supportedAudioFormats: ['mp3', 'wav', 'aac', 'opus', 'flac', 'pcm', 'mulaw', 'alaw'],
      supportsSSML: false,
      maxTextLength: 5000
    };
  }

  async initialize(): Promise<void> {
    this.validateConfig();
    this.isInitialized = true;
    this.logger.info('Sarvam TTS provider initialized');
  }

  async synthesize(
    text: string,
    voice?: VoiceConfig,
    language?: SupportedLanguage
  ): Promise<TTSResult> {
    const startTime = Date.now();
    const effectiveVoice = voice || this.getDefaultVoice(language || 'hi-IN');

    try {
      const response = await fetch(SARVAM_TTS_REST_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-subscription-key': this.config.credentials.apiKey
        },
        body: JSON.stringify({
          inputs: [text],
          target_language_code: effectiveVoice.language,
          speaker: effectiveVoice.voiceId,
          pitch: effectiveVoice.pitch ?? 0,
          pace: effectiveVoice.speakingRate ?? 1.0,
          model: 'bulbul:v2'
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw this.createError(
          `Sarvam TTS API error: ${response.status} - ${errorText}`,
          'API_ERROR',
          response.status >= 500
        );
      }

      const data = await response.json() as { audios?: string[] };
      const audioBase64 = data.audios?.[0];
      
      if (!audioBase64) {
        throw this.createError('No audio returned from Sarvam TTS', 'NO_AUDIO');
      }

      const audioBuffer = Buffer.from(audioBase64, 'base64');

      return {
        audioContent: audioBuffer,
        audioFormat: {
          encoding: 'MP3',
          sampleRateHertz: 22050,
          channels: 1
        },
        durationMs: this.estimateAudioDuration(audioBuffer.length),
        latencyMs: Date.now() - startTime
      };
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw this.createError(
        `Sarvam TTS request failed: ${(error as Error).message}`,
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
    const effectiveVoice = voice || this.getDefaultVoice(language || 'hi-IN');
    const config = this.config as SarvamTTSConfig;

    return new SarvamTTSStreamSession(
      events,
      this.logger,
      {
        apiKey: this.config.credentials.apiKey,
        wsUrl: SARVAM_TTS_WS_URL,
        speaker: effectiveVoice.voiceId,
        language: effectiveVoice.language,
        pitch: config.pitch ?? effectiveVoice.pitch ?? 0,
        pace: config.pace ?? effectiveVoice.speakingRate ?? 1.0,
        minBufferSize: config.minBufferSize ?? 50,
        maxChunkLength: config.maxChunkLength ?? 200,
        outputAudioCodec: 'wav',  // Use WAV for PCM audio (Sarvam API format)
        outputAudioBitrate: config.outputAudioBitrate ?? '128k'
      }
    );
  }

  async getVoices(language?: SupportedLanguage): Promise<VoiceInfo[]> {
    if (!language) return SARVAM_VOICES;
    return SARVAM_VOICES.filter(v => v.language === language);
  }

  private mapAudioFormat(encoding: string): string {
    const formatMap: Record<string, string> = {
      'LINEAR16': 'pcm',
      'MP3': 'mp3',
      'OGG_OPUS': 'opus',
      'MULAW': 'mulaw'
    };
    return formatMap[encoding] || 'mp3';
  }

  private estimateAudioDuration(bytes: number): number {
    // Rough estimate for MP3 at 128kbps
    return Math.round((bytes * 8) / 128);
  }
}

interface SarvamTTSSessionConfig {
  apiKey: string;
  wsUrl: string;
  speaker: string;
  language: SupportedLanguage;
  pitch: number;
  pace: number;
  minBufferSize: number;
  maxChunkLength: number;
  outputAudioCodec: string;
  outputAudioBitrate: string;
}

class SarvamTTSStreamSession extends TTSStreamSession {
  private ws: WebSocket | null = null;
  private sessionConfig: SarvamTTSSessionConfig;
  private pendingTexts: string[] = [];
  private isConnected: boolean = false;
  private audioChunks: Buffer[] = [];
  private completionResolver: (() => void) | null = null;
  private sentTextCount: number = 0;  // Track how many text messages sent
  private configReady: boolean = false;  // Track if config has been sent

  constructor(
    events: TTSStreamEvents,
    logger: Logger,
    config: SarvamTTSSessionConfig
  ) {
    super(events, logger);
    this.sessionConfig = config;
  }

  async start(): Promise<void> {
    this.startTime = Date.now();
    this.isActive = true;

    // Add query params per Sarvam TTS AsyncAPI spec
    const wsUrl = `${this.sessionConfig.wsUrl}?model=bulbul:v2&send_completion_event=true`;

    return new Promise((resolve, reject) => {
      // Api-Subscription-Key header for authentication per Sarvam spec
      this.ws = new WebSocket(wsUrl, {
        headers: {
          'Api-Subscription-Key': this.sessionConfig.apiKey
        }
      });

      this.ws.on('open', () => {
        this.isConnected = true;
        this.logger.debug('Sarvam TTS WebSocket connected');
        
        // Send config message first per Sarvam API
        this.sendConfigMessage();
        
        // Delay to ensure config is processed before sending text
        setTimeout(() => {
          this.configReady = true;  // Only now ready to accept text
          
          // Send any pending text that arrived during config setup
          this.logger.debug('TTS config ready, sending pending texts', { 
            pendingCount: this.pendingTexts.length 
          });
          for (const text of this.pendingTexts) {
            this.sendTextMessage(text);
          }
          this.pendingTexts = [];
          resolve();
        }, 100);  // Increased delay for config processing
      });

      this.ws.on('message', (data: Buffer) => {
        this.handleMessage(data);
      });

      this.ws.on('error', (error: Error) => {
        this.logger.error('Sarvam TTS WebSocket error', { error: error.message });
        this.emitError(error);
        reject(error);
      });

      this.ws.on('close', (code: number, reason: Buffer) => {
        this.logger.debug('Sarvam TTS WebSocket closed', { code, reason: reason.toString() });
        this.isConnected = false;
        this.finalizeSession();
      });
    });
  }

  sendText(text: string): void {
    if (!this.isActive) {
      this.logger.warn('Attempted to send text to inactive TTS session');
      return;
    }

    // Only send directly if connected AND config is ready
    if (this.isConnected && this.configReady && this.ws?.readyState === WebSocket.OPEN) {
      this.sendTextMessage(text);
    } else {
      // Queue text until config is ready
      this.pendingTexts.push(text);
      this.logger.debug('Queued text for TTS', { queueLength: this.pendingTexts.length });
    }
  }

  async end(): Promise<void> {
    if (!this.isActive) return;

    return new Promise((resolve) => {
      // Store resolver to be called when "final" event is received
      this.completionResolver = resolve;
      
      if (this.ws?.readyState === WebSocket.OPEN) {
        // Send flush message to signal end of text
        this.ws.send(JSON.stringify({ type: 'flush' }));
        this.logger.debug('Sent TTS flush signal, waiting for final event');
        
        // Timeout fallback in case final event never arrives
        setTimeout(() => {
          if (this.completionResolver) {
            this.logger.warn('TTS completion timeout - finalizing without final event');
            this.completionResolver = null;
            this.finalizeSession();
            resolve();
          }
        }, 15000);
      } else {
        this.completionResolver = null;
        this.finalizeSession();
        resolve();
      }
    });
  }

  abort(): void {
    this.isActive = false;
    if (this.ws) {
      this.ws.close(1000, 'Aborted');
      this.ws = null;
    }
  }

  private sendConfigMessage(): void {
    const configMessage = {
      type: 'config',
      data: {
        speaker: this.sessionConfig.speaker,
        target_language_code: this.sessionConfig.language,
        pitch: this.sessionConfig.pitch,
        pace: this.sessionConfig.pace,
        min_buffer_size: this.sessionConfig.minBufferSize,
        max_chunk_length: this.sessionConfig.maxChunkLength,
        output_audio_codec: this.sessionConfig.outputAudioCodec,
        output_audio_bitrate: this.sessionConfig.outputAudioBitrate
      }
    };

    this.ws?.send(JSON.stringify(configMessage));
    this.logger.debug('Sent TTS config message', { config: configMessage.data });
  }

  private sendTextMessage(text: string): void {
    this.sentTextCount++;
    const textMessage = {
      type: 'text',
      data: { text }
    };
    this.ws?.send(JSON.stringify(textMessage));
    this.logger.debug('Sent text to TTS', { 
      textLength: text.length, 
      sentCount: this.sentTextCount,
      preview: text.substring(0, 50) 
    });
  }

  private handleMessage(data: Buffer): void {
    try {
      // Check if it's binary audio data or JSON message
      const firstByte = data[0];
      
      // JSON messages start with '{' (0x7B)
      if (firstByte === 0x7B) {
        const message = JSON.parse(data.toString());
        this.handleJsonMessage(message);
      } else {
        // Binary audio data
        this.handleAudioChunk(data);
      }
    } catch (error) {
      // Treat as binary audio if JSON parsing fails
      this.handleAudioChunk(data);
    }
  }

  private handleJsonMessage(message: any): void {
    this.logger.debug('Sarvam TTS message received', { type: message.type });
    
    switch (message.type) {
      case 'audio':
        // Audio data in base64 per Sarvam spec
        if (message.data?.audio) {
          const audioBuffer = Buffer.from(message.data.audio, 'base64');
          this.handleAudioChunk(audioBuffer);
        }
        break;
        
      case 'event':
        // Event notification (e.g., event_type: "final")
        this.logger.debug('TTS event received', { event: message.data?.event_type });
        if (message.data?.event_type === 'final') {
          this.finalizeSession();
        }
        break;
        
      case 'error':
        // Error response per Sarvam spec
        const errorMsg = message.data?.message || 'Unknown Sarvam TTS error';
        this.logger.error('Sarvam TTS error', { error: errorMsg, code: message.data?.code });
        this.emitError(new Error(errorMsg));
        break;
        
      default:
        this.logger.debug('Unknown TTS message type', { message });
    }
  }

  private handleAudioChunk(chunk: Buffer): void {
    this.audioChunks.push(chunk);
    this.emitAudioChunk(chunk);
  }

  private finalizeSession(): void {
    if (!this.isActive) return;
    
    this.isActive = false;
    this.logger.debug('Finalizing TTS session', { 
      audioChunks: this.audioChunks.length,
      sentTextCount: this.sentTextCount
    });
    
    const totalAudio = Buffer.concat(this.audioChunks);
    
    const result: TTSResult = {
      audioContent: totalAudio,
      audioFormat: {
        encoding: 'LINEAR16',
        sampleRateHertz: 22050,
        channels: 1
      },
      durationMs: this.estimateAudioDuration(totalAudio.length),
      latencyMs: Date.now() - this.startTime
    };

    this.emitComplete(result);
    
    // Resolve the completion promise if waiting
    if (this.completionResolver) {
      this.completionResolver();
      this.completionResolver = null;
    }
    
    if (this.ws) {
      this.ws.close(1000, 'Normal closure');
      this.ws = null;
    }
  }

  private estimateAudioDuration(bytes: number): number {
    return Math.round((bytes * 8) / 128);
  }
}

// Register the provider
import { TTSProviderFactory } from '../base/tts-provider';
TTSProviderFactory.register('sarvam', SarvamTTSProvider as any);

export default SarvamTTSProvider;
