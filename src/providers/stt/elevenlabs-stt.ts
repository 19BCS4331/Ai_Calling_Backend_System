/**
 * ElevenLabs Speech-to-Text Provider
 * Implements WebSocket streaming STT using ElevenLabs Scribe v2 Realtime model
 * 
 * Based on Pipecat's reference implementation:
 * https://github.com/pipecat-ai/pipecat/blob/main/src/pipecat/services/elevenlabs/stt.py
 * 
 * Features:
 * - Smart automatic language detection (no language config needed)
 * - commit_strategy=vad — ElevenLabs VAD handles turn boundaries
 * - Partial transcripts (interim) + committed transcripts (final)
 * - Word-level timestamps
 * - PCM audio input via base64 JSON messages
 * - Keepalive to prevent idle disconnect
 * 
 * API Reference: https://elevenlabs.io/docs/api-reference/speech-to-text/v-1-speech-to-text-realtime
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

const ELEVENLABS_STT_WS_URL = 'wss://api.elevenlabs.io/v1/speech-to-text/realtime';

interface ElevenLabsSTTConfig extends STTConfig {
  model?: string;
  includeTimestamps?: boolean;
  vadSilenceThresholdSecs?: number;
}

export class ElevenLabsSTTProvider extends STTProvider {
  constructor(config: ElevenLabsSTTConfig, logger: Logger) {
    super(config, logger);
  }

  getName(): string {
    return 'elevenlabs';
  }

  getCapabilities(): STTProviderCapabilities {
    return {
      supportsStreaming: true,
      supportedLanguages: [
        // ElevenLabs Scribe v2 supports 32+ languages with auto-detection
        'en-IN', 'hi-IN', 'ta-IN', 'te-IN', 'ml-IN',
        'kn-IN', 'bn-IN', 'mr-IN', 'gu-IN', 'pa-IN', 'unknown'
      ],
      supportedEncodings: ['pcm_s16le', 'pcm_l16'],
      supportsWordTimestamps: true,
      supportsPunctuation: true,
      supportsInterimResults: true,
      maxAudioDurationSeconds: 600
    };
  }

  async initialize(): Promise<void> {
    this.validateConfig();
    this.isInitialized = true;
    this.logger.info('ElevenLabs STT provider initialized');
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
    const config = this.config as ElevenLabsSTTConfig;

    return new ElevenLabsSTTStreamSession(
      events,
      this.logger,
      {
        apiKey: this.config.credentials.apiKey,
        language: effectiveLanguage,
        model: config.model || 'scribe_v2_realtime',
        sampleRate: config.sampleRateHertz || 16000,
        includeTimestamps: config.includeTimestamps ?? false,
        vadSilenceThresholdSecs: config.vadSilenceThresholdSecs ?? 1.0
      }
    );
  }
}

/**
 * Get the ElevenLabs audio format string for a given sample rate.
 * Must match: pcm_8000, pcm_16000, pcm_22050, pcm_24000, pcm_44100, pcm_48000
 */
function audioFormatFromSampleRate(sampleRate: number): string {
  const validRates = [8000, 16000, 22050, 24000, 44100, 48000];
  if (validRates.includes(sampleRate)) {
    return `pcm_${sampleRate}`;
  }
  return 'pcm_16000'; // fallback
}

interface ElevenLabsSessionConfig {
  apiKey: string;
  language: SupportedLanguage;
  model: string;
  sampleRate: number;
  includeTimestamps: boolean;
  vadSilenceThresholdSecs: number;
}

class ElevenLabsSTTStreamSession extends STTStreamSession {
  private ws: WebSocket | null = null;
  private sessionConfig: ElevenLabsSessionConfig;
  private pendingChunks: Buffer[] = [];
  private isConnected: boolean = false;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 3;
  private isReconnecting: boolean = false;
  private inactiveWriteWarned: boolean = false;
  private sessionStarted: boolean = false;
  private keepaliveTimer: NodeJS.Timeout | null = null;
  private wsUrl: string = '';

  constructor(
    events: STTStreamEvents,
    logger: Logger,
    config: ElevenLabsSessionConfig
  ) {
    super(events, logger);
    this.sessionConfig = config;
  }

  async start(): Promise<void> {
    this.startTime = Date.now();
    this.isActive = true;

    // Build WebSocket URL with query parameters (per Pipecat reference)
    const audioFormat = audioFormatFromSampleRate(this.sessionConfig.sampleRate);
    const params: string[] = [
      `model_id=${this.sessionConfig.model}`,
      `audio_format=${audioFormat}`,
      `commit_strategy=vad`,
      `vad_silence_threshold_secs=${this.sessionConfig.vadSilenceThresholdSecs}`,
    ];

    // ElevenLabs has smart auto language detection — only set language_code if explicitly specified
    if (this.sessionConfig.language !== 'unknown') {
      // Map BCP-47 to ISO 639-3 for ElevenLabs (e.g., 'en-IN' -> 'eng', 'hi-IN' -> 'hin')
      const langCode = this.mapLanguageCode(this.sessionConfig.language);
      if (langCode) {
        params.push(`language_code=${langCode}`);
      }
    }

    if (this.sessionConfig.includeTimestamps) {
      params.push('include_timestamps=true');
    }

    this.wsUrl = `${ELEVENLABS_STT_WS_URL}?${params.join('&')}`;

    this.logger.info('Connecting to ElevenLabs STT', {
      url: ELEVENLABS_STT_WS_URL,
      model: this.sessionConfig.model,
      audioFormat,
      commitStrategy: 'vad',
      vadSilenceThresholdSecs: this.sessionConfig.vadSilenceThresholdSecs,
      language: this.sessionConfig.language,
      includeTimestamps: this.sessionConfig.includeTimestamps,
      hasApiKey: !!this.sessionConfig.apiKey,
      apiKeyPrefix: this.sessionConfig.apiKey ? this.sessionConfig.apiKey.substring(0, 6) + '...' : 'MISSING'
    });

    return this.connectWebSocket();
  }

  private connectWebSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl, {
        headers: {
          'xi-api-key': this.sessionConfig.apiKey
        }
      });

      this.ws.on('open', () => {
        this.isConnected = true;
        this.logger.info('ElevenLabs STT WebSocket connected');
        this.startKeepalive();
        // Don't resolve yet — wait for session_started message
      });

      this.ws.on('message', (data: Buffer) => {
        this.handleMessage(data);

        // Resolve the start() promise once we get session_started
        if (this.sessionStarted && resolve) {
          const r = resolve;
          resolve = null as any;
          
          // Flush any pending audio chunks
          this.flushPendingChunks();
          
          r();
        }
      });

      this.ws.on('error', (error) => {
        this.logger.error('ElevenLabs STT WebSocket error', { error: error.message });
        if (resolve) {
          const r = reject;
          resolve = null as any;
          reject = null as any;
          this.emitError(error);
          r(error);
        } else {
          this.emitError(error);
        }
      });

      this.ws.on('close', (code, reason) => {
        this.logger.info('ElevenLabs STT WebSocket closed', { code, reason: reason.toString() });
        this.isConnected = false;
        this.stopKeepalive();

        // Auto-reconnect on unexpected close
        if (code !== 1000 && this.isActive && !this.isReconnecting && this.reconnectAttempts < this.maxReconnectAttempts) {
          this.logger.warn('ElevenLabs STT unexpected disconnect, attempting reconnect', {
            code,
            attempt: this.reconnectAttempts + 1,
            maxAttempts: this.maxReconnectAttempts
          });
          this.reconnect();
          return;
        }

        this.isActive = false;
        this.emitEnd();
      });

      // Timeout for initial connection
      setTimeout(() => {
        if (resolve) {
          const r = reject;
          resolve = null as any;
          reject = null as any;
          r(new Error('ElevenLabs STT connection timeout'));
        }
      }, 10000);
    });
  }

  /**
   * Send silent audio every 5s to prevent ElevenLabs idle disconnect.
   * Per Pipecat: keepalive_interval=5, keepalive_timeout=10
   */
  private startKeepalive(): void {
    this.stopKeepalive();
    this.keepaliveTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        // Send 100ms of silent PCM audio (all zeros)
        const silentSamples = Math.floor(this.sessionConfig.sampleRate * 0.1); // 100ms
        const silentBuffer = Buffer.alloc(silentSamples * 2); // 16-bit = 2 bytes per sample
        this.sendAudioChunk(silentBuffer);
      }
    }, 5000);
  }

  private stopKeepalive(): void {
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
  }

  write(audioChunk: Buffer): void {
    if (!this.isActive) {
      if (!this.inactiveWriteWarned) {
        this.inactiveWriteWarned = true;
        this.logger.warn('ElevenLabs STT session inactive, dropping audio chunks', {
          isConnected: this.isConnected,
          wsState: this.ws?.readyState,
          chunkSize: audioChunk.length
        });
      }
      return;
    }

    if (this.isConnected && this.sessionStarted && this.ws?.readyState === WebSocket.OPEN) {
      this.sendAudioChunk(audioChunk);
    } else {
      // Queue chunks until connected and session started
      this.pendingChunks.push(audioChunk);
    }
  }

  private sendAudioChunk(chunk: Buffer): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const message = {
      message_type: 'input_audio_chunk',
      audio_base_64: chunk.toString('base64'),
      commit: false,
      sample_rate: this.sessionConfig.sampleRate
    };

    this.ws.send(JSON.stringify(message));
  }

  private flushPendingChunks(): void {
    for (const chunk of this.pendingChunks) {
      this.sendAudioChunk(chunk);
    }
    this.pendingChunks = [];
  }

  async end(): Promise<void> {
    if (!this.isActive) return;
    this.stopKeepalive();

    return new Promise((resolve) => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        // With VAD commit strategy, ElevenLabs handles committing.
        // Just close gracefully after a short delay to let final transcript arrive.
        setTimeout(() => {
          if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.close(1000, 'Normal closure');
          }
          this.isActive = false;
          resolve();
        }, 1000);
      } else {
        this.isActive = false;
        resolve();
      }
    });
  }

  abort(): void {
    this.isActive = false;
    this.isReconnecting = false;
    this.sessionStarted = false;
    this.stopKeepalive();
    if (this.ws) {
      this.ws.close(1000, 'Aborted');
      this.ws = null;
    }
  }

  private reconnect(): void {
    this.isReconnecting = true;
    this.reconnectAttempts++;
    this.sessionStarted = false;

    setTimeout(() => {
      if (!this.isActive) {
        this.isReconnecting = false;
        return;
      }

      this.logger.info('ElevenLabs STT reconnecting', { attempt: this.reconnectAttempts });

      this.ws = new WebSocket(this.wsUrl, {
        headers: {
          'xi-api-key': this.sessionConfig.apiKey
        }
      });

      this.ws.on('open', () => {
        this.isConnected = true;
        this.isReconnecting = false;
        this.inactiveWriteWarned = false;
        this.startKeepalive();
        this.logger.info('ElevenLabs STT reconnected successfully', { attempt: this.reconnectAttempts });
      });

      this.ws.on('message', (data: Buffer) => {
        this.handleMessage(data);

        // Flush pending chunks once session is started
        if (this.sessionStarted && this.pendingChunks.length > 0) {
          this.flushPendingChunks();
        }
      });

      this.ws.on('error', (error) => {
        this.logger.error('ElevenLabs STT reconnect error', { error: error.message, attempt: this.reconnectAttempts });
        this.isReconnecting = false;
      });

      this.ws.on('close', (code, reason) => {
        this.logger.info('ElevenLabs STT WebSocket closed (reconnected session)', { code, reason: reason.toString() });
        this.isConnected = false;
        this.stopKeepalive();

        if (code !== 1000 && this.isActive && !this.isReconnecting && this.reconnectAttempts < this.maxReconnectAttempts) {
          this.logger.warn('ElevenLabs STT reconnected session dropped, retrying', { attempt: this.reconnectAttempts + 1 });
          this.reconnect();
          return;
        }

        this.isActive = false;
        this.isReconnecting = false;
        this.emitEnd();
      });
    }, 500);
  }

  private handleMessage(data: Buffer): void {
    if (!this.isActive) return;

    try {
      const message = JSON.parse(data.toString());

      switch (message.message_type) {
        case 'session_started':
          this.sessionStarted = true;
          this.logger.info('ElevenLabs STT session started', {
            sessionId: message.session_id
          });
          break;

        case 'partial_transcript':
          if (message.text) {
            this.emitPartial({
              text: message.text,
              isFinal: false,
              confidence: 0.9,
              language: this.detectLanguage(message),
              latencyMs: Date.now() - this.startTime
            });
          }
          break;

        case 'committed_transcript':
          // Per Pipecat: when include_timestamps is true, skip committed_transcript
          // and wait for committed_transcript_with_timestamps (which contains all data).
          // This prevents double emitFinal for the same utterance.
          if (this.sessionConfig.includeTimestamps) {
            // Skip — will be handled by committed_transcript_with_timestamps
            break;
          }
          if (message.text) {
            this.logger.info('ElevenLabs STT final transcript', {
              text: message.text,
              length: message.text.length
            });
            this.emitFinal({
              text: message.text,
              isFinal: true,
              confidence: 0.95,
              language: this.detectLanguage(message),
              latencyMs: Date.now() - this.startTime
            });
          }
          break;

        case 'committed_transcript_with_timestamps':
          // When timestamps are enabled, this is the authoritative final event.
          // Extract the text and word timestamps.
          if (message.text) {
            const result: TranscriptionResult = {
              text: message.text,
              isFinal: true,
              confidence: 0.95,
              language: this.detectLanguage(message),
              latencyMs: Date.now() - this.startTime
            };
            if (message.words && message.words.length > 0) {
              result.words = message.words.map((w: any) => ({
                word: w.word || w.text || '',
                startTime: w.start || w.start_time || 0,
                endTime: w.end || w.end_time || 0,
                confidence: 0.95
              }));
            }
            this.logger.info('ElevenLabs STT final transcript (with timestamps)', {
              text: message.text,
              length: message.text.length,
              wordCount: result.words?.length || 0
            });
            this.emitFinal(result);
          }
          break;

        case 'input_error':
          this.logger.error('ElevenLabs STT input error', {
            error: message.error || message.message || 'Unknown input error'
          });
          this.emitError(new Error(message.error || message.message || 'ElevenLabs STT input error'));
          break;

        default:
          if (message.error) {
            this.logger.error('ElevenLabs STT error response', { error: message.error });
            this.emitError(new Error(message.error));
          } else {
            this.logger.debug('ElevenLabs STT unknown message', { type: message.message_type });
          }
      }
    } catch (error) {
      this.logger.error('Failed to parse ElevenLabs STT message', {
        error,
        raw: data.toString().substring(0, 200)
      });
    }
  }

  private detectLanguage(message: any): SupportedLanguage {
    // ElevenLabs may include detected language in the response
    if (message.language_code) {
      return this.mapElevenLabsLanguage(message.language_code);
    }
    return this.sessionConfig.language;
  }

  private mapLanguageCode(language: SupportedLanguage): string | null {
    // Map BCP-47 (en-IN, hi-IN) to ISO 639-3 (eng, hin) for ElevenLabs
    // Per Pipecat reference implementation
    if (language === 'unknown') return null;
    const mapping: Record<string, string> = {
      'en-IN': 'eng',
      'hi-IN': 'hin',
      'ta-IN': 'tam',
      'te-IN': 'tel',
      'ml-IN': 'mal',
      'kn-IN': 'kan',
      'bn-IN': 'ben',
      'mr-IN': 'mar',
      'gu-IN': 'guj',
      'pa-IN': 'pan'
    };
    return mapping[language] || null;
  }

  private mapElevenLabsLanguage(langCode: string): SupportedLanguage {
    // Map ElevenLabs ISO 639-3 codes back to our BCP-47 format
    const mapping: Record<string, SupportedLanguage> = {
      'eng': 'en-IN',
      'hin': 'hi-IN',
      'tam': 'ta-IN',
      'tel': 'te-IN',
      'mal': 'ml-IN',
      'kan': 'kn-IN',
      'ben': 'bn-IN',
      'mar': 'mr-IN',
      'guj': 'gu-IN',
      'pan': 'pa-IN',
      // Also handle ISO 639-1 codes in case ElevenLabs sends those
      'en': 'en-IN',
      'hi': 'hi-IN',
      'ta': 'ta-IN',
      'te': 'te-IN',
      'ml': 'ml-IN',
      'kn': 'kn-IN',
      'bn': 'bn-IN',
      'mr': 'mr-IN',
      'gu': 'gu-IN',
      'pa': 'pa-IN'
    };
    return mapping[langCode] || 'unknown';
  }
}

// Register the provider
import { STTProviderFactory } from '../base/stt-provider';
STTProviderFactory.register('elevenlabs', ElevenLabsSTTProvider as any);

export default ElevenLabsSTTProvider;
