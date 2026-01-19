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

  // Phase 4: Advanced Turn Detection
  // Silence debounce - wait for sustained silence before processing
  private silenceDebounceTimer: NodeJS.Timeout | null = null;
  private accumulatedTranscript: string = '';     // Accumulate speech across multiple STT finals
  private lastSpeechTime: number = 0;             // Track when user last spoke
  private isSpeaking: boolean = false;            // Track if user is currently speaking

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

  private bargeInThreshold: number = 600;  // Audio level threshold for barge-in (tuned: 1000+ = speech, 200-500 = noise)
  private consecutiveLoudChunks: number = 0;
  private bargeInChunksRequired: number = 3;  // Require 3 consecutive loud chunks for stability

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
      const audioLevel = this.calculateAudioLevel(audioChunk);
      
      // Use lower threshold for more sensitive barge-in detection
      const threshold = this.bargeInThreshold;
      
      // Debug: Log audio levels periodically during TTS
      if (Math.random() < 0.1) {
        this.logger.debug('Barge-in check', { 
          audioLevel, 
          threshold,
          consecutiveLoud: this.consecutiveLoudChunks,
          isTTSPlaying: this.isTTSPlaying
        });
      }
      
      if (audioLevel > threshold) {
        this.consecutiveLoudChunks++;
        
        // Trigger barge-in after 2 consecutive loud chunks (reduced from 3)
        if (this.consecutiveLoudChunks >= 2) {
          this.logger.info('Barge-in triggered', { 
            audioLevel, 
            chunks: this.consecutiveLoudChunks,
            threshold
          });
          this.handleBargeIn();
          this.consecutiveLoudChunks = 0;
          // Don't return - let the audio go to STT for the new turn
        }
      } else {
        this.consecutiveLoudChunks = 0;
      }
    }

    // Phase 2: Echo suppression - skip STT only during active TTS playback
    // But still allow audio through shortly after TTS ends for natural conversation
    if (this.isTTSPlaying) {
      // Don't send audio to STT while TTS is actively playing
      return;
    }

    this.sttSession.write(audioChunk);
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
    
    // Phase 4: Clear silence debounce timer
    if (this.silenceDebounceTimer) {
      clearTimeout(this.silenceDebounceTimer);
      this.silenceDebounceTimer = null;
    }
    this.accumulatedTranscript = '';
    
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
        },

        onFinalTranscript: async (result: TranscriptionResult) => {
          this.endStage(stage);
          this.emit('stt_final', result.text);
          
          // Phase 2: Store confidence for filtering
          this.lastSTTConfidence = result.confidence;
          
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
   * Phase 4.1: Calculate how long to wait for silence based on transcript characteristics
   * Prioritizes waiting longer to avoid interrupting users mid-thought
   * Only reduces wait time when there's strong evidence of turn completion
   */
  private calculateSilenceWait(transcript: string): number {
    const turnConfig = this.config.latencyOptimization.turnDetection;
    const baseWait = turnConfig.silenceThresholdMs;
    const maxWait = turnConfig.maxWaitAfterSilenceMs;
    
    const trimmed = transcript.trim();
    
    // Check for sentence-ending punctuation
    const endsWithPunctuation = /[.!?।॥]$/.test(trimmed);
    
    // Check for common turn-ending phrases (must be at the end)
    const turnEndingPhrases = /\b(thanks|thank you|okay|ok|bye|goodbye|done|that's it|that's all|please proceed|go ahead)\s*[.!?]?$/i;
    const hasTurnEndingPhrase = turnEndingPhrases.test(trimmed);
    
    // Check for MID-THOUGHT indicators - user is likely to continue
    // These patterns suggest incomplete thoughts that need more time
    const midThoughtPatterns = [
      /\b(and|but|or|so|because|however|although|though|since|while|if|when|where|which|that|um|uh|like|you know|I mean)\s*$/i,
      /,\s*$/,                                           // Ends with comma
      /\b(I|we|you|they|he|she|it)\s*$/i,               // Ends with pronoun
      /\b(is|are|was|were|will|would|could|should|can|have|has|had)\s*$/i,  // Ends with auxiliary verb
      /\b(the|a|an|this|that|these|those|my|your|our)\s*$/i,  // Ends with determiner
      /\b(want|need|would like|am looking|am thinking|was wondering)\s*$/i,  // Ends with intent verb
      /\b(about|for|to|with|from|in|on|at)\s*$/i,       // Ends with preposition
    ];
    const isMidThought = midThoughtPatterns.some(p => p.test(trimmed));
    
    // Questions ending with ? can be processed faster
    const isQuestion = /\?$/.test(trimmed);
    
    // Calculate wait time based on characteristics
    let waitMs = baseWait;
    
    // MID-THOUGHT: User is clearly not done - wait maximum time
    if (isMidThought) {
      waitMs = maxWait;
      this.logger.debug('Mid-thought detected, using max wait', { 
        transcript: trimmed.slice(-30),
        waitMs 
      });
    }
    // CLEAR ENDING: Strong signals of turn completion
    else if (endsWithPunctuation && hasTurnEndingPhrase) {
      // Very clear ending - can respond faster
      waitMs = Math.min(baseWait * 0.5, 600);
    } else if (isQuestion) {
      // Questions with ? usually indicate turn completion
      waitMs = Math.min(baseWait * 0.6, 700);
    } else if (endsWithPunctuation && trimmed.length > 20) {
      // Sentence with punctuation and decent length
      waitMs = Math.min(baseWait * 0.75, 900);
    } 
    // UNCERTAIN: Need to wait longer
    else if (trimmed.length < 20) {
      // Short utterance without punctuation - wait max
      waitMs = maxWait;
    } else if (trimmed.length < 40) {
      // Medium utterance without clear ending
      waitMs = Math.max(baseWait, 1200);
    } else {
      // Long utterance but no punctuation - still wait base time
      waitMs = baseWait;
    }
    
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
          // Audio is buffered on client, so server completion != client playback complete
          const estimatedPlaybackMs = result.durationMs || 2000;
          this.logger.debug('TTS streaming complete on server, waiting for client playback', { 
            durationMs: result.durationMs,
            estimatedPlaybackMs
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
   * Stream a sentence to TTS immediately (low-latency)
   * Phase 2: Track sentences for barge-in history truncation
   */
  private streamSentenceToTTS(sentence: string): void {
    if (!sentence.trim()) return;
    
    // Phase 2: Track sentence for history truncation
    this.ttsTextQueue.push(sentence.trim());
    this.currentAssistantMessage += sentence;
    
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
        // Stop the pipeline after a short delay to allow final TTS to play
        setTimeout(() => this.stop(), 500);
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
    this.logger.info('Barge-in: aborting current turn', {
      fullMessage: this.currentAssistantMessage.length,
      playedText: this.playedAudioText.length,
      sentenceIndex: this.ttsSentenceIndex
    });
    
    // Phase 2: Truncate the last assistant message to what was actually heard
    this.truncateAssistantMessage();
    
    // Stop current TTS playback
    this.ttsSession?.abort();
    this.ttsSession = null;
    this.isTTSPlaying = false;
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

  private createEmptyMetrics(): PipelineMetrics {
    return {
      stages: [],
      totalLatencyMs: 0,
      firstByteLatencyMs: 0
    };
  }
}

export default VoicePipeline;
