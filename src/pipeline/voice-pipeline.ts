/**

 * Streaming Voice Pipeline

 * Orchestrates STT → LLM → TTS flow with low latency streaming

 * Target: sub-800ms end-to-end latency

 */



import { EventEmitter } from 'events';

import {

  CallSession,

  ChatMessage,

  ToolDefinition,

  ToolCall,

  TranscriptionResult,

  LLMResponse,

  TTSResult,

  VoiceAgentEvent,

  Logger,

  PipelineMetrics,

  PipelineStage,

  SupportedLanguage,

  LatencyOptimizationConfig,

  DEFAULT_LATENCY_CONFIG

} from '../types';

import { STTProvider, STTStreamSession } from '../providers/base/stt-provider';

import { LLMProvider, LLMStreamSession } from '../providers/base/llm-provider';

import { TTSProvider, TTSStreamSession } from '../providers/base/tts-provider';

import { ToolRegistry } from '../tools/tool-registry';

import { AudioCacheService } from '../services/audio-cache';



export interface VoicePipelineConfig {

  enableBargeIn: boolean;

  sttPartialThreshold: number;  // Min chars before starting LLM

  llmSentenceBuffer: number;     // Min chars before starting TTS

  maxTurnDuration: number;       // Max ms for a single turn

  silenceTimeout: number;        // Ms of silence before ending turn

  latencyOptimization: LatencyOptimizationConfig;  // Phase 1 optimizations

  // Token optimization settings

  maxHistoryTurns: number;       // Max conversation turns to keep (default: 10)

  maxHistoryTokens: number;      // Approximate max tokens for history (default: 4000)

  maxTools: number;              // Max tools to send to LLM (default: 15, 0 = unlimited)

  compressTools: boolean;        // Compress tool definitions to save tokens (default: true)

  // Agent behavior settings (from UI)

  firstMessage: string | null;          // AI speaks first when session starts

  endCallPhrases: string[];             // Phrases that trigger call end

  interruptionSensitivity: number;      // 0-1, controls barge-in threshold

  maxCallDurationSeconds: number;       // Max call duration before auto-end

}



export interface PipelineEvents {

  onSttPartial: (text: string) => void;

  onSttFinal: (text: string) => void;

  onLlmToken: (token: string) => void;

  onLlmSentence: (sentence: string) => void;

  onLlmToolCall: (toolCall: ToolCall) => void;

  onTtsAudioChunk: (chunk: Buffer) => void;

  onTurnComplete: (metrics: PipelineMetrics) => void;

  onError: (error: Error) => void;

  onBargeIn: () => void;

}



export class VoicePipeline extends EventEmitter {

  private session: CallSession;

  private sttProvider: STTProvider;

  private llmProvider: LLMProvider;

  private ttsProvider: TTSProvider;

  private toolRegistry: ToolRegistry;

  private logger: Logger;

  private config: VoicePipelineConfig;



  private sttSession: STTStreamSession | null = null;

  private llmSession: LLMStreamSession | null = null;

  private ttsSession: TTSStreamSession | null = null;



  private isActive: boolean = false;

  private isProcessingTurn: boolean = false;

  private currentTurnStart: number = 0;

  private pendingSentences: string[] = [];

  private metrics: PipelineMetrics;

  

  // Low-latency streaming state

  private firstLLMTokenTime: number = 0;

  private firstTTSByteTime: number = 0;

  private ttsSessionReady: boolean = false;

  private ttsSentText: boolean = false;  // Track if any text was sent to TTS

  private pendingEndCall: boolean = false;  // True when end_call tool detected, prevents TTS teardown

  // Generation ID: prevents stale TTS sessions from leaking audio.
  // Incremented on each generateLLMResponse() and handleBargeIn().
  // onAudioChunk captures this at creation; discards audio if stale.
  private ttsGenerationId: number = 0;

  // Token-level TTS streaming: when true, raw LLM tokens are sent directly to TTS
  // instead of splitting into sentences. Google TTS needs this to guarantee audio ordering.
  private useTokenStreaming: boolean = false;
  private tokenBuffer: string = '';  // Accumulates tokens until word boundary before sending to TTS



  // Audio cache for filler phrases (Phase 1 optimization)

  private audioCache: AudioCacheService | null = null;

  private isTTSPlaying: boolean = false;



  // Phase 2: Barge-in history truncation

  private currentAssistantMessage: string = '';  // Full message being generated

  private playedAudioText: string = '';          // Text that was actually spoken

  private ttsTextQueue: string[] = [];           // Sentences sent to TTS

  private ttsSentenceIndex: number = 0;          // Current sentence being played



  // Phase 2: Enhanced echo suppression

  private ttsPlaybackStartTime: number = 0;

  private ttsPlaybackEndTime: number = 0;

  private echoSuppressionWindowMs: number = 500;  // Ignore STT for this long after TTS ends

  private lastSTTConfidence: number = 0;



  // Phase 3: Tool execution state management

  private isExecutingTool: boolean = false;       // True while tool is being executed

  private queuedUserInput: string | null = null;  // User speech captured during tool execution



  // Phase 3.5: TTS sentence queue (FIFO ordering fix)

  private sentenceQueue: string[] = [];           // Queue of sentences waiting to be sent to TTS

  private isProcessingSentenceQueue: boolean = false;  // Prevent concurrent queue processing



  // Phase 4: Advanced Turn Detection

  // Silence debounce - wait for sustained silence before processing

  private silenceDebounceTimer: NodeJS.Timeout | null = null;

  private accumulatedTranscript: string = '';     // Accumulate speech across multiple STT finals

  private lastSpeechTime: number = 0;             // Track when user last spoke

  private isSpeaking: boolean = false;            // Track if user is currently speaking



  // Phase 5: Speculative LLM Triggering

  // Start LLM early for high-confidence turns, abort if user continues

  private speculativeAbortController: AbortController | null = null;

  private isSpeculativeExecution: boolean = false;

  // Deduplication: prevent same text from triggering multiple LLM calls
  private lastProcessedText: string = '';
  private lastProcessedTime: number = 0;



  constructor(

    session: CallSession,

    sttProvider: STTProvider,

    llmProvider: LLMProvider,

    ttsProvider: TTSProvider,

    toolRegistry: ToolRegistry,

    logger: Logger,

    config?: Partial<VoicePipelineConfig>,

    audioCache?: AudioCacheService

  ) {

    super();

    this.session = session;

    this.sttProvider = sttProvider;

    this.llmProvider = llmProvider;

    this.ttsProvider = ttsProvider;

    this.toolRegistry = toolRegistry;

    this.logger = logger.child({ sessionId: session.sessionId, component: 'pipeline' });

    this.audioCache = audioCache || null;



    // Map interruption sensitivity (0-1) to VAD aggressiveness
    // 0 = less sensitive (requires more speech frames, stricter thresholds)
    // 1 = more sensitive (fewer frames required, looser thresholds)
    const sensitivity = config?.interruptionSensitivity ?? 0.5;
    this.bargeInSensitivity = sensitivity;
    // Require 4 frames at low sensitivity, 2 at high — prevents AC/noise false triggers
    this.bargeInFramesRequired = sensitivity >= 0.7 ? 2 : sensitivity >= 0.4 ? 3 : 4;
    // More silence frames required to reset at low sensitivity (sticky barge-in)
    this.bargeInCooldownFrames = sensitivity >= 0.7 ? 5 : 8;

    this.config = {

      enableBargeIn: config?.enableBargeIn ?? true,

      sttPartialThreshold: config?.sttPartialThreshold ?? 5,

      llmSentenceBuffer: config?.llmSentenceBuffer ?? 20,

      maxTurnDuration: config?.maxTurnDuration ?? 30000,

      silenceTimeout: config?.silenceTimeout ?? 2000,

      latencyOptimization: config?.latencyOptimization ?? DEFAULT_LATENCY_CONFIG,

      // Token optimization: keep last 10 turns (~20 messages) or ~4000 tokens

      maxHistoryTurns: config?.maxHistoryTurns ?? 10,

      maxHistoryTokens: config?.maxHistoryTokens ?? 4000,

      // Tool optimization: 0 = unlimited (Gemini 2.5 Flash implicit caching handles token cost)

      // Implicit caching gives 75% discount on repeated prefixes (min 1024 tokens)

      maxTools: config?.maxTools ?? 0,

      compressTools: config?.compressTools ?? true,

      // Agent behavior settings

      firstMessage: config?.firstMessage ?? null,

      endCallPhrases: config?.endCallPhrases ?? [],

      interruptionSensitivity: sensitivity,

      maxCallDurationSeconds: config?.maxCallDurationSeconds ?? 600

    };



    this.metrics = this.createEmptyMetrics();

    // Check if TTS provider supports token-level streaming
    // Google TTS concatenates text fragments into one continuous audio stream,
    // so we must stream raw tokens instead of splitting into sentences
    this.useTokenStreaming = this.ttsProvider.getCapabilities().supportsTokenStreaming === true;
    if (this.useTokenStreaming) {
      this.logger.info('Token-level TTS streaming enabled (provider: ' + this.ttsProvider.getName() + ')');
    }

  }



  /**

   * Start the voice pipeline

   */

  async start(): Promise<void> {

    this.isActive = true;

    this.logger.info('Voice pipeline starting - initializing providers');

    

    // Initialize all providers

    this.logger.debug('Initializing STT provider');

    await this.sttProvider.initialize();

    this.logger.debug('STT provider initialized');

    

    this.logger.debug('Initializing LLM provider');

    await this.llmProvider.initialize();

    this.logger.debug('LLM provider initialized');

    

    this.logger.debug('Initializing TTS provider');

    await this.ttsProvider.initialize();

    this.logger.debug('TTS provider initialized');



    // LATENCY OPTIMIZATION: Pre-warm LLM cache with system prompt + tools

    // This eliminates ~1.5s latency on the first turn by creating the cache

    // before the user speaks, instead of blocking on the first LLM request

    if (this.llmProvider.getName() === 'gemini' && typeof (this.llmProvider as any).prewarmCache === 'function') {

      this.logger.debug('Pre-warming Gemini cache with tools');

      const tools = this.toolRegistry.getDefinitions();

      const systemPrompt = this.session.llmConfig.systemPrompt;

      

      // Pre-warm cache asynchronously (don't block STT session start)

      (this.llmProvider as any).prewarmCache(systemPrompt, tools).catch((error: Error) => {

        this.logger.warn('Cache pre-warming failed, will create on first request', { 

          error: error.message 

        });

      });

    }



    // TTS provider is already initialized above

    // Cartesia doesn't support connection pre-warming (rejects empty transcripts)

    // Connection overhead is minimal (~50ms) and handled efficiently by Cartesia



    // Start STT streaming session

    this.logger.debug('Starting STT streaming session');

    await this.startSTTSession();

    this.logger.info('Voice pipeline started successfully');

    // AI-speaks-first: if firstMessage is configured, TTS it immediately
    if (this.config.firstMessage) {
      this.logger.info('AI speaks first - sending first message', {
        message: this.config.firstMessage
      });
      // Add to conversation history as assistant message
      this.session.messages.push({
        role: 'assistant',
        content: this.config.firstMessage
      });
      // Start TTS session first (normally only started during generateLLMResponse)
      this.startTTSSessionAsync();
      // Wait for TTS to be ready, then send
      const waitForTTS = async () => {
        const maxWait = 5000;
        const start = Date.now();
        while (!this.ttsSessionReady && Date.now() - start < maxWait) {
          await new Promise(r => setTimeout(r, 50));
        }
        if (this.ttsSessionReady) {
          this.streamSentenceToTTS(this.config.firstMessage!);
          // Signal TTS complete so the stream closes cleanly after first message.
          // Google TTS gRPC aborts idle streams after 5s — a new session will be
          // created when the next LLM response arrives.
          this.signalTTSComplete();
        } else {
          this.logger.warn('TTS not ready after timeout, skipping first message');
        }
      };
      waitForTTS().catch(err => this.logger.error('First message TTS failed', { error: (err as Error).message }));
    }

    // Max call duration timer - auto-end call after configured duration
    if (this.config.maxCallDurationSeconds > 0) {
      this.maxCallDurationTimer = setTimeout(() => {
        this.logger.info('Max call duration reached, ending call', {
          maxSeconds: this.config.maxCallDurationSeconds
        });
        this.emit('session_end_requested', { reason: 'max_duration_reached' });
      }, this.config.maxCallDurationSeconds * 1000);
    }

  }



  // ── Smart VAD state ──────────────────────────────────────────────────────
  // Replaces the old single RMS threshold with a multi-feature speech detector.
  // Features: RMS energy gate → high-band energy ratio → ZCR speech range.
  // Requires `bargeInFramesRequired` consecutive speech-like frames before
  // triggering, and a `bargeInCooldownFrames` silence hangover to reset.
  private bargeInSensitivity: number = 0.5;   // 0-1 from interruptionSensitivity
  private vadSpeechFrames: number = 0;        // Consecutive frames classified as speech
  private vadSilenceFrames: number = 0;       // Consecutive frames classified as non-speech
  private bargeInFramesRequired: number = 3;  // Speech frames needed before triggering
  private bargeInCooldownFrames: number = 8;  // Silence frames needed to reset speech counter

  private maxCallDurationTimer: NodeJS.Timeout | null = null;  // Auto-end call after max duration



  /**

   * Process incoming audio chunk from caller

   * Phase 2: Enhanced echo suppression during TTS playback

   */

  processAudioChunk(audioChunk: Buffer): void {

    if (!this.isActive || !this.sttSession) {

      return;

    }



    // Barge-in detection - must run BEFORE echo suppression

    // Check for barge-in whenever TTS is playing

    if (this.config.enableBargeIn && this.isTTSPlaying) {

      const vadResult = this.classifySpeechFrame(audioChunk);

      if (vadResult.isSpeech) {

        this.vadSpeechFrames++;

        this.vadSilenceFrames = 0;

        if (this.vadSpeechFrames >= this.bargeInFramesRequired) {

          this.logger.info('Barge-in triggered by smart VAD', {

            speechFrames: this.vadSpeechFrames,

            rms: vadResult.rms.toFixed(1),

            zcr: vadResult.zcr.toFixed(1),

            bandRatio: vadResult.bandRatio.toFixed(3),

            required: this.bargeInFramesRequired

          });

          this.handleBargeIn();

          this.vadSpeechFrames = 0;

          this.vadSilenceFrames = 0;

          // Don't return — let audio go to STT for the new turn

        }

      } else {

        this.vadSilenceFrames++;

        // Reset speech counter only after sustained silence (hangover)

        if (this.vadSilenceFrames >= this.bargeInCooldownFrames) {

          this.vadSpeechFrames = 0;

        }

      }

    }



    // Phase 2: Echo suppression — only suppress for a short window AFTER TTS ends
    // During active TTS playback, we STILL send audio to STT because the browser's
    // echoCancellation already filters the AI's voice from the mic. If STT produces
    // a transcript during TTS, that triggers barge-in via onFinalTranscript.
    // We only suppress the brief post-TTS echo window to catch residual echo.
    if (!this.isTTSPlaying && this.ttsPlaybackEndTime > 0) {
      const timeSinceTTSEnd = Date.now() - this.ttsPlaybackEndTime;
      if (timeSinceTTSEnd < this.echoSuppressionWindowMs) {
        return;
      }
    }



    this.sttSession.write(audioChunk);

  }



  /**

   * LATENCY OPTIMIZATION: Detect if a partial transcript is likely a complete utterance

   * Used for speculative LLM execution to reduce latency

   */

  private isLikelyCompleteUtterance(text: string): boolean {

    const trimmed = text.trim();

    

    // Check for sentence-ending punctuation

    if (/[.!?।॥]$/.test(trimmed)) {

      return true;

    }

    

    // Check for turn-ending phrases

    const turnEndingPhrases = /\b(thanks|thank you|okay|ok|bye|goodbye|done|that's it|that's all|please proceed|go ahead)\s*$/i;

    if (turnEndingPhrases.test(trimmed)) {

      return true;

    }

    

    // Check for questions (even without punctuation)

    const questionStarters = /^(what|when|where|who|why|how|can|could|would|will|is|are|do|does)/i;

    if (questionStarters.test(trimmed) && trimmed.length > 15) {

      return true;

    }

    

    // Check for complete greetings

    const greetings = /^(hello|hi|hey|good morning|good afternoon|good evening|namaste)$/i;

    if (greetings.test(trimmed)) {

      return true;

    }

    

    return false;

  }



  /**

   * Phase 2: Check if we're in the echo suppression window

   * Returns true if TTS is playing or recently ended

   */

  private isInEchoSuppressionWindow(): boolean {

    if (this.isTTSPlaying) {

      return true;

    }

    

    // Also suppress for a short window after TTS ends

    if (this.ttsPlaybackEndTime > 0) {

      const timeSinceTTSEnd = Date.now() - this.ttsPlaybackEndTime;

      return timeSinceTTSEnd < this.echoSuppressionWindowMs;

    }

    

    return false;

  }



  /**

   * Calculate RMS audio level from PCM buffer

   */

  private getTTSSampleRate(): number {
    const providerName = this.ttsProvider.getName().toLowerCase();
    if (providerName === 'cartesia') return 44100;   // Cartesia web mode
    if (providerName === 'google') return 24000;     // Google Chirp 3 HD
    if (providerName === 'sarvam') return 22050;     // Sarvam TTS
    return 24000; // Conservative default
  }

  /**
   * Multi-feature speech frame classifier.
   *
   * Layer 1 — RMS energy gate: reject frames that are true silence.
   * Layer 2 — High-band energy ratio: speech energy sits in 300-3400 Hz.
   *   AC hum / fan noise concentrates energy in <120 Hz fundamentals.
   *   We compute the ratio of "speech-band" samples (high-pass proxy via
   *   first-difference) vs total energy. Speech ratio > 0.25 required.
   * Layer 3 — Zero Crossing Rate: human speech crosses zero 50-250 times
   *   per 10ms frame at 16kHz. Pure tones (AC hum) have very low ZCR.
   *   Broadband impulse noise (coughs) has very high ZCR but fails
   *   the energy gate or band-ratio check.
   *
   * Sensitivity mapping:
   *   high (0.7-1.0) → RMS > 180,  bandRatio > 0.20, ZCR 20-300
   *   mid  (0.4-0.7) → RMS > 280,  bandRatio > 0.28, ZCR 30-280
   *   low  (0.0-0.4) → RMS > 420,  bandRatio > 0.35, ZCR 40-260
   */
  private classifySpeechFrame(buffer: Buffer): { isSpeech: boolean; rms: number; zcr: number; bandRatio: number } {

    const sampleCount = buffer.length >> 1;  // 16-bit samples
    if (sampleCount < 2) return { isSpeech: false, rms: 0, zcr: 0, bandRatio: 0 };

    const s = this.bargeInSensitivity;
    const rmsThreshold  = s >= 0.7 ? 180  : s >= 0.4 ? 280  : 420;
    const bandThreshold = s >= 0.7 ? 0.20 : s >= 0.4 ? 0.28 : 0.35;
    const zcrMin        = s >= 0.7 ? 20   : s >= 0.4 ? 30   : 40;
    const zcrMax        = s >= 0.7 ? 300  : s >= 0.4 ? 280  : 260;

    let sumSq = 0;
    let zeroCrossings = 0;
    let highBandSumSq = 0;

    let prevSample = buffer.readInt16LE(0);

    for (let i = 2; i < buffer.length - 1; i += 2) {
      const sample = buffer.readInt16LE(i);
      sumSq += sample * sample;

      // Zero crossing
      if ((prevSample >= 0) !== (sample >= 0)) zeroCrossings++;

      // High-band energy proxy: first-difference approximates a high-pass filter.
      // diff[i] = sample[i] - sample[i-1] correlates with high-frequency content.
      const diff = sample - prevSample;
      highBandSumSq += diff * diff;

      prevSample = sample;
    }

    const rms = Math.sqrt(sumSq / sampleCount);

    // ZCR normalized to crossings-per-10ms at 16kHz
    // sampleCount samples = (sampleCount/16000)*1000 ms
    const durationMs = (sampleCount / 16000) * 1000;
    const zcrNorm = (zeroCrossings / durationMs) * 10;

    // Band ratio: high-band energy relative to total energy
    // Avoid division by zero
    const bandRatio = sumSq > 0 ? Math.sqrt(highBandSumSq / sumSq) : 0;

    // All three layers must pass
    const isSpeech =
      rms > rmsThreshold &&
      bandRatio > bandThreshold &&
      zcrNorm >= zcrMin && zcrNorm <= zcrMax;

    return { isSpeech, rms, zcr: zcrNorm, bandRatio };

  }



  /**

   * Stop the voice pipeline

   */

  async stop(): Promise<void> {

    this.logger.debug('Pipeline stop() called', { pendingEndCall: this.pendingEndCall, isActive: this.isActive });

    this.isActive = false;

    

    // Clear max call duration timer
    if (this.maxCallDurationTimer) {
      clearTimeout(this.maxCallDurationTimer);
      this.maxCallDurationTimer = null;
    }

    // Phase 4: Clear silence debounce timer

    if (this.silenceDebounceTimer) {

      clearTimeout(this.silenceDebounceTimer);

      this.silenceDebounceTimer = null;

    }

    this.accumulatedTranscript = '';

    

    // Abort all active sessions

    this.sttSession?.abort();

    this.llmSession?.abort();

    // Don't abort TTS if farewell audio drain is in progress —
    // the end_call handler in executeToolCall will handle TTS lifecycle.
    if (!this.pendingEndCall) {
      this.ttsSession?.abort();
    } else {
      this.logger.debug('Skipping TTS abort — pendingEndCall, farewell drain in progress');
    }



    // Clean up LLM provider context cache (if Gemini)

    // This deletes the cached system prompt + tools to avoid stale caches

    try {

      if (this.llmProvider && 'cleanup' in this.llmProvider) {

        await (this.llmProvider as any).cleanup();

      }

    } catch (error) {

      this.logger.warn('Failed to cleanup LLM provider', { error: (error as Error).message });

    }



    this.logger.info('Voice pipeline stopped', { metrics: this.metrics });

  }



  /**

   * Get current pipeline metrics

   */

  getMetrics(): PipelineMetrics {

    return { ...this.metrics };

  }



  private async startSTTSession(): Promise<void> {

    const stage = this.startStage('stt');



    this.sttSession = this.sttProvider.createStreamingSession(

      {

        onPartialTranscript: (result: TranscriptionResult) => {

          this.emit('stt_partial', result.text);

          

          // Phase 4: Mark user as speaking and update speech time

          this.isSpeaking = true;

          this.lastSpeechTime = Date.now();

          

          // Cancel any pending silence timer - user is still speaking

          if (this.silenceDebounceTimer) {

            clearTimeout(this.silenceDebounceTimer);

            this.silenceDebounceTimer = null;

          }

          

          // SPECULATIVE EXECUTION DISABLED:
          // The abort controller was never wired into processUserInput/generateLLMResponse,
          // so speculative calls ran to completion. The debounced final then triggered
          // a SECOND identical LLM call, causing repeated bot responses.
          // TODO: Re-enable once abort controller is properly wired through the LLM stream.

        },



        onFinalTranscript: async (result: TranscriptionResult) => {

          this.endStage(stage);

          this.emit('stt_final', result.text);

          

          // Phase 2: Store confidence for filtering

          this.lastSTTConfidence = result.confidence;

          // STT-based barge-in: if user speaks while TTS is playing, trigger barge-in.
          // Echo guard: first verify the transcript is NOT the AI's own voice leaking
          // back through the speakers (common on web without hardware AEC).
          // Check against both currentAssistantMessage (being generated now) and
          // playedAudioText (recently spoken), since echoes can arrive with slight delay.
          if (this.isTTSPlaying && result.text.trim().length > 0) {
            const rawTranscript = result.text.trim();
            const normT = rawTranscript.toLowerCase().replace(/[\p{P}\p{S}]/gu, '').replace(/\s+/g, ' ').trim();
            const normAI = (this.currentAssistantMessage + ' ' + this.playedAudioText)
              .toLowerCase().replace(/[\p{P}\p{S}]/gu, '').replace(/\s+/g, ' ').trim();

            // Treat as echo if the transcript (≥4 chars) is contained in what the AI said.
            // 4-char minimum avoids false suppression of very short genuine replies like "yes".
            const isEcho = normT.length >= 4 && normAI.length > 0 && normAI.includes(normT);

            if (isEcho) {
              this.logger.warn('STT barge-in suppressed: transcript is AI echo', {
                transcript: rawTranscript,
                matchedIn: normAI.substring(0, 80)
              });
            } else {
              this.logger.info('STT-based barge-in triggered', {
                transcript: rawTranscript,
                confidence: result.confidence
              });
              this.handleBargeIn();
              // Continue processing - the transcript is the user's new input
            }
          }

          // Phase 3: If tool is executing, queue the input instead of processing

          if (this.isExecutingTool) {

            this.logger.debug('Queueing user input during tool execution', {

              text: result.text

            });

            this.queuedUserInput = (this.queuedUserInput || '') + ' ' + result.text;

            return;

          }



          // Phase 4: ACCUMULATE transcripts instead of processing immediately

          // This allows user to pause briefly without triggering a response

          const turnConfig = this.config.latencyOptimization.turnDetection;

          

          // Add to accumulated transcript (with space separator)

          if (result.text.trim()) {

            this.accumulatedTranscript = this.accumulatedTranscript 

              ? this.accumulatedTranscript + ' ' + result.text.trim()

              : result.text.trim();

          }

          

          this.lastSpeechTime = Date.now();

          this.isSpeaking = false;  // Final transcript means this segment ended

          // End-call phrase detection: if user says a configured end-call phrase, end the call
          if (this.config.endCallPhrases.length > 0 && this.accumulatedTranscript) {
            const normalizedText = this.accumulatedTranscript.toLowerCase().trim();
            const matchedPhrase = this.config.endCallPhrases.find(phrase =>
              normalizedText.includes(phrase.toLowerCase())
            );
            if (matchedPhrase) {
              this.logger.info('End-call phrase detected', {
                phrase: matchedPhrase,
                transcript: this.accumulatedTranscript
              });
              this.accumulatedTranscript = '';
              if (this.silenceDebounceTimer) {
                clearTimeout(this.silenceDebounceTimer);
                this.silenceDebounceTimer = null;
              }
              // Emit event and let the caller (telephony manager or api-server) handle cleanup.
              // Don't call this.stop() here — the caller needs to end the call record first.
              this.emit('session_end_requested', { reason: `end_call_phrase: ${matchedPhrase}` });
              // No farewell TTS for end-call phrases, so signal completion immediately
              // so the web UI / telephony manager can close the connection.
              this.emit('session_end_complete', { reason: `end_call_phrase: ${matchedPhrase}` });
              return;
            }
          }

          // Cancel existing timer

          if (this.silenceDebounceTimer) {

            clearTimeout(this.silenceDebounceTimer);

          }

          

          // Start silence debounce timer

          // Only process after sustained silence (user finished their thought)

          const silenceWaitMs = this.calculateSilenceWait(this.accumulatedTranscript);

          

          this.logger.debug('Starting silence debounce timer', {

            accumulatedLength: this.accumulatedTranscript.length,

            silenceWaitMs,

            transcript: this.accumulatedTranscript.substring(0, 50)

          });

          

          this.silenceDebounceTimer = setTimeout(async () => {

            await this.processDebouncedTranscript(result.confidence);

          }, silenceWaitMs);

        },



        onError: (error: Error) => {

          this.logger.error('STT error', { error: error.message });

          this.emit('error', error);

        },



        onEnd: () => {

          this.logger.debug('STT session ended');

          // Process any remaining accumulated transcript on session end

          if (this.accumulatedTranscript.trim()) {

            this.processDebouncedTranscript(this.lastSTTConfidence);

          }

        }

      },

      this.session.sttConfig.language

    );



    await this.sttSession.start();

  }



  /**

   * Phase 5: Smart Balanced - Confidence-based dynamic silence thresholds

   * Based on industry research (Cresta, AssemblyAI, Twilio):

   * - HIGH confidence (punctuation + complete): 200-250ms (like AssemblyAI's 160ms min)

   * - MEDIUM confidence: 450ms base

   * - LOW confidence (incomplete): up to 900ms max

   * Target: sub-500ms median, sub-800ms P95

   */

  private calculateSilenceWait(transcript: string): number {

    const turnConfig = this.config.latencyOptimization.turnDetection;

    const baseWait = turnConfig.silenceThresholdMs;  // 450ms

    const maxWait = turnConfig.maxWaitAfterSilenceMs;  // 900ms

    

    const trimmed = transcript.trim();

    const length = trimmed.length;

    

    // === HIGH CONFIDENCE SIGNALS (Fast-track: 200-300ms) ===

    

    // Check for sentence-ending punctuation

    const endsWithPunctuation = /[.!?।॥]$/.test(trimmed);

    const isQuestion = /\?$/.test(trimmed);

    

    // Turn-ending social phrases (very high confidence)

    const turnEndingPhrases = /\b(thanks|thank you|okay|ok|bye|goodbye|done|that's it|that's all|please proceed|go ahead|yes|no|sure|alright|got it)\s*[.!?]?$/i;

    const hasTurnEndingPhrase = turnEndingPhrases.test(trimmed);

    

    // === LOW CONFIDENCE SIGNALS (Wait longer: 700-900ms) ===

    

    // Mid-thought indicators - user is likely to continue

    const midThoughtPatterns = [

      /\b(and|but|or|so|because|however|although|though|since|while|if|when|where|which|um|uh|like|you know|I mean)\s*$/i,

      /,\s*$/,                                           // Ends with comma

      /\b(I|we|you|they|he|she|it)\s*$/i,               // Ends with pronoun (alone)

      /\b(is|are|was|were|will|would|could|should|can|have|has|had)\s*$/i,  // Ends with auxiliary

      /\b(the|a|an|this|that|these|those|my|your|our)\s*$/i,  // Ends with determiner

      /\b(want|need|would like|am looking|am thinking|was wondering)\s*$/i,

      /\b(about|for|to|with|from|in|on|at)\s*$/i,       // Ends with preposition

    ];

    const isMidThought = midThoughtPatterns.some(p => p.test(trimmed));

    

    // === CALCULATE WAIT TIME ===

    let waitMs: number;

    let confidence: 'high' | 'medium' | 'low';

    

    // PRIORITY 1: Mid-thought detection (LOW confidence - wait longer)

    if (isMidThought) {

      waitMs = maxWait;  // 900ms

      confidence = 'low';

    }

    // PRIORITY 2: Clear turn-ending phrase (HIGH confidence - respond fast!)

    else if (hasTurnEndingPhrase) {

      waitMs = 200;  // Very fast - clear social signal

      confidence = 'high';

    }

    // PRIORITY 3: Question with ? (HIGH confidence)

    // LATENCY OPTIMIZATION: Ultra-fast response for questions

    else if (isQuestion && length > 10) {

      waitMs = 150;  // Questions are usually complete - respond immediately

      confidence = 'high';

    }

    // PRIORITY 3.5: Question without ? but starts with question word (HIGH confidence)

    else if (/^(what|when|where|who|why|how|can|could|would|will|is|are|do|does|did)/i.test(trimmed) && length > 12) {

      waitMs = 200;  // Likely a question even without punctuation

      confidence = 'high';

    }

    // PRIORITY 4: Complete sentence with punctuation (HIGH confidence)

    else if (endsWithPunctuation && length > 15) {

      waitMs = 200;  // Complete thought with punctuation - reduced from 250ms

      confidence = 'high';

    }

    // PRIORITY 5: Short punctuated (MEDIUM-HIGH confidence)

    else if (endsWithPunctuation && length > 5) {

      waitMs = 350;  // Short but complete

      confidence = 'medium';

    }

    // PRIORITY 6: Very short without punctuation

    // LATENCY OPTIMIZATION: Fast-track common greetings even without punctuation

    else if (length < 15) {

      // Check for common greetings (high-confidence even without punctuation)

      const isGreeting = /^(hi|hey|hello|hola|namaste|namaskar|good\s+(morning|afternoon|evening|night)|yes|no|okay|ok|sure)$/i.test(trimmed);

      waitMs = isGreeting ? 300 : maxWait;  // Fast-track greetings: 300ms vs 900ms

      confidence = isGreeting ? 'high' : 'low';

    }

    // PRIORITY 7: Medium length without punctuation (MEDIUM confidence)

    else if (length < 40) {

      waitMs = 600;  // Wait a bit more

      confidence = 'medium';

    }

    // DEFAULT: Longer text without clear ending (MEDIUM confidence)

    else {

      waitMs = baseWait;  // 450ms

      confidence = 'medium';

    }

    

    this.logger.debug('Silence wait calculated', { 

      confidence,

      waitMs,

      length,

      endsWithPunctuation,

      isMidThought,

      transcript: trimmed.slice(-40)

    });

    

    return waitMs;

  }



  /**

   * Phase 4: Process accumulated transcript after silence debounce

   */

  private async processDebouncedTranscript(confidence: number): Promise<void> {

    const transcript = this.accumulatedTranscript.trim();

    

    // Clear accumulated state

    this.accumulatedTranscript = '';

    this.silenceDebounceTimer = null;

    

    if (!transcript) {

      return;

    }

    

    // Don't process if user started speaking again

    if (this.isSpeaking) {

      this.logger.debug('Skipping debounced transcript - user is speaking again', {

        transcript: transcript.substring(0, 50)

      });

      this.accumulatedTranscript = transcript;  // Keep the transcript

      return;

    }

    

    // Don't process if already processing a turn

    if (this.isProcessingTurn) {

      this.logger.debug('Skipping debounced transcript - already processing turn', {

        transcript: transcript.substring(0, 50)

      });

      return;

    }

    // Echo content guard: if transcript is a substring of what the bot recently said,
    // it's likely echo from the speaker being picked up by the mic.
    // Use Unicode-aware normalization that preserves Indic scripts (Devanagari, Tamil, etc.)
    if (this.playedAudioText && transcript.length > 5) {
      // Strip only punctuation/symbols, keep letters (any script), digits, and spaces
      const normalizedTranscript = transcript.toLowerCase().replace(/[\p{P}\p{S}]/gu, '').replace(/\s+/g, ' ').trim();
      const normalizedPlayed = this.playedAudioText.toLowerCase().replace(/[\p{P}\p{S}]/gu, '').replace(/\s+/g, ' ').trim();
      if (normalizedTranscript.length > 5 && normalizedPlayed.length > 5 &&
          normalizedPlayed.includes(normalizedTranscript)) {
        this.logger.warn('Echo content guard: transcript matches bot output, skipping', {
          transcript: transcript.substring(0, 60),
          playedText: this.playedAudioText.substring(0, 60)
        });
        return;
      }
    }

    // Validate transcript

    if (this.isValidTranscript(transcript, confidence)) {

      this.logger.info('Processing debounced transcript', {

        length: transcript.length,

        confidence,

        transcript: transcript.substring(0, 100)

      });

      await this.processUserInput(transcript);

    } else {

      this.logger.debug('Filtered invalid debounced transcript', { 

        text: transcript,

        confidence,

        reason: this.getFilterReason(transcript, confidence)

      });

    }

  }



  private async processUserInput(userText: string): Promise<void> {

    // Skip if call is ending — farewell audio is playing or end_call was triggered
    if (this.pendingEndCall) {
      this.logger.debug('Skipping processUserInput — pendingEndCall, call is ending', {
        text: userText.substring(0, 50)
      });
      return;
    }

    if (this.isProcessingTurn) {

      this.logger.warn('Already processing a turn, queuing input');

      return;

    }

    // Deduplication: skip if we just processed the same or very similar text
    const now = Date.now();
    const timeSinceLastProcess = now - this.lastProcessedTime;
    if (timeSinceLastProcess < 5000 && this.lastProcessedText) {
      const normalized = userText.trim().toLowerCase();
      const lastNormalized = this.lastProcessedText.trim().toLowerCase();
      // Exact match or one is a substring of the other (e.g., partial vs full)
      if (normalized === lastNormalized ||
          normalized.includes(lastNormalized) ||
          lastNormalized.includes(normalized)) {
        this.logger.warn('Dedup: skipping duplicate processUserInput', {
          text: userText.substring(0, 60),
          lastText: this.lastProcessedText.substring(0, 60),
          timeSinceLastMs: timeSinceLastProcess
        });
        return;
      }
    }

    this.isProcessingTurn = true;

    this.lastProcessedText = userText;
    this.lastProcessedTime = Date.now();

    this.currentTurnStart = Date.now();

    this.pendingSentences = [];



    // Add user message to conversation history

    const userMessage: ChatMessage = {

      role: 'user',

      content: userText

    };

    this.session.messages.push(userMessage);



    try {

      // Start LLM generation

      await this.generateLLMResponse();

    } catch (error) {

      this.logger.error('Error processing user input', { error });

      this.emit('error', error as Error);

    } finally {

      this.isProcessingTurn = false;

      this.emitTurnComplete();

    }

  }



  private async generateLLMResponse(): Promise<void> {

    const stage = this.startStage('llm');

    let fullResponse = '';

    const toolCalls: ToolCall[] = [];

    
    // Increment generation ID — any audio from previous generations will be discarded
    this.ttsGenerationId++;
    const currentGenId = this.ttsGenerationId;
    this.logger.debug('New LLM generation', { generationId: currentGenId });

    // Abort old TTS session if still active (from previous tool call cycle)
    if (this.ttsSession?.isSessionActive() && !this.pendingEndCall) {
      this.ttsSession.abort();
      this.ttsSession = null;
    }

    // Reset first-byte tracking for this turn

    this.firstLLMTokenTime = 0;

    this.firstTTSByteTime = 0;

    this.ttsSessionReady = false;



    // TOKEN OPTIMIZATION: Get tool definitions (optionally compressed)

    // Context caching handles the bulk of token savings now

    const maxTools = this.config.maxTools > 0 ? this.config.maxTools : undefined;

    const tools = this.config.compressTools

      ? this.toolRegistry.getCompressedDefinitions(maxTools)

      : this.toolRegistry.getDefinitions();

    

    // TOKEN OPTIMIZATION: Use sliding window for conversation history

    // This prevents token explosion on longer calls

    const recentMessages = this.getRecentMessages();

    const systemPrompt = this.session.llmConfig.systemPrompt;

    

    // Estimate and log token usage for debugging

    const estimatedTokens = this.estimateTotalPromptTokens(recentMessages, tools, systemPrompt);

    

    this.logger.info('Generating LLM response', {

      toolCount: tools.length,

      toolNames: tools.map(t => t.name),

      totalMessages: this.session.messages.length,

      recentMessages: recentMessages.length,

      estimatedPromptTokens: estimatedTokens,

      systemPromptLength: systemPrompt?.length || 0,

      toolCompression: this.config.compressTools,

      maxTools: this.config.maxTools

    });



    // Start TTS session FIRST for streaming audio output (don't block)

    this.startTTSSessionAsync();



    this.llmSession = await this.llmProvider.generateStream(

      recentMessages,  // Use truncated history instead of full history

      tools,

      systemPrompt,

      {

        onToken: (chunk) => {

          // Track first LLM token time

          if (this.firstLLMTokenTime === 0) {

            this.firstLLMTokenTime = Date.now();

            this.logger.debug('First LLM token received', { 

              latencyMs: this.firstLLMTokenTime - this.currentTurnStart 

            });

          }

          this.emit('llm_token', chunk.content);

          // Token-level TTS streaming: send raw tokens directly to TTS
          // Google TTS concatenates fragments into one continuous audio stream,
          // guaranteeing ordering. Sentence-level splitting causes concurrent
          // processing and out-of-order audio.
          if (this.useTokenStreaming && chunk.content) {
            this.streamTokenToTTS(chunk.content);
          }

        },



        onSentence: (sentence) => {

          const sentenceTimestamp = Date.now();

          const sentenceIndex = this.pendingSentences.length;

          

          this.logger.info('📝 LLM SENTENCE RECEIVED', {

            index: sentenceIndex,

            sentence: sentence,

            length: sentence.length,

            timestamp: sentenceTimestamp,

            elapsedMs: sentenceTimestamp - this.currentTurnStart

          });

          

          this.emit('llm_sentence', sentence);

          this.pendingSentences.push(sentence);

          

          // Detect language and update TTS config dynamically

          const detectedLang = this.detectLanguage(sentence);

          if (detectedLang !== this.session.ttsConfig.voice.language) {

            this.logger.debug('Language switch detected', { 

              from: this.session.ttsConfig.voice.language, 

              to: detectedLang 

            });

            this.session.ttsConfig.voice.language = detectedLang;

          }

          

          // For token-streaming providers (Google TTS), text is already sent via
          // onToken → streamTokenToTTS. Only send via sentence queue for other providers.
          if (this.useTokenStreaming) {
            // Still track for billing and barge-in history
            this.ttsTextQueue.push(sentence.trim());
            this.currentAssistantMessage += sentence;
            this.session.metrics.ttsCharacters += sentence.length;
          } else {
            // STREAM IMMEDIATELY: Send each sentence to TTS as soon as it arrives
            // This is critical for low-latency - don't wait for full response
            this.streamSentenceToTTS(sentence);
          }

        },



        onToolCall: async (toolCall) => {

          this.emit('llm_tool_call', toolCall);

          toolCalls.push(toolCall);

          

          // For end_call: DON'T abort TTS — farewell text needs to finish playing.
          // Set flag so signalTTSComplete (called by onComplete) won't tear down TTS.
          // For other tools: abort TTS to prevent Google gRPC 5s idle timeout.
          if (toolCall.function.name === 'end_call') {
            this.pendingEndCall = true;
          } else {
            if (this.ttsSession?.isSessionActive()) {
              this.ttsSession.abort();
              this.ttsSession = null;
            }
          }

          // IMMEDIATELY play filler before tool execution starts

          // This prevents silence gap between LLM decision and tool execution

          this.isExecutingTool = true;

          await this.playToolFillerImmediate(toolCall.function.name);

          

          // Execute tool and continue conversation

          await this.executeToolCall(toolCall);

        },



        onComplete: (response) => {

          this.endStage(stage);

          fullResponse = response.content;

          

          // Add assistant message to history
          // Include raw Gemini parts if present (for thoughtSignature preservation)

          const assistantMessage: ChatMessage = {

            role: 'assistant',

            content: fullResponse,

            toolCalls: response.toolCalls,

            ...(response._rawGeminiParts ? { _rawGeminiParts: response._rawGeminiParts } : {})

          };

          this.session.messages.push(assistantMessage);



          // Update metrics - track tokens separately for billing

          if (response.usage) {

            this.session.metrics.tokenCount += response.usage.totalTokens;

            this.session.metrics.llmPromptTokens += response.usage.promptTokens;

            this.session.metrics.llmCompletionTokens += response.usage.completionTokens;

            // Track cached tokens for 75% discount calculation

            if (response.usage.cachedContentTokenCount) {

              this.session.metrics.llmCachedTokens += response.usage.cachedContentTokenCount;

            }

          }

          

          // Signal TTS that no more text is coming (but don't wait for audio)

          this.signalTTSComplete();

        },



        onError: (error) => {

          this.logger.error('LLM error', { error: error.message });

          this.emit('error', error);

        }

      }

    );



    await this.llmSession.start();

    

    // LLM is done - turn is logically complete

    // TTS continues streaming in background, user can barge-in

  }

  

  /**

   * Start TTS session asynchronously (don't block LLM)

   */

  private startTTSSessionAsync(): void {

    const stage = this.startStage('tts');

    // Capture generation ID at session creation time
    const sessionGenId = this.ttsGenerationId;
    let sessionAudioBytes = 0;  // Track audio bytes for playback duration estimation

    this.ttsSession = this.ttsProvider.createStreamingSession(

      {

        onAudioChunk: (chunk: Buffer) => {
          // Track audio bytes locally for accurate playback duration estimation
          sessionAudioBytes += chunk.length;

          // GENERATION ID GUARD: Discard audio from stale TTS sessions.
          // When a tool call triggers a new generateLLMResponse(), the old TTS
          // session may still be emitting audio. Without this guard, audio from
          // the old and new sessions interleaves, causing jumbled speech.
          if (sessionGenId !== this.ttsGenerationId) {
            this.logger.debug('Discarding stale TTS audio', {
              sessionGenId,
              currentGenId: this.ttsGenerationId,
              chunkSize: chunk.length
            });
            return;
          }

          // Track first TTS audio byte

          if (this.firstTTSByteTime === 0) {

            this.firstTTSByteTime = Date.now();

            const firstByteLatency = this.firstTTSByteTime - this.currentTurnStart;

            this.logger.info('First TTS audio byte', { 

              latencyMs: firstByteLatency,

              chunkSize: chunk.length

            });

            this.emit('first_audio_byte', { latencyMs: firstByteLatency });

          }

          

          // Phase 2: Track TTS playback timing for echo suppression

          if (!this.isTTSPlaying) {

            this.ttsPlaybackStartTime = Date.now();

            this.logger.debug('TTS playback started', { chunkSize: chunk.length });

          }

          this.isTTSPlaying = true;

          this.emit('tts_audio_chunk', chunk);

        },



        onComplete: (result: TTSResult) => {

          // Keep isTTSPlaying true for estimated client playback duration

          // Audio is buffered on client/telephony, so server completion != playback complete

          // Calculate from total audio bytes since result.durationMs is often 0 for streaming
          // Use locally-tracked sessionAudioBytes (not this.ttsSession which may be nulled by barge-in)
          const sampleRate = result.audioFormat?.sampleRateHertz || this.getTTSSampleRate();
          const bytesPerSecond = sampleRate * 2;
          const bytesBasedMs = sessionAudioBytes > 0 
            ? Math.ceil((sessionAudioBytes / bytesPerSecond) * 1000) : 0;
          const estimatedPlaybackMs = bytesBasedMs > 0 ? bytesBasedMs : (result.durationMs || 2000);

          this.logger.info('TTS streaming complete, estimated playback window', { 
            sessionAudioBytes,
            sampleRate,
            estimatedPlaybackMs,
            durationMs: result.durationMs
          });

          

          // Delay setting isTTSPlaying to false to allow barge-in during client playback

          setTimeout(() => {

            this.isTTSPlaying = false;

            this.ttsPlaybackEndTime = Date.now();

            this.logger.debug('TTS playback window ended');

          }, estimatedPlaybackMs);

          

          // Phase 2: Mark all queued sentences as played

          this.playedAudioText = this.ttsTextQueue.join(' ');

          

          this.endStage(stage);

        },



        onError: (error: Error) => {

          this.isTTSPlaying = false;

          this.ttsPlaybackEndTime = Date.now();

          this.logger.error('TTS error', { error: error.message });

          this.emit('error', error);

        }

      },

      this.session.ttsConfig.voice,

      this.session.ttsConfig.voice.language

    );



    // Start session in background

    this.ttsSession.start().then(() => {

      this.ttsSessionReady = true;

      this.logger.debug('TTS session ready for streaming');

    }).catch((error) => {

      this.logger.error('Failed to start TTS session', { error: error.message });

    });

  }

  

  /**

   * Stream a sentence to TTS immediately

   * Phase 2: Track sentences for barge-in history truncation

   * Phase 3.5: Send each sentence individually for strict FIFO ordering

   */

  private streamSentenceToTTS(sentence: string): void {

    if (!sentence.trim()) return;

    // Strip hallucinated function call tags from LLM output
    // Some models (Llama 3.1 8B via Groq) output raw <function=...>...</function> as text
    // instead of using the tool calling API, especially on follow-up turns
    const cleaned = sentence.replace(/<function=[^>]*>\{[^}]*\}<\/function>/g, '').trim();
    if (!cleaned) return;
    sentence = cleaned;

    

    const queueTimestamp = Date.now();

    const queueIndex = this.ttsTextQueue.length;

    

    this.logger.info('🎯 QUEUING SENTENCE FOR TTS', {

      index: queueIndex,

      sentence: sentence.trim(),

      length: sentence.length,

      queueSize: this.sentenceQueue.length,

      timestamp: queueTimestamp

    });

    

    // Phase 2: Track sentence for history truncation

    this.ttsTextQueue.push(sentence.trim());

    this.currentAssistantMessage += sentence;

    

    // Track TTS characters for billing

    this.session.metrics.ttsCharacters += sentence.length;

    

    // Send sentence immediately to TTS queue

    this.sentenceQueue.push(sentence);

    this.processSentenceQueueSync();

  }

  /**
   * Stream a raw LLM token directly to TTS (token-level streaming)
   * Buffers tokens until a word boundary (space, punctuation, newline) to avoid
   * sending partial words that cause mispronunciation.
   */
  private streamTokenToTTS(token: string): void {
    if (!token) return;

    this.tokenBuffer += token;

    // Flush buffer when it ends with a word boundary character
    // This ensures Google TTS receives complete words/phrases
    if (/[\s,.\-!?;:।॥\n]$/.test(this.tokenBuffer)) {
      this.flushTokenBuffer();
    }
  }

  /**
   * Flush accumulated token buffer to TTS
   * Called on word boundaries and when LLM response completes
   */
  private flushTokenBuffer(): void {
    if (!this.tokenBuffer) return;

    const text = this.tokenBuffer;
    this.tokenBuffer = '';

    if (this.ttsSession?.isSessionActive()) {
      this.ttsSession.sendText(text);
      this.ttsSentText = true;
    } else if (this.ttsSessionReady === false) {
      // TTS session not ready yet — retry after short delay
      this.tokenBuffer = text;  // Put it back
      setTimeout(() => this.flushTokenBuffer(), 10);
    }
  }

  

  /**

   * Process sentence queue synchronously (FIFO)

   * Cartesia's WebSocket guarantees ordering, so we just need to send in order

   * The TTS provider already has internal queueing for when WS isn't ready

   */

  private processSentenceQueueSync(): void {

    // Process all queued sentences immediately

    // Cartesia's sendText() already handles queueing if WS not ready

    while (this.sentenceQueue.length > 0) {

      const sentence = this.sentenceQueue.shift()!;

      const sendTimestamp = Date.now();

      

      // Check if TTS session exists and is ready

      // Skip empty or punctuation-only sentences (Cartesia rejects these)
      const trimmed = sentence.trim();
      if (!trimmed || /^[^\w\s]+$/.test(trimmed)) {
        this.logger.debug('Skipping empty/punctuation-only sentence for TTS', { sentence: trimmed });
        continue;
      }

      if (this.ttsSession?.isSessionActive()) {

        this.logger.info('🔊 SENDING TO TTS', { 

          sentence: trimmed,

          length: trimmed.length,

          queueRemaining: this.sentenceQueue.length,

          timestamp: sendTimestamp,

          ttsReady: this.ttsSessionReady

        });

        this.ttsSession.sendText(trimmed);

        this.ttsSentText = true;

      } else {

        // TTS not ready yet - put back in queue and schedule retry

        this.logger.warn('⏸️ TTS NOT READY - REQUEUEING', {

          sentence: sentence.trim(),

          queueSize: this.sentenceQueue.length + 1,

          ttsReady: this.ttsSessionReady,

          ttsActive: this.ttsSession?.isSessionActive()

        });

        this.sentenceQueue.unshift(sentence);

        if (!this.isProcessingSentenceQueue) {

          this.isProcessingSentenceQueue = true;

          setTimeout(() => {

            this.isProcessingSentenceQueue = false;

            this.processSentenceQueueSync();

          }, 10);

        }

        break;

      }

    }

  }

  

  /**

   * Signal TTS that no more text is coming

   * Don't wait for audio completion - let it stream in background

   */

  private signalTTSComplete(): void {

    // If end_call is pending, DON'T touch the TTS session — executeToolCall
    // will handle waiting for TTS to finish the farewell audio.
    if (this.pendingEndCall) {
      this.logger.debug('Skipping TTS teardown — pendingEndCall, farewell audio still playing');
      return;
    }

    // Flush any remaining buffered tokens (for token-level streaming)
    if (this.useTokenStreaming) {
      this.flushTokenBuffer();
    }

    // Only end TTS session if we actually sent text to it

    // Otherwise Cartesia will error with "No valid transcripts passed"

    if (this.ttsSession?.isSessionActive() && this.ttsSentText) {

      // End the session but don't await - audio continues streaming

      this.ttsSession.end().catch((error) => {

        this.logger.error('TTS end error', { error: error.message });

      });

    }

    // Reset flags for next turn

    this.ttsSentText = false;
    this.tokenBuffer = '';

  }



  private async executeToolCall(toolCall: ToolCall): Promise<void> {

    const stage = this.startStage('tool_execution');

    

    try {

      const args = JSON.parse(toolCall.function.arguments);

      

      // Execute tool (filler already playing from onToolCall)

      const result = await this.toolRegistry.execute({

        toolName: toolCall.function.name,

        arguments: args,

        sessionId: this.session.sessionId,

        callContext: this.session.context

      });

      

      // Tool execution complete - clear the flag

      this.isExecutingTool = false;



      this.endStage(stage);

      this.session.metrics.toolCallCount++;



      // Add tool result to conversation

      const toolMessage: ChatMessage = {

        role: 'tool',

        content: JSON.stringify(result.result),

        toolCallId: toolCall.id,

        name: toolCall.function.name

      };

      this.session.messages.push(toolMessage);



      // Check if this is an end_call - trigger session end
      if (toolCall.function.name === 'end_call') {

        this.logger.info('End call requested by agent, stopping pipeline');

        this.emit('session_end_requested', { reason: args.reason });

        // Wait for TTS to finish streaming the farewell message before stopping.
        // The LLM often sends farewell text + end_call in the same response,
        // so TTS may still be generating audio for the goodbye sentences.
        // Note: we check isSessionActive() only — ttsSentText may have been
        // reset by signalTTSComplete which fires synchronously after emitToolCall.
        if (this.ttsSession?.isSessionActive()) {
          this.logger.info('Waiting for TTS to finish farewell audio before ending call');
          try {
            await Promise.race([
              this.ttsSession.end(),
              new Promise<void>(resolve => setTimeout(resolve, 10000)) // 10s safety timeout
            ]);
          } catch (err) {
            this.logger.warn('TTS end error during end_call', { error: (err as Error).message });
          }
        }

        // TTS generates audio faster than real-time. The client has buffered audio
        // that still needs to play out. Estimate playback duration from total bytes.
        // PCM 24kHz 16-bit mono: bytesPerSecond = 24000 * 2 = 48000
        // PCM 8kHz 16-bit mono (telephony): bytesPerSecond = 8000 * 2 = 16000
        // Note: Google TTS wraps chunks in WAV headers (44 bytes each), but the
        // overhead is negligible for duration estimation.
        const totalBytes = this.ttsSession?.getTotalAudioBytes() || 0;
        const bytesPerSecond = 48000; // 24kHz 16-bit mono (web mode default)
        const estimatedPlaybackMs = totalBytes > 0
          ? Math.ceil((totalBytes / bytesPerSecond) * 1000) + 500 // +500ms buffer for network
          : 0;

        if (estimatedPlaybackMs > 0) {
          this.logger.info('Waiting for client to play buffered farewell audio', {
            totalAudioBytes: totalBytes,
            estimatedPlaybackMs
          });
          await new Promise<void>(resolve => setTimeout(resolve, estimatedPlaybackMs));
        }

        this.pendingEndCall = false;
        this.logger.info('Farewell playback complete, stopping pipeline now');
        await this.stop();

        // Signal that it's now safe to close the WebSocket / end the call.
        // session_end_requested was emitted earlier but did NOT close the WS,
        // so TTS audio could keep flowing. Now we're done.
        this.emit('session_end_complete', { reason: args.reason });

        return; // Don't continue LLM generation for end_call

      }



      // Continue LLM generation with tool result

      // Make a follow-up call so LLM can speak the response to the user

      this.logger.debug('Continuing LLM generation with tool result', { 

        tool: toolCall.function.name 

      });

      

      // Clear any queued user input that arrived during tool execution

      // This prevents overlap with the tool response

      if (this.queuedUserInput) {

        this.logger.debug('Discarding queued input during tool execution', {

          queuedText: this.queuedUserInput

        });

        this.queuedUserInput = null;

      }

      

      await this.generateLLMResponse();



    } catch (error) {

      this.isExecutingTool = false;  // Clear flag on error

      this.logger.error('Tool execution failed', { 

        tool: toolCall.function.name, 

        error: (error as Error).message 

      });

      

      // Add error result to conversation

      const errorMessage: ChatMessage = {

        role: 'tool',

        content: JSON.stringify({ error: (error as Error).message }),

        toolCallId: toolCall.id,

        name: toolCall.function.name

      };

      this.session.messages.push(errorMessage);

    }

  }



  /**

   * Play filler speech IMMEDIATELY when tool call is detected

   * This runs BEFORE tool execution starts, eliminating the silence gap

   * Uses cached audio for instant playback, falls back to live TTS

   */

  private async playToolFillerImmediate(toolName: string): Promise<void> {

    const fillerConfig = this.config.latencyOptimization.fillers;

    

    // Skip if fillers are disabled or it's an end_call tool

    if (!fillerConfig.enabled || toolName === 'end_call') {

      return;

    }



    try {

      const language = this.session.sttConfig.language;

      

      // Try to use cached audio first

      if (fillerConfig.useCachedAudio && this.audioCache?.isReady()) {

        const cachedFiller = this.audioCache.getToolFiller(language);

        

        if (cachedFiller) {

          this.logger.debug('Playing cached filler', { 

            id: cachedFiller.id, 

            text: cachedFiller.text 

          });

          

          // Emit cached audio directly

          this.isTTSPlaying = true;

          this.emit('tts_audio_chunk', cachedFiller.audioBuffer);

          this.isTTSPlaying = false;

          return;

        }

      }



      // Fall back to live TTS generation

      const fillerText = this.getFillerText(language);

      if (fillerText) {

        this.logger.debug('Generating live filler TTS', { text: fillerText });

        const result = await this.ttsProvider.synthesize(fillerText, undefined, language);

        

        this.isTTSPlaying = true;

        this.emit('tts_audio_chunk', result.audioContent);

        this.isTTSPlaying = false;

      }

    } catch (error) {

      // Don't fail tool execution if filler fails

      this.logger.warn('Filler playback failed', { 

        error: (error as Error).message 

      });

    }

  }



  /**

   * Get a filler text for the specified language

   */

  private getFillerText(language: SupportedLanguage): string {

    const fillers: Record<string, string[]> = {

      'en-IN': ['Let me check that for you.', 'One moment please.', 'Just a second.'],

      'hi-IN': ['एक मिनट रुकिए।', 'बस एक सेकंड।', 'मैं देखता हूं।'],

      'ta-IN': ['ஒரு நிமிடம் பாருங்கள்.'],

      'te-IN': ['ఒక్క నిమిషం చూస్తాను.'],

      'unknown': ['Let me check that for you.', 'One moment please.']

    };



    const langFillers = fillers[language] || fillers['en-IN'];

    return langFillers[Math.floor(Math.random() * langFillers.length)];

  }



  /**

   * Handle barge-in - abort current TTS/LLM and reset for new input

   * Phase 2: Truncate assistant message to only what was actually heard

   */

  public handleBargeIn(): void {

    // Increment generation ID so stale TTS audio from this turn is discarded
    this.ttsGenerationId++;

    this.logger.info('Barge-in: aborting current turn', {

      fullMessage: this.currentAssistantMessage.length,

      playedText: this.playedAudioText.length,

      sentenceIndex: this.ttsSentenceIndex,

      newGenerationId: this.ttsGenerationId

    });

    

    // Track interruption for metrics

    this.session.metrics.interruptionsCount++;

    

    // Phase 2: Truncate the last assistant message to what was actually heard

    this.truncateAssistantMessage();

    

    // Stop current TTS playback — but not during end_call farewell drain
    if (this.pendingEndCall) {
      this.logger.debug('Barge-in ignored — farewell TTS drain in progress');
      return;
    }

    this.ttsSession?.abort();

    this.ttsSession = null;

    this.isTTSPlaying = false;
    this.tokenBuffer = '';  // Clear buffered tokens on barge-in

    this.ttsPlaybackEndTime = Date.now();



    // Stop current LLM generation

    this.llmSession?.abort();

    this.llmSession = null;



    // Reset turn state so new input can be processed

    this.isProcessingTurn = false;

    this.pendingSentences = [];

    

    // Reset Phase 2 tracking

    this.currentAssistantMessage = '';

    this.playedAudioText = '';

    this.ttsTextQueue = [];

    this.ttsSentenceIndex = 0;



    // Phase 4: Clear silence debounce timer and accumulated transcript

    if (this.silenceDebounceTimer) {

      clearTimeout(this.silenceDebounceTimer);

      this.silenceDebounceTimer = null;

    }

    this.accumulatedTranscript = '';

    this.isSpeaking = false;



    this.emit('barge_in');

  }



  /**

   * Phase 2: Truncate assistant message in history to only what was heard

   * This ensures the conversation history reflects what the user actually heard

   */

  private truncateAssistantMessage(): void {

    if (!this.playedAudioText || this.session.messages.length === 0) {

      return;

    }



    // Find the last assistant message

    for (let i = this.session.messages.length - 1; i >= 0; i--) {

      const msg = this.session.messages[i];

      if (msg.role === 'assistant' && msg.content) {

        const originalLength = msg.content.length;

        

        // Truncate to what was actually played

        if (this.playedAudioText.length < msg.content.length) {

          msg.content = this.playedAudioText + '... [interrupted]';

          this.logger.debug('Truncated assistant message on barge-in', {

            originalLength,

            truncatedLength: msg.content.length,

            playedText: this.playedAudioText.substring(0, 50)

          });

        }

        break;

      }

    }

  }



  /**

   * Validate transcript to filter out garbage/phantom STT results

   * Returns true if the transcript should be processed

   * Phase 2: Added confidence-based filtering

   * Phase 4: Enhanced validation with semantic completeness checks

   */

  private isValidTranscript(text: string, confidence: number = 1.0): boolean {

    const trimmed = text.trim();

    const turnConfig = this.config.latencyOptimization.turnDetection;

    

    // Phase 2: Confidence-based filtering

    // Reject low-confidence transcripts (likely noise or echo)

    const minConfidence = 0.5;

    if (confidence < minConfidence && trimmed.length < 20) {

      return false;

    }

    

    // Phase 4.2: Allow known valid short phrases BEFORE length check

    // These are complete utterances even if very short

    // Strip punctuation for matching (user might say "Hi." or "Hi!")

    const textWithoutPunctuation = trimmed.replace(/[.!?।॥,;]+$/g, '').trim();

    

    const validShortPhrases = [

      /^(hello|hi|hey|bye|goodbye)$/i,                    // Greetings

      /^(yes|no|yeah|nope|nah|yep)$/i,                    // Responses

      /^(thanks|thank you)$/i,                            // Thanks

      /^(okay|ok|sure|fine|great|perfect|awesome)$/i,     // Acknowledgments

    ];

    

    if (validShortPhrases.some(p => p.test(textWithoutPunctuation))) {

      return true;  // Allow these even if below minTranscriptLength

    }

    

    // Filter empty or very short transcripts (configurable minimum length)

    if (trimmed.length < turnConfig.minTranscriptLength) {

      return false;

    }

    

    // Phase 4: Filter common noise/filler words that aren't real input

    // Note: Don't filter greetings/responses here - they're handled above

    const noisePatterns = [

      /^(um+|uh+|ah+|eh+|hmm+|hm+|mm+)$/i,           // Filler sounds only

      /^\.+$/,                                        // Just periods

      /^[^\w\s]+$/,                                   // Just punctuation/symbols

    ];

    

    if (noisePatterns.some(p => p.test(trimmed))) {

      return false;

    }

    

    // Filter transcripts that are mostly non-ASCII (garbled text)

    // But allow Indic scripts (Devanagari, Tamil, Telugu, etc.)

    const indicRange = /[\u0900-\u0DFF\u0E00-\u0E7F]/g;  // Indic scripts

    const latinRange = /[a-zA-Z]/g;

    const indicChars = (trimmed.match(indicRange) || []).length;

    const latinChars = (trimmed.match(latinRange) || []).length;

    const meaningfulChars = indicChars + latinChars;

    

    if (meaningfulChars === 0 && trimmed.length > 0) {

      return false;  // No meaningful characters

    }

    

    // Echo suppression during TTS playback (configurable)

    if (turnConfig.suppressEchoDuringPlayback && this.isTTSPlaying) {

      // Filter short utterances during playback as they're likely echo

      if (trimmed.length < 10) {

        return false;

      }

    }

    

    // Phase 4: Semantic completeness check for short utterances

    // Very short transcripts without clear intent should wait for more input

    if (trimmed.length < 15) {

      // Check if it's a complete thought (has ending punctuation or is a clear question/statement)

      const isComplete = this.isSemanticallyCom(trimmed);

      if (!isComplete) {

        return false;

      }

    }

    

    return true;

  }



  /**

   * Phase 4.1: Check if a short utterance is semantically complete

   * STRICT version - only returns true when very confident user finished

   * Used to determine if we should wait for more speech or process immediately

   */

  private isSemanticallyCom(text: string): boolean {

    const trimmed = text.trim().toLowerCase();

    

    // Must end with sentence-ending punctuation for short utterances

    // This is the strongest signal of completion

    if (/[.!?।॥]$/.test(trimmed)) {

      return true;

    }

    

    // Without punctuation, only these very specific patterns are "complete"

    // These are standalone phrases that don't need continuation

    const standalonePatterns = [

      /^(yes|no|yeah|nope|nah)$/i,                        // Single word responses

      /^(hello|hi|hey|bye|goodbye)$/i,                    // Greetings (single word)

      /^(thanks|thank you|thank you so much)$/i,          // Thanks (standalone)

      /^(okay|ok|sure|fine|great|perfect|awesome|sounds good)$/i,  // Acknowledgments

      /^(please|please do|go ahead|proceed)$/i,           // Permissions

    ];

    

    // For short text without punctuation, ONLY standalone patterns are complete

    // Everything else needs more context or punctuation

    return standalonePatterns.some(p => p.test(trimmed));

  }



  /**

   * Get the reason why a transcript was filtered (for logging)

   * Phase 2: Added confidence reason

   * Phase 4: Updated to match enhanced isValidTranscript logic

   */

  private getFilterReason(text: string, confidence: number = 1.0): string {

    const trimmed = text.trim();

    const turnConfig = this.config.latencyOptimization.turnDetection;

    

    // Phase 2: Check confidence first

    const minConfidence = 0.5;

    if (confidence < minConfidence && trimmed.length < 20) {

      return `low_confidence (${(confidence * 100).toFixed(1)}%)`;

    }

    

    if (trimmed.length < turnConfig.minTranscriptLength) {

      return 'too_short';

    }

    

    // Phase 4: Check for noise patterns

    const noisePatterns = [

      /^(um+|uh+|ah+|eh+|hmm+|hm+|mm+)$/i,

      /^(okay|ok|right|yeah|yes|no|sure)$/i,

      /^\.+$/,

      /^[^\w\s]+$/,

    ];

    if (noisePatterns.some(p => p.test(trimmed))) {

      return 'noise_or_filler';

    }

    

    // Check for meaningful characters

    const indicRange = /[\u0900-\u0DFF\u0E00-\u0E7F]/g;

    const latinRange = /[a-zA-Z]/g;

    const indicChars = (trimmed.match(indicRange) || []).length;

    const latinChars = (trimmed.match(latinRange) || []).length;

    if (indicChars + latinChars === 0 && trimmed.length > 0) {

      return 'no_meaningful_characters';

    }

    

    if (turnConfig.suppressEchoDuringPlayback && this.isTTSPlaying && trimmed.length < 10) {

      return 'echo_during_playback';

    }

    

    // Phase 4: Semantic completeness check

    if (trimmed.length < 15 && !this.isSemanticallyCom(trimmed)) {

      return 'incomplete_thought';

    }

    

    return 'unknown';

  }



  private startStage(name: string): PipelineStage {

    const stage: PipelineStage = {

      name,

      startTime: Date.now(),

      status: 'running'

    };

    this.metrics.stages.push(stage);

    return stage;

  }



  private endStage(stage: PipelineStage): void {

    stage.endTime = Date.now();

    stage.latencyMs = stage.endTime - stage.startTime;

    stage.status = 'completed';



    // Track latency by type

    switch (stage.name) {

      case 'stt':

        this.session.metrics.sttLatencyMs.push(stage.latencyMs);

        break;

      case 'llm':

        this.session.metrics.llmLatencyMs.push(stage.latencyMs);

        break;

      case 'tts':

        this.session.metrics.ttsLatencyMs.push(stage.latencyMs);

        break;

    }

  }



  private emitTurnComplete(): void {

    const turnDuration = Date.now() - this.currentTurnStart;

    

    // Calculate first-byte latency (time from turn start to first TTS audio byte)

    const firstByteLatency = this.firstTTSByteTime > 0 

      ? this.firstTTSByteTime - this.currentTurnStart 

      : 0;

    

    // Calculate per-stage latencies

    const firstLLMTokenLatency = this.firstLLMTokenTime > 0 

      ? this.firstLLMTokenTime - this.currentTurnStart 

      : 0;

    

    this.session.metrics.e2eLatencyMs.push(firstByteLatency);

    this.session.metrics.turnCount++;



    this.metrics.totalLatencyMs = turnDuration;

    this.metrics.firstByteLatencyMs = firstByteLatency;



    // Emit detailed metrics

    const detailedMetrics = {

      ...this.metrics,

      firstLLMTokenMs: firstLLMTokenLatency,

      firstTTSByteMs: firstByteLatency,

      turnDurationMs: turnDuration

    };



    this.emit('turn_complete', detailedMetrics);

    

    this.logger.info('Turn complete', {

      turnDuration,

      firstLLMTokenMs: firstLLMTokenLatency,

      firstTTSByteMs: firstByteLatency,

      turnCount: this.session.metrics.turnCount

    });



    // Reset metrics for next turn

    this.metrics = this.createEmptyMetrics();

  }



  /**

   * Detect language from text based on script (Devanagari vs Latin)

   * Returns appropriate BCP-47 language code for TTS

   */

  private detectLanguage(text: string): SupportedLanguage {

    // Count Devanagari characters (Hindi, Marathi, etc.)

    const devanagariRegex = /[\u0900-\u097F]/g;

    const devanagariCount = (text.match(devanagariRegex) || []).length;

    

    // Count Latin characters (English)

    const latinRegex = /[a-zA-Z]/g;

    const latinCount = (text.match(latinRegex) || []).length;

    

    const totalChars = devanagariCount + latinCount;

    if (totalChars === 0) return this.session.ttsConfig.voice.language;

    

    // If >50% Devanagari, use Hindi; otherwise English

    const devanagariRatio = devanagariCount / totalChars;

    

    if (devanagariRatio > 0.5) {

      return 'hi-IN';

    }

    return 'en-IN';

  }



  /**

   * Get recent conversation history with sliding window

   * This prevents token explosion by limiting context sent to LLM

   * 

   * Strategy:

   * 1. Keep last N turns (user + assistant pairs)

   * 2. Estimate tokens and trim if exceeding limit

   * 3. Always preserve most recent messages

   */

  private getRecentMessages(): ChatMessage[] {

    const messages = this.session.messages;

    

    if (messages.length === 0) {

      return [];

    }



    // Calculate max messages based on turns (each turn = user + assistant)

    const maxMessages = this.config.maxHistoryTurns * 2;

    

    // If under limit, return all

    if (messages.length <= maxMessages) {

      return messages;

    }



    // Sliding window: keep only the most recent messages

    const recentMessages = messages.slice(-maxMessages);

    

    // Estimate tokens and further trim if needed

    let estimatedTokens = this.estimateMessageTokens(recentMessages);

    

    while (estimatedTokens > this.config.maxHistoryTokens && recentMessages.length > 2) {

      // Remove oldest pair (user + assistant)

      recentMessages.splice(0, 2);

      estimatedTokens = this.estimateMessageTokens(recentMessages);

    }



    if (recentMessages.length < messages.length) {

      this.logger.debug('Conversation history truncated', {

        originalCount: messages.length,

        truncatedCount: recentMessages.length,

        estimatedTokens,

        maxTokens: this.config.maxHistoryTokens

      });

    }



    return recentMessages;

  }



  /**

   * Estimate token count for messages (rough approximation)

   * Uses ~4 characters per token heuristic

   */

  private estimateMessageTokens(messages: ChatMessage[]): number {

    let totalChars = 0;

    for (const msg of messages) {

      totalChars += (msg.content?.length || 0);

      // Add overhead for tool calls

      if (msg.toolCalls) {

        totalChars += JSON.stringify(msg.toolCalls).length;

      }

    }

    // Rough estimate: 4 chars per token + message overhead

    return Math.ceil(totalChars / 4) + (messages.length * 10);

  }



  /**

   * Estimate total prompt tokens for logging/debugging

   */

  private estimateTotalPromptTokens(

    messages: ChatMessage[], 

    tools: ToolDefinition[], 

    systemPrompt?: string

  ): number {

    let tokens = 0;

    

    // System prompt tokens (~4 chars per token)

    if (systemPrompt) {

      tokens += Math.ceil(systemPrompt.length / 4);

    }

    

    // Message tokens

    tokens += this.estimateMessageTokens(messages);

    

    // Tool definition tokens (JSON schema is verbose)

    for (const tool of tools) {

      // Tool name + description + parameters schema

      tokens += Math.ceil(tool.name.length / 4);

      tokens += Math.ceil((tool.description?.length || 0) / 4);

      tokens += Math.ceil(JSON.stringify(tool.parameters).length / 4);

    }

    

    return tokens;

  }



  private createEmptyMetrics(): PipelineMetrics {

    return {

      stages: [],

      totalLatencyMs: 0,

      firstByteLatencyMs: 0

    };

  }

}



export default VoicePipeline;

