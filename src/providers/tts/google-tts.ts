/**
 * Google Cloud Text-to-Speech Provider
 * Implements bidirectional streaming TTS using Google Cloud's StreamingSynthesize API
 * 
 * Requires Chirp 3: HD voices for streaming support.
 * Auth: Uses GOOGLE_APPLICATION_CREDENTIALS (service account JSON) for authentication.
 * 
 * API Reference: https://cloud.google.com/text-to-speech/docs/create-audio-text-streaming
 * Node.js Client: https://googleapis.dev/nodejs/text-to-speech/latest/v1.TextToSpeechClient.html
 */

import path from 'path';
import { TextToSpeechClient } from '@google-cloud/text-to-speech';
import type { google } from '@google-cloud/text-to-speech/build/protos/protos';
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

// Google Cloud TTS Chirp 3: HD voice mappings
const GOOGLE_VOICES: VoiceInfo[] = [
  // English voices
  { id: 'en-US-Chirp3-HD-Charon', name: 'Charon', language: 'en-IN', gender: 'male', description: 'Chirp 3 HD - deep, warm male voice' },
  { id: 'en-US-Chirp3-HD-Kore', name: 'Kore', language: 'en-IN', gender: 'female', description: 'Chirp 3 HD - clear, professional female voice' },
  { id: 'en-US-Chirp3-HD-Fenrir', name: 'Fenrir', language: 'en-IN', gender: 'male', description: 'Chirp 3 HD - authoritative male voice' },
  { id: 'en-US-Chirp3-HD-Aoede', name: 'Aoede', language: 'en-IN', gender: 'female', description: 'Chirp 3 HD - friendly female voice' },
  { id: 'en-US-Chirp3-HD-Puck', name: 'Puck', language: 'en-IN', gender: 'male', description: 'Chirp 3 HD - energetic male voice' },
  { id: 'en-US-Chirp3-HD-Leda', name: 'Leda', language: 'en-IN', gender: 'female', description: 'Chirp 3 HD - soothing female voice' },
  // Hindi voices
  { id: 'hi-IN-Chirp3-HD-Charon', name: 'Charon (Hindi)', language: 'hi-IN', gender: 'male', description: 'Chirp 3 HD Hindi male voice' },
  { id: 'hi-IN-Chirp3-HD-Kore', name: 'Kore (Hindi)', language: 'hi-IN', gender: 'female', description: 'Chirp 3 HD Hindi female voice' },
];

// Google Cloud TTS supported languages (Chirp 3: HD)
const GOOGLE_TTS_LANGUAGES: SupportedLanguage[] = [
  'en-IN', 'hi-IN', 'ta-IN', 'te-IN', 'bn-IN', 'mr-IN', 'gu-IN', 'pa-IN', 'kn-IN', 'ml-IN'
];

// ============================================================================
// Chirp 3: HD Text Preprocessing for Natural Speech
// ============================================================================
// Chirp 3 HD streaming does NOT support SSML tags.
// Instead, it relies on punctuation and text formatting for natural pacing:
//   - Periods (.) = full stop, longer pause
//   - Commas (,) = shorter breath pause
//   - Ellipses (...) = deliberate/dramatic pause, trailing thought
//   - Hyphens (-) = brief pause or break in thought
//   - Contractions (it's, we're) = more conversational tone
//   - Disfluencies (well, um) = added by model automatically
// Reference: https://cloud.google.com/text-to-speech/docs/chirp3-hd
// ============================================================================

/**
 * Preprocess text for Chirp 3: HD streaming synthesis.
 * Applies scripting best practices from Google's documentation to produce
 * more natural, human-like speech output.
 * 
 * NOTE: This is for STREAMING only. For batch/synchronous synthesis,
 * use wrapWithSSML() instead which supports full SSML tags.
 */
function preprocessTextForChirp3(text: string): string {
  let processed = text;

  // 1. Normalize common abbreviations that TTS might mispronounce
  processed = processed.replace(/\bDr\./g, 'Doctor');
  processed = processed.replace(/\bMr\./g, 'Mister');
  processed = processed.replace(/\bMrs\./g, 'Misses');
  processed = processed.replace(/\bMs\./g, 'Miss');
  processed = processed.replace(/\bSt\./g, 'Street');
  processed = processed.replace(/\bAve\./g, 'Avenue');
  processed = processed.replace(/\betc\./g, 'etcetera');
  processed = processed.replace(/\be\.g\./g, 'for example');
  processed = processed.replace(/\bi\.e\./g, 'that is');

  // 2. Expand common symbols for clearer pronunciation
  processed = processed.replace(/&/g, ' and ');
  processed = processed.replace(/@/g, ' at ');
  processed = processed.replace(/%/g, ' percent');

  // 3. Format phone numbers with natural pauses
  //    "8555556689" -> "855, 555, 6689"
  processed = processed.replace(/(\d{3})(\d{3})(\d{4})/g, '$1, $2, $3');
  //    "855-555-6689" -> "855, 555, 6689" (hyphens in phone numbers become pauses)
  processed = processed.replace(/(\d{3})-(\d{3})-(\d{4})/g, '$1, $2, $3');

  // 4. Add comma after greeting/transition words if missing
  //    "So just a quick reminder" -> "So, just a quick reminder"
  processed = processed.replace(/^(So|Now|Well|And|But|Also|Oh|Hi|Hey|Okay|OK)\s/gm, '$1, ');

  // 5. Normalize excessive punctuation
  //    "!!!" -> "!", "???" -> "?", "...." -> "..."
  processed = processed.replace(/!{2,}/g, '!');
  processed = processed.replace(/\?{2,}/g, '?');
  processed = processed.replace(/\.{4,}/g, '...');

  // 6. Ensure bullet points / list items have natural pauses
  //    "- Item one" or "* Item one" -> "Item one."
  processed = processed.replace(/^[\-\*]\s+/gm, '');

  // 7. Clean up excessive whitespace
  processed = processed.replace(/\s{2,}/g, ' ').trim();

  return processed;
}

/**
 * Wrap text with SSML for Chirp 3: HD batch (synchronous) synthesis.
 * SSML is only supported for non-streaming requests.
 * 
 * Supported elements: <speak>, <say-as>, <p>, <s>, <phoneme>, <sub>,
 * <break>, <audio>, <prosody>, <voice>
 */
function wrapWithSSML(text: string, options?: {
  rate?: string;     // e.g., 'medium', 'slow', '90%'
  pitch?: string;    // e.g., 'medium', 'low', '+2st'
  volume?: string;   // e.g., 'medium', 'loud', '+6dB'
}): string {
  let inner = text;

  // Wrap with prosody if any options are set
  if (options?.rate || options?.pitch || options?.volume) {
    const attrs: string[] = [];
    if (options.rate) attrs.push(`rate="${options.rate}"`);
    if (options.pitch) attrs.push(`pitch="${options.pitch}"`);
    if (options.volume) attrs.push(`volume="${options.volume}"`);
    inner = `<prosody ${attrs.join(' ')}>${inner}</prosody>`;
  }

  return `<speak>${inner}</speak>`;
}

// Audio quality presets matching Cartesia's pattern
type AudioQualityMode = 'web' | 'telephony';

interface AudioQualityPreset {
  sampleRateHertz: number;
  bitsPerSample: number;
  isTelephony: boolean;
}

const AUDIO_QUALITY_PRESETS: Record<AudioQualityMode, AudioQualityPreset> = {
  web: {
    sampleRateHertz: 24000,   // High quality for web
    bitsPerSample: 16,
    isTelephony: false
  },
  telephony: {
    sampleRateHertz: 8000,    // Telephony standard
    bitsPerSample: 16,
    isTelephony: true
  }
};

interface GoogleTTSConfig extends TTSConfig {
  audioQuality?: AudioQualityMode;
}

export class GoogleTTSProvider extends TTSProvider {
  private client: TextToSpeechClient | null = null;
  private audioQuality: AudioQualityMode;
  private keyFilename: string | undefined;

  constructor(config: GoogleTTSConfig, logger: Logger) {
    super(config, logger);
    this.audioQuality = config.audioQuality || 'web';
  }

  getName(): string {
    return 'google';
  }

  getCapabilities(): TTSProviderCapabilities {
    return {
      supportsStreaming: true,
      supportedLanguages: GOOGLE_TTS_LANGUAGES,
      supportedVoices: GOOGLE_VOICES,
      supportedAudioFormats: ['LINEAR16', 'MP3', 'OGG_OPUS', 'MULAW', 'ALAW'],
      supportsSSML: true,
      maxTextLength: 5000,
      supportsTokenStreaming: true
    };
  }

  async initialize(): Promise<void> {
    // Google Cloud TTS uses a service account JSON file for auth.
    // Resolve the path from GOOGLE_APPLICATION_CREDENTIALS env var.
    const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (credPath) {
      // Resolve relative paths against cwd
      this.keyFilename = path.isAbsolute(credPath) ? credPath : path.resolve(process.cwd(), credPath);
    }

    this.client = new TextToSpeechClient(
      this.keyFilename ? { keyFilename: this.keyFilename } : undefined
    );
    this.isInitialized = true;
    this.logger.info('Google Cloud TTS provider initialized', {
      audioQuality: this.audioQuality,
      keyFilename: this.keyFilename ? '***set***' : 'default (ADC)'
    });
  }

  async synthesize(
    text: string,
    voice?: VoiceConfig,
    language?: SupportedLanguage
  ): Promise<TTSResult> {
    const startTime = Date.now();
    const effectiveVoice = voice || this.getDefaultVoice(language || 'en-IN');

    return new Promise((resolve, reject) => {
      const audioChunks: Buffer[] = [];
      const session = this.createStreamingSession(
        {
          onAudioChunk: (chunk) => { audioChunks.push(chunk); },
          onComplete: (result) => resolve({
            ...result,
            audioContent: Buffer.concat(audioChunks),
            latencyMs: Date.now() - startTime
          }),
          onError: (error) => reject(error)
        },
        effectiveVoice,
        language
      );

      session.start().then(() => {
        session.sendText(text);
        session.end().catch(reject);
      }).catch(reject);
    });
  }

  createStreamingSession(
    events: TTSStreamEvents,
    voice?: VoiceConfig,
    language?: SupportedLanguage
  ): TTSStreamSession {
    const effectiveVoice = voice || this.config.voice || { voiceId: 'en-IN-Chirp3-HD-Kore' };
    const effectiveLanguage = language || 'en-IN';
    const qualityPreset = AUDIO_QUALITY_PRESETS[this.audioQuality];

    return new GoogleTTSStreamSession(
      events,
      this.logger,
      effectiveVoice,
      effectiveLanguage,
      qualityPreset,
      this.keyFilename
    );
  }

  async getVoices(language?: SupportedLanguage): Promise<VoiceInfo[]> {
    if (language) {
      return GOOGLE_VOICES.filter(v => v.language === language);
    }
    return GOOGLE_VOICES;
  }

  async shutdown(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
    }
    await super.shutdown();
  }
}

/**
 * Google Cloud TTS Streaming Session
 * Uses bidirectional gRPC streaming via StreamingSynthesize
 * 
 * Flow:
 * 1. Call client.streamingSynthesize() to get a duplex stream
 * 2. First write: StreamingSynthesizeConfig (voice selection)
 * 3. Subsequent writes: StreamingSynthesisInput (text chunks)
 * 4. stream.end() to signal no more input
 * 5. Read audio chunks from stream 'data' events
 */
class GoogleTTSStreamSession extends TTSStreamSession {
  private client: TextToSpeechClient | null = null;
  private stream: ReturnType<TextToSpeechClient['streamingSynthesize']> | null = null;
  private voice: VoiceConfig;
  private language: SupportedLanguage;
  private qualityPreset: AudioQualityPreset;
  private keyFilename: string | undefined;
  private completionResolver: (() => void) | null = null;
  private configSent: boolean = false;
  private pendingTexts: string[] = [];

  // Buffer for accumulating PCM before emitting (same pattern as Cartesia)
  private streamBuffer: Buffer[] = [];
  private streamBufferBytes: number = 0;

  // Telephony: 3200 bytes = 200ms at 8kHz 16-bit
  // Web: 9600 bytes = 200ms at 24kHz 16-bit
  private get MIN_CHUNK_BYTES(): number {
    return this.qualityPreset.isTelephony ? 3200 : 9600;
  }

  constructor(
    events: TTSStreamEvents,
    logger: Logger,
    voice: VoiceConfig,
    language: SupportedLanguage,
    qualityPreset: AudioQualityPreset,
    keyFilename?: string
  ) {
    super(events, logger);
    this.voice = voice;
    this.language = language;
    this.qualityPreset = qualityPreset;
    this.keyFilename = keyFilename;
  }

  async start(): Promise<void> {
    this.isActive = true;
    this.startTime = Date.now();

    // Create an authenticated client for this session
    this.client = new TextToSpeechClient(
      this.keyFilename ? { keyFilename: this.keyFilename } : undefined
    );

    // Create bidirectional streaming call
    this.stream = this.client.streamingSynthesize();

    // Handle incoming audio data
    this.stream.on('data', (response: google.cloud.texttospeech.v1.IStreamingSynthesizeResponse) => {
      if (!this.isActive) return;

      if (response.audioContent && response.audioContent.length > 0) {
        const audioBuffer = Buffer.from(response.audioContent as Uint8Array);

        // Accumulate chunks for smooth playback
        this.streamBuffer.push(audioBuffer);
        this.streamBufferBytes += audioBuffer.length;

        if (this.streamBufferBytes >= this.MIN_CHUNK_BYTES) {
          this.flushStreamBuffer();
        }
      }
    });

    this.stream.on('error', (error: Error) => {
      if (!this.isActive) return;
      this.logger.error('Google TTS stream error', { error: error.message });
      this.emitError(error);
      this.finalizeSession();
    });

    this.stream.on('end', () => {
      // Flush remaining buffered audio (only if session wasn't aborted)
      if (this.isActive && this.streamBufferBytes > 0) {
        this.flushStreamBuffer();
      }

      this.logger.debug('Google TTS stream ended', { isActive: this.isActive });

      if (this.completionResolver) {
        this.completionResolver();
        this.completionResolver = null;
      }
      this.finalizeSession();
    });

    // Send the config message first (required before any text)
    this.sendConfig();

    // Flush any text that was queued before start completed
    this.flushPendingTexts();

    this.logger.debug('Google TTS streaming session started', {
      voice: this.getVoiceName(),
      language: this.language,
      sampleRate: this.qualityPreset.sampleRateHertz
    });
  }

  sendText(text: string): void {
    if (!this.isActive) {
      this.logger.warn('Attempted to send text to inactive Google TTS session');
      return;
    }

    if (this.stream && this.configSent) {
      this.sendTextMessage(text);
    } else {
      this.pendingTexts.push(text);
      this.logger.debug('Queued text for Google TTS', { queueLength: this.pendingTexts.length });
    }
  }

  async end(): Promise<void> {
    if (!this.isActive) return;

    return new Promise((resolve) => {
      this.completionResolver = resolve;

      // Signal no more input — gRPC stream will emit 'end' when done
      if (this.stream) {
        this.stream.end();
      } else {
        this.finalizeSession();
        resolve();
      }

      // Safety timeout
      setTimeout(() => {
        if (this.completionResolver) {
          this.logger.debug('Google TTS session end timeout - finalizing');
          this.completionResolver = null;
          this.finalizeSession();
          resolve();
        }
      }, 15000);
    });
  }

  abort(): void {
    if (!this.isActive) return;

    this.logger.debug('Aborting Google TTS session');

    // Destroy the gRPC stream — this immediately stops both read and write
    if (this.stream) {
      this.stream.destroy();
      this.stream = null;
    }

    this.finalizeSession();
  }

  /**
   * Send the initial config message
   * Must be the first write to the stream
   */
  private sendConfig(): void {
    if (!this.stream) return;

    const voiceName = this.getVoiceName();
    // Extract language code from voice name (e.g., "en-US-Chirp3-HD-Charon" -> "en-US")
    const languageCode = this.getLanguageCode();

    // StreamingSynthesize only supports: PCM, ALAW, MULAW, OGG_OPUS
    // (LINEAR16 is only valid for the batch synthesize endpoint)
    // Use PCM for both modes — the telephony adapter handles PCM->mulaw conversion
    const audioEncoding = 'PCM';

    const configRequest = {
      streamingConfig: {
        voice: {
          name: voiceName,
          languageCode: languageCode,
        },
        streamingAudioConfig: {
          audioEncoding,
          sampleRateHertz: this.qualityPreset.sampleRateHertz,
        }
      }
    };

    this.stream.write(configRequest);
    this.configSent = true;

    this.logger.debug('Google TTS config sent', {
      voiceName,
      languageCode,
      sampleRate: this.qualityPreset.sampleRateHertz
    });
  }

  /**
   * Send a text input message to the stream.
   * Applies Chirp 3: HD text preprocessing for natural-sounding output.
   * (SSML is NOT supported for streaming — only punctuation-based pacing)
   */
  private sendTextMessage(text: string): void {
    if (!this.stream) {
      this.logger.warn('Cannot send text - stream not ready');
      return;
    }

    // Apply Chirp 3 HD text preprocessing for more natural speech
    const processedText = preprocessTextForChirp3(text);

    const inputRequest = {
      input: {
        text: processedText
      }
    };

    this.stream.write(inputRequest);

    this.logger.debug('Sent text to Google TTS', {
      originalLength: text.length,
      processedLength: processedText.length,
      preview: processedText.substring(0, 80)
    });
  }

  /**
   * Flush any texts queued before stream was ready
   */
  private flushPendingTexts(): void {
    while (this.pendingTexts.length > 0) {
      const text = this.pendingTexts.shift()!;
      this.sendTextMessage(text);
    }
  }

  /**
   * Flush accumulated audio buffer
   * For telephony: raw PCM (no WAV header)
   * For web: wrap with WAV header for browser playback
   */
  private flushStreamBuffer(): void {
    if (this.streamBuffer.length === 0) return;

    const pcmData = Buffer.concat(this.streamBuffer);

    if (this.qualityPreset.isTelephony) {
      // Telephony mode: emit raw PCM
      this.emitAudioChunk(pcmData);
    } else {
      // Web mode: wrap with WAV header
      const wavChunk = this.pcmToWav(
        pcmData,
        this.qualityPreset.sampleRateHertz,
        1,
        this.qualityPreset.bitsPerSample
      );
      this.emitAudioChunk(wavChunk);
    }

    this.streamBuffer = [];
    this.streamBufferBytes = 0;
  }

  /**
   * Get the voice name to use for the TTS request
   * Maps our VoiceConfig to Google Cloud TTS voice names
   */
  private getVoiceName(): string {
    // If voiceId is already a full Google voice name, use it directly
    const voiceId = this.voice.voiceId || (this.voice as any).id || '';
    if (voiceId.includes('Chirp3')) {
      return voiceId;
    }

    // Map agent language to a default Chirp 3: HD voice
    // Voice format: <locale>-Chirp3-HD-<VoiceName>
    const langPrefix = this.language === 'unknown' ? 'en-US' : this.language;
    const gender = this.voice.gender || 'female';
    const defaultVoice = gender === 'female' ? 'Kore' : 'Charon';
    return `${langPrefix}-Chirp3-HD-${defaultVoice}`;
  }

  /**
   * Get the Google Cloud TTS language code
   * MUST match the voice name's locale prefix exactly.
   * e.g., voice 'en-IN-Chirp3-HD-Kore' requires languageCode 'en-IN'
   */
  private getLanguageCode(): string {
    // Always extract from the voice name to guarantee they match
    const voiceName = this.getVoiceName();
    const match = voiceName.match(/^([a-z]{2,3}-[A-Z]{2})/);
    if (match) return match[1];

    // Fallback
    if (this.language === 'unknown') return 'en-US';
    return this.language;
  }

  /**
   * Create WAV header for streaming audio
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
    wavHeader.writeUInt32LE(16, 16);
    wavHeader.writeUInt16LE(1, 20);
    wavHeader.writeUInt16LE(channels, 22);
    wavHeader.writeUInt32LE(sampleRate, 24);
    wavHeader.writeUInt32LE(byteRate, 28);
    wavHeader.writeUInt16LE(blockAlign, 32);
    wavHeader.writeUInt16LE(bitsPerSample, 34);

    // data chunk
    wavHeader.write('data', 36);
    wavHeader.writeUInt32LE(dataSize, 40);

    return wavHeader;
  }

  /**
   * Convert raw PCM audio to WAV format
   */
  private pcmToWav(pcmData: Buffer, sampleRate: number, channels: number, bitsPerSample: number): Buffer {
    const header = this.createWavHeader(pcmData.length, sampleRate, channels, bitsPerSample);
    return Buffer.concat([header, pcmData]);
  }

  private finalizeSession(): void {
    this.isActive = false;

    if (this.stream) {
      try {
        this.stream.destroy();
      } catch (e) {
        // Ignore errors during cleanup
      }
      this.stream = null;
    }

    if (this.client) {
      this.client.close().catch(() => {});
      this.client = null;
    }

    this.emitComplete({
      audioContent: Buffer.alloc(0),
      audioFormat: { encoding: 'LINEAR16', sampleRateHertz: this.qualityPreset.sampleRateHertz, channels: 1 },
      durationMs: 0,
      latencyMs: Date.now() - this.startTime
    });
  }
}

// Register the provider
import { TTSProviderFactory } from '../base/tts-provider';
TTSProviderFactory.register('google', GoogleTTSProvider as any);

export default GoogleTTSProvider;
