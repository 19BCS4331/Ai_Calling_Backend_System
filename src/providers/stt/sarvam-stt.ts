/**
 * Sarvam AI Speech-to-Text Provider
 * Implements WebSocket streaming STT using Sarvam's saarika:v2.5 model
 * 
 * API Reference: https://docs.sarvam.ai/api-reference-docs/speech-to-text/transcribe
 */

import WebSocket from 'ws';
import {
  STTConfig,
  TranscriptionResult,
  STTStreamEvents,
  Logger,
  SupportedLanguage,
  ProviderError
} from '../../types';
import { STTProvider, STTProviderCapabilities, STTStreamSession } from '../base/stt-provider';

const SARVAM_WS_URL = 'wss://api.sarvam.ai/speech-to-text-translate/ws';
const SARVAM_STT_WS_URL = 'wss://api.sarvam.ai/speech-to-text/ws';

interface SarvamSTTConfig extends STTConfig {
  model?: 'saarika:v2.5' | 'saaras:v2.5';
  highVadSensitivity?: boolean;
  vadSignals?: boolean;
  flushSignal?: boolean;
}

export class SarvamSTTProvider extends STTProvider {
  private wsUrl: string;

  constructor(config: SarvamSTTConfig, logger: Logger) {
    super(config, logger);
    this.wsUrl = SARVAM_STT_WS_URL;
  }

  getName(): string {
    return 'sarvam';
  }

  getCapabilities(): STTProviderCapabilities {
    return {
      supportsStreaming: true,
      supportedLanguages: [
        'en-IN', 'hi-IN', 'ta-IN', 'te-IN', 'ml-IN', 
        'kn-IN', 'bn-IN', 'mr-IN', 'gu-IN', 'pa-IN', 'unknown'
      ],
      supportedEncodings: ['wav', 'pcm_s16le', 'pcm_l16', 'pcm_raw'],
      supportsWordTimestamps: true,
      supportsPunctuation: true,
      supportsInterimResults: true,
      maxAudioDurationSeconds: 300
    };
  }

  async initialize(): Promise<void> {
    this.validateConfig();
    this.isInitialized = true;
    this.logger.info('Sarvam STT provider initialized');
  }

  async transcribe(
    audio: Buffer,
    language?: SupportedLanguage
  ): Promise<TranscriptionResult> {
    const startTime = Date.now();
    const effectiveLanguage = this.getEffectiveLanguage(language);

    return new Promise((resolve, reject) => {
      const events: STTStreamEvents = {
        onPartialTranscript: () => {},
        onFinalTranscript: (result) => {
          result.latencyMs = Date.now() - startTime;
          resolve(result);
        },
        onError: (error) => reject(error),
        onEnd: () => {}
      };

      const session = this.createStreamingSession(events, effectiveLanguage);
      session.start()
        .then(() => {
          session.write(audio);
          return session.end();
        })
        .catch(reject);
    });
  }

  createStreamingSession(
    events: STTStreamEvents,
    language?: SupportedLanguage
  ): STTStreamSession {
    const effectiveLanguage = this.getEffectiveLanguage(language);
    const config = this.config as SarvamSTTConfig;

    return new SarvamSTTStreamSession(
      events,
      this.logger,
      {
        apiKey: this.config.credentials.apiKey,
        wsUrl: this.wsUrl,
        language: effectiveLanguage,
        model: config.model || 'saarika:v2.5',
        sampleRate: config.sampleRateHertz || 16000,
        encoding: config.encoding || 'LINEAR16',
        highVadSensitivity: config.highVadSensitivity ?? true,
        vadSignals: config.vadSignals ?? true,
        flushSignal: config.flushSignal ?? false
      }
    );
  }
}

interface SarvamSessionConfig {
  apiKey: string;
  wsUrl: string;
  language: SupportedLanguage;
  model: string;
  sampleRate: number;
  encoding: string;
  highVadSensitivity: boolean;
  vadSignals: boolean;
  flushSignal: boolean;
}

class SarvamSTTStreamSession extends STTStreamSession {
  private ws: WebSocket | null = null;
  private sessionConfig: SarvamSessionConfig;
  private pendingChunks: Buffer[] = [];
  private isConnected: boolean = false;

  constructor(
    events: STTStreamEvents,
    logger: Logger,
    config: SarvamSessionConfig
  ) {
    super(events, logger);
    this.sessionConfig = config;
  }

  async start(): Promise<void> {
    this.startTime = Date.now();
    this.isActive = true;

    const languageCode = this.mapLanguageCode(this.sessionConfig.language);
    
    // Build WebSocket URL with query parameters per Sarvam AsyncAPI spec
    const params = new URLSearchParams({
      'language-code': languageCode,
      'model': this.sessionConfig.model,
      'sample_rate': this.sessionConfig.sampleRate.toString(),
      'input_audio_codec': 'pcm_s16le',  // Required for raw PCM audio
      'high_vad_sensitivity': 'true',
      'vad_signals': 'true'
    });

    const wsUrl = `${this.sessionConfig.wsUrl}?${params.toString()}`;

    this.logger.info('Connecting to Sarvam STT', { 
      url: wsUrl,
      language: languageCode,
      model: this.sessionConfig.model
    });

    return new Promise((resolve, reject) => {
      // Api-Subscription-Key header for authentication
      this.ws = new WebSocket(wsUrl, {
        headers: {
          'Api-Subscription-Key': this.sessionConfig.apiKey
        }
      });

      this.ws.on('open', () => {
        this.isConnected = true;
        this.logger.info('Sarvam STT WebSocket connected successfully');
        
        // Send any pending audio chunks in correct JSON format
        for (const chunk of this.pendingChunks) {
          const audioMessage = {
            audio: {
              data: chunk.toString('base64'),
              sample_rate: this.sessionConfig.sampleRate.toString(),
              encoding: 'audio/wav'
            }
          };
          this.ws?.send(JSON.stringify(audioMessage));
        }
        this.pendingChunks = [];
        
        resolve();
      });

      this.ws.on('message', (data: Buffer) => {
        this.handleMessage(data);
      });

      this.ws.on('error', (error) => {
        this.logger.error('Sarvam STT WebSocket error', { error: error.message });
        this.emitError(error);
        reject(error);
      });

      this.ws.on('close', (code, reason) => {
        this.logger.info('Sarvam STT WebSocket closed', { code, reason: reason.toString() });
        this.isConnected = false;
        this.isActive = false;
        this.emitEnd();
      });
    });
  }

  private _writeCount: number = 0;
  
  write(audioChunk: Buffer): void {
    if (!this.isActive) {
      this.logger.warn('Attempted to write to inactive STT session', {
        isConnected: this.isConnected,
        wsState: this.ws?.readyState,
        chunkSize: audioChunk.length
      });
      return;
    }

    // Log first few writes to confirm audio is flowing
    this._writeCount++;
    if (this._writeCount <= 3 || this._writeCount % 50 === 0) {
      this.logger.info('Writing audio to Sarvam STT', { 
        writeCount: this._writeCount, 
        chunkSize: audioChunk.length,
        isConnected: this.isConnected
      });
    }

    // Format audio as JSON per Sarvam AsyncAPI spec
    // Note: encoding must be 'audio/wav', input_audio_codec in URL specifies actual format
    const audioMessage = {
      audio: {
        data: audioChunk.toString('base64'),
        sample_rate: this.sessionConfig.sampleRate.toString(),
        encoding: 'audio/wav'
      }
    };

    if (this.isConnected && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(audioMessage));
    } else {
      // Queue chunks until connected
      this.pendingChunks.push(audioChunk);
    }
  }

  async end(): Promise<void> {
    if (!this.isActive) return;

    return new Promise((resolve) => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        // Send flush signal if enabled
        if (this.sessionConfig.flushSignal) {
          this.ws.send(JSON.stringify({ type: 'flush' }));
        }
        
        // Close the connection gracefully
        this.ws.close(1000, 'Normal closure');
      }
      
      // Wait for close event or timeout
      const timeout = setTimeout(() => {
        this.isActive = false;
        resolve();
      }, 5000);

      this.ws?.once('close', () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }

  abort(): void {
    this.isActive = false;
    if (this.ws) {
      this.ws.close(1000, 'Aborted');
      this.ws = null;
    }
  }

  private handleMessage(data: Buffer): void {
    try {
      const message = JSON.parse(data.toString());
      
      // Log ALL messages from Sarvam to debug
      this.logger.info('Sarvam STT message received', { 
        type: message.type, 
        hasData: !!message.data,
        rawPreview: data.toString().substring(0, 200)
      });
      
      // Handle response format per Sarvam AsyncAPI spec:
      // { type: "data" | "error" | "events", data: {...} }
      switch (message.type) {
        case 'data':
          // Transcription result
          if (message.data?.transcript !== undefined) {
            this.handleTranscript(message.data, true);
          }
          break;
          
        case 'events':
          // VAD events: START_SPEECH, END_SPEECH
          if (message.data?.signal_type === 'START_SPEECH') {
            this.logger.debug('Speech start detected');
          } else if (message.data?.signal_type === 'END_SPEECH') {
            this.logger.debug('Speech end detected');
          }
          break;
          
        case 'error':
          const errorMsg = message.data?.error || message.message || 'Unknown Sarvam STT error';
          this.logger.error('Sarvam STT error', { error: errorMsg, code: message.data?.code });
          this.emitError(new Error(errorMsg));
          break;
          
        default:
          // Handle any other format
          this.logger.debug('Unknown message type', { message });
          if (message.transcript !== undefined) {
            this.handleTranscript(message, true);
          }
      }
    } catch (error) {
      this.logger.error('Failed to parse Sarvam STT message', { error, raw: data.toString().substring(0, 200) });
    }
  }

  private handleTranscript(message: any, isFinal: boolean): void {
    const result: TranscriptionResult = {
      text: message.transcript || message.text || '',
      isFinal,
      confidence: message.confidence || 0.95,
      language: this.sessionConfig.language,
      latencyMs: Date.now() - this.startTime
    };

    // Add word timestamps if available
    if (message.words) {
      result.words = message.words.map((w: any) => ({
        word: w.word,
        startTime: w.start_time || w.start,
        endTime: w.end_time || w.end,
        confidence: w.confidence || 0.95
      }));
    }

    if (isFinal) {
      this.emitFinal(result);
    } else {
      this.emitPartial(result);
    }
  }

  private mapLanguageCode(language: SupportedLanguage): string {
    // Sarvam uses standard BCP-47 codes
    if (language === 'unknown') return 'unknown';
    return language;
  }
}

// Register the provider
import { STTProviderFactory } from '../base/stt-provider';
STTProviderFactory.register('sarvam', SarvamSTTProvider as any);

export default SarvamSTTProvider;
