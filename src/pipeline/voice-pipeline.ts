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

  // Audio cache for filler phrases (Phase 1 optimization)
  private audioCache: AudioCacheService | null = null;
  private isTTSPlaying: boolean = false;

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

    this.config = {
      enableBargeIn: true,
      sttPartialThreshold: 5,
      llmSentenceBuffer: 20,
      maxTurnDuration: 30000,
      silenceTimeout: 2000,
      latencyOptimization: DEFAULT_LATENCY_CONFIG,
      ...config
    };

    this.metrics = this.createEmptyMetrics();
  }

  /**
   * Start the voice pipeline
   */
  async start(): Promise<void> {
    this.isActive = true;
    this.logger.info('Voice pipeline started');
    
    // Initialize all providers
    await Promise.all([
      this.sttProvider.initialize(),
      this.llmProvider.initialize(),
      this.ttsProvider.initialize()
    ]);

    // Start STT streaming session
    await this.startSTTSession();
  }

  private bargeInThreshold: number = 500;  // Audio level threshold for barge-in
  private consecutiveLoudChunks: number = 0;
  private bargeInChunksRequired: number = 3;  // Require 3 consecutive loud chunks

  /**
   * Process incoming audio chunk from caller
   */
  processAudioChunk(audioChunk: Buffer): void {
    if (!this.isActive || !this.sttSession) {
      return;
    }

    // Handle barge-in: only if TTS is playing AND user is actually speaking
    if (this.config.enableBargeIn && this.isTTSPlaying) {
      const audioLevel = this.calculateAudioLevel(audioChunk);
      
      if (audioLevel > this.bargeInThreshold) {
        this.consecutiveLoudChunks++;
        
        // Only trigger barge-in after sustained speech detected
        if (this.consecutiveLoudChunks >= this.bargeInChunksRequired) {
          this.logger.info('Barge-in triggered', { audioLevel, chunks: this.consecutiveLoudChunks });
          this.handleBargeIn();
          this.isTTSPlaying = false;
          this.consecutiveLoudChunks = 0;
        }
      } else {
        this.consecutiveLoudChunks = 0;  // Reset on quiet chunk
      }
    }

    this.sttSession.write(audioChunk);
  }

  /**
   * Calculate RMS audio level from PCM buffer
   */
  private calculateAudioLevel(buffer: Buffer): number {
    // Assume 16-bit PCM audio
    let sum = 0;
    const samples = buffer.length / 2;
    
    for (let i = 0; i < buffer.length; i += 2) {
      const sample = buffer.readInt16LE(i);
      sum += sample * sample;
    }
    
    return Math.sqrt(sum / samples);
  }

  /**
   * Stop the voice pipeline
   */
  async stop(): Promise<void> {
    this.isActive = false;
    
    // Abort all active sessions
    this.sttSession?.abort();
    this.llmSession?.abort();
    this.ttsSession?.abort();

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
    let accumulatedText = '';

    this.sttSession = this.sttProvider.createStreamingSession(
      {
        onPartialTranscript: (result: TranscriptionResult) => {
          this.emit('stt_partial', result.text);
          
          // Early LLM triggering for lower latency
          if (result.text.length >= this.config.sttPartialThreshold && !this.isProcessingTurn) {
            accumulatedText = result.text;
          }
        },

        onFinalTranscript: async (result: TranscriptionResult) => {
          this.endStage(stage);
          this.emit('stt_final', result.text);
          
          accumulatedText = result.text;
          
          // Filter out garbage/phantom transcripts
          if (this.isValidTranscript(accumulatedText)) {
            await this.processUserInput(accumulatedText);
          } else {
            this.logger.debug('Filtered invalid transcript', { 
              text: accumulatedText,
              reason: this.getFilterReason(accumulatedText)
            });
          }
          
          accumulatedText = '';
        },

        onError: (error: Error) => {
          this.logger.error('STT error', { error: error.message });
          this.emit('error', error);
        },

        onEnd: () => {
          this.logger.debug('STT session ended');
        }
      },
      this.session.sttConfig.language
    );

    await this.sttSession.start();
  }

  private async processUserInput(userText: string): Promise<void> {
    if (this.isProcessingTurn) {
      this.logger.warn('Already processing a turn, queuing input');
      return;
    }

    this.isProcessingTurn = true;
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
    
    // Reset first-byte tracking for this turn
    this.firstLLMTokenTime = 0;
    this.firstTTSByteTime = 0;
    this.ttsSessionReady = false;

    // Get tool definitions from registry
    const tools = this.toolRegistry.getDefinitions();

    // Start TTS session FIRST for streaming audio output (don't block)
    this.startTTSSessionAsync();

    this.llmSession = await this.llmProvider.generateStream(
      this.session.messages,
      tools,
      this.session.llmConfig.systemPrompt,
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
        },

        onSentence: (sentence) => {
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
          
          // STREAM IMMEDIATELY: Send each sentence to TTS as soon as it arrives
          // This is critical for low-latency - don't wait for full response
          this.streamSentenceToTTS(sentence);
        },

        onToolCall: async (toolCall) => {
          this.emit('llm_tool_call', toolCall);
          toolCalls.push(toolCall);
          
          // Execute tool and continue conversation
          await this.executeToolCall(toolCall);
        },

        onComplete: (response) => {
          this.endStage(stage);
          fullResponse = response.content;
          
          // Add assistant message to history
          const assistantMessage: ChatMessage = {
            role: 'assistant',
            content: fullResponse,
            toolCalls: response.toolCalls
          };
          this.session.messages.push(assistantMessage);

          // Update metrics
          if (response.usage) {
            this.session.metrics.tokenCount += response.usage.totalTokens;
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

    this.ttsSession = this.ttsProvider.createStreamingSession(
      {
        onAudioChunk: (chunk: Buffer) => {
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
          
          this.isTTSPlaying = true;
          this.emit('tts_audio_chunk', chunk);
        },

        onComplete: (result: TTSResult) => {
          this.isTTSPlaying = false;
          this.endStage(stage);
          this.logger.debug('TTS streaming complete', { 
            durationMs: result.durationMs,
            latencyMs: result.latencyMs 
          });
        },

        onError: (error: Error) => {
          this.isTTSPlaying = false;
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
   * Stream a sentence to TTS immediately (low-latency)
   */
  private streamSentenceToTTS(sentence: string): void {
    if (!sentence.trim()) return;
    
    // Wait briefly for TTS session if not ready yet
    if (!this.ttsSessionReady || !this.ttsSession?.isSessionActive()) {
      // Retry after short delay
      setTimeout(() => {
        if (this.ttsSession?.isSessionActive()) {
          this.logger.debug('Streaming sentence to TTS', { length: sentence.length });
          this.ttsSession.sendText(sentence);
          this.ttsSentText = true;
        }
      }, 50);
      return;
    }
    
    this.logger.debug('Streaming sentence to TTS', { length: sentence.length });
    this.ttsSession.sendText(sentence);
    this.ttsSentText = true;
  }
  
  /**
   * Signal TTS that no more text is coming
   * Don't wait for audio completion - let it stream in background
   */
  private signalTTSComplete(): void {
    // Only end TTS session if we actually sent text to it
    // Otherwise Cartesia will error with "No valid transcripts passed"
    if (this.ttsSession?.isSessionActive() && this.ttsSentText) {
      // End the session but don't await - audio continues streaming
      this.ttsSession.end().catch((error) => {
        this.logger.error('TTS end error', { error: error.message });
      });
    }
    // Reset flag for next turn
    this.ttsSentText = false;
  }

  private async executeToolCall(toolCall: ToolCall): Promise<void> {
    const stage = this.startStage('tool_execution');
    
    try {
      const args = JSON.parse(toolCall.function.arguments);
      
      // Phase 1: Play filler speech during tool execution
      const fillerPromise = this.playToolFiller(toolCall.function.name);
      
      // Execute tool in parallel with filler playback
      const [result] = await Promise.all([
        this.toolRegistry.execute({
          toolName: toolCall.function.name,
          arguments: args,
          sessionId: this.session.sessionId,
          callContext: this.session.context
        }),
        fillerPromise
      ]);

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
        // Stop the pipeline after a short delay to allow final TTS to play
        setTimeout(() => this.stop(), 500);
        return; // Don't continue LLM generation for end_call
      }

      // Continue LLM generation with tool result
      // Make a follow-up call so LLM can speak the response to the user
      this.logger.debug('Continuing LLM generation with tool result', { 
        tool: toolCall.function.name 
      });
      await this.generateLLMResponse();

    } catch (error) {
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
   * Play filler speech while tool is executing
   * Uses cached audio for instant playback, falls back to live TTS
   */
  private async playToolFiller(toolName: string): Promise<void> {
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
   * Called from API server when client detects user speaking during AI audio
   */
  public handleBargeIn(): void {
    this.logger.info('Barge-in: aborting current turn');
    
    // Stop current TTS playback
    this.ttsSession?.abort();
    this.ttsSession = null;
    this.isTTSPlaying = false;

    // Stop current LLM generation
    this.llmSession?.abort();
    this.llmSession = null;

    // Reset turn state so new input can be processed
    this.isProcessingTurn = false;
    this.pendingSentences = [];

    this.emit('barge_in');
  }

  /**
   * Validate transcript to filter out garbage/phantom STT results
   * Returns true if the transcript should be processed
   * Uses configurable turn detection settings
   */
  private isValidTranscript(text: string): boolean {
    const trimmed = text.trim();
    const turnConfig = this.config.latencyOptimization.turnDetection;
    
    // Filter empty or very short transcripts (configurable minimum length)
    if (trimmed.length < turnConfig.minTranscriptLength) {
      return false;
    }
    
    // Filter transcripts that are mostly non-ASCII (garbled text)
    const asciiChars = trimmed.replace(/[^\x00-\x7F]/g, '');
    const asciiRatio = asciiChars.length / trimmed.length;
    if (asciiRatio < 0.5 && trimmed.length < 10) {
      return false;
    }
    
    // Echo suppression during TTS playback (configurable)
    if (turnConfig.suppressEchoDuringPlayback && this.isTTSPlaying) {
      // Filter short utterances during playback as they're likely echo
      if (trimmed.length < 8) {
        return false;
      }
    }
    
    // Punctuation-based endpointing check (optional)
    if (turnConfig.usePunctuationEndpoint) {
      const endsWithPunctuation = /[.!?।॥]$/.test(trimmed);
      // Allow through if ends with punctuation or is long enough
      if (!endsWithPunctuation && trimmed.length < 15) {
        // Short transcripts without punctuation might be incomplete
        // But we still process them to avoid adding latency
      }
    }
    
    return true;
  }

  /**
   * Get the reason why a transcript was filtered (for logging)
   */
  private getFilterReason(text: string): string {
    const trimmed = text.trim();
    const turnConfig = this.config.latencyOptimization.turnDetection;
    
    if (trimmed.length < turnConfig.minTranscriptLength) {
      return 'too_short';
    }
    
    const asciiChars = trimmed.replace(/[^\x00-\x7F]/g, '');
    const asciiRatio = asciiChars.length / trimmed.length;
    if (asciiRatio < 0.5 && trimmed.length < 10) {
      return 'garbled_text';
    }
    
    if (turnConfig.suppressEchoDuringPlayback && this.isTTSPlaying && trimmed.length < 8) {
      return 'echo_during_playback';
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

  private createEmptyMetrics(): PipelineMetrics {
    return {
      stages: [],
      totalLatencyMs: 0,
      firstByteLatencyMs: 0
    };
  }
}

export default VoicePipeline;
