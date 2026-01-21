/**
 * Core type definitions for AI Voice Calling Backend
 * All shared types, interfaces, and enums are defined here
 */

// ============================================================================
// LANGUAGE & VOICE TYPES
// ============================================================================

export type SupportedLanguage = 
  | 'en-IN'  // Indian English
  | 'hi-IN'  // Hindi
  | 'ta-IN'  // Tamil
  | 'te-IN'  // Telugu
  | 'ml-IN'  // Malayalam
  | 'kn-IN'  // Kannada
  | 'bn-IN'  // Bengali
  | 'mr-IN'  // Marathi
  | 'gu-IN'  // Gujarati
  | 'pa-IN'  // Punjabi
  | 'unknown';  // Auto-detect

export interface VoiceConfig {
  voiceId: string;
  language: SupportedLanguage;
  gender: 'male' | 'female' | 'neutral';
  speakingRate?: number;  // 0.5 to 2.0
  pitch?: number;         // -20 to 20
}

// ============================================================================
// PROVIDER TYPES
// ============================================================================

export type STTProviderType = 'sarvam' | 'reverie' | 'google' | 'deepgram';
export type LLMProviderType = 'gemini' | 'openai' | 'anthropic' | 'groq';
export type TTSProviderType = 'sarvam' | 'reverie' | 'google' | 'elevenlabs';

export interface ProviderCredentials {
  apiKey: string;
  apiSecret?: string;
  projectId?: string;
  region?: string;
  additionalConfig?: Record<string, unknown>;
}

export interface ProviderConfig {
  type: string;
  credentials: ProviderCredentials;
  timeout?: number;
  retryAttempts?: number;
  rateLimitPerMinute?: number;
}

// ============================================================================
// STT (Speech-to-Text) TYPES
// ============================================================================

export interface STTConfig extends ProviderConfig {
  type: STTProviderType;
  language: SupportedLanguage;
  enablePunctuation?: boolean;
  enableWordTimestamps?: boolean;
  sampleRateHertz?: number;
  encoding?: AudioEncoding;
  model?: string;
}

export type AudioEncoding = 
  | 'LINEAR16'
  | 'MULAW'
  | 'AMR'
  | 'AMR_WB'
  | 'OGG_OPUS'
  | 'WEBM_OPUS'
  | 'MP3';

export interface TranscriptionResult {
  text: string;
  isFinal: boolean;
  confidence: number;
  words?: WordInfo[];
  language?: SupportedLanguage;
  latencyMs?: number;
}

export interface WordInfo {
  word: string;
  startTime: number;
  endTime: number;
  confidence: number;
}

export interface STTStreamEvents {
  onPartialTranscript: (result: TranscriptionResult) => void;
  onFinalTranscript: (result: TranscriptionResult) => void;
  onError: (error: Error) => void;
  onEnd: () => void;
}

// ============================================================================
// LLM (Large Language Model) TYPES
// ============================================================================

export interface LLMConfig extends ProviderConfig {
  type: LLMProviderType;
  model: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  topK?: number;
  systemPrompt?: string;
  enableStreaming?: boolean;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;
  toolCalls?: ToolCall[];
  name?: string;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, ToolParameterSchema>;
    required?: string[];
  };
}

export interface ToolParameterSchema {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description: string;
  enum?: string[];
  items?: ToolParameterSchema;
  properties?: Record<string, ToolParameterSchema>;
}

export interface LLMResponse {
  content: string;
  toolCalls?: ToolCall[];
  finishReason: 'stop' | 'tool_calls' | 'length' | 'error';
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  latencyMs?: number;
}

export interface LLMStreamChunk {
  content: string;
  isComplete: boolean;
  toolCalls?: ToolCall[];
  finishReason?: string;
}

export interface LLMStreamEvents {
  onToken: (chunk: LLMStreamChunk) => void;
  onSentence: (sentence: string) => void;
  onToolCall: (toolCall: ToolCall) => void;
  onComplete: (response: LLMResponse) => void;
  onError: (error: Error) => void;
}

// ============================================================================
// TTS (Text-to-Speech) TYPES
// ============================================================================

export interface TTSConfig extends ProviderConfig {
  type: TTSProviderType;
  voice: VoiceConfig;
  audioFormat?: AudioFormat;
  sampleRateHertz?: number;
  enableSSML?: boolean;
}

export interface AudioFormat {
  encoding: 'LINEAR16' | 'MP3' | 'OGG_OPUS' | 'MULAW';
  sampleRateHertz: number;
  channels?: number;
}

export interface TTSResult {
  audioContent: Buffer;
  audioFormat: AudioFormat;
  durationMs: number;
  latencyMs?: number;
}

export interface TTSStreamEvents {
  onAudioChunk: (chunk: Buffer) => void;
  onComplete: (result: TTSResult) => void;
  onError: (error: Error) => void;
}

// ============================================================================
// CALL SESSION TYPES
// ============================================================================

export interface CallSession {
  sessionId: string;
  tenantId: string;
  callerId: string;
  callerNumber?: string;
  startTime: Date;
  endTime?: Date;
  status: CallStatus;
  
  // Provider configurations per session
  sttConfig: STTConfig;
  llmConfig: LLMConfig;
  ttsConfig: TTSConfig;
  
  // Conversation state
  messages: ChatMessage[];
  context: Record<string, unknown>;
  
  // Metrics
  metrics: CallMetrics;
}

export type CallStatus = 
  | 'initializing'
  | 'active'
  | 'on_hold'
  | 'transferring'
  | 'ending'
  | 'ended'
  | 'error';

export interface CallMetrics {
  totalDurationMs: number;
  sttLatencyMs: number[];
  llmLatencyMs: number[];
  ttsLatencyMs: number[];
  e2eLatencyMs: number[];
  tokenCount: number;
  turnCount: number;
  toolCallCount: number;
  errorCount: number;
  estimatedCost: number;
}

// ============================================================================
// TOOL EXECUTION TYPES
// ============================================================================

export interface ToolExecutionRequest {
  toolName: string;
  arguments: Record<string, unknown>;
  sessionId: string;
  callContext: Record<string, unknown>;
}

export interface ToolExecutionResult {
  success: boolean;
  result?: unknown;
  error?: string;
  latencyMs: number;
}

export interface ToolRegistry {
  tools: Map<string, RegisteredTool>;
  register: (tool: RegisteredTool) => void;
  unregister: (name: string) => void;
  execute: (request: ToolExecutionRequest) => Promise<ToolExecutionResult>;
  getDefinitions: () => ToolDefinition[];
}

export interface RegisteredTool {
  definition: ToolDefinition;
  handler: (args: Record<string, unknown>, context: ToolExecutionContext) => Promise<unknown>;
  timeout?: number;
  requiresAuth?: boolean;
  metadata?: {
    source?: 'local' | 'mcp' | 'n8n';
    server?: string;
    originalName?: string;
    [key: string]: unknown;
  };
}

export interface ToolExecutionContext {
  sessionId: string;
  tenantId: string;
  callContext: Record<string, unknown>;
  logger: Logger;
}

// ============================================================================
// MCP (Model Context Protocol) TYPES
// ============================================================================

export interface MCPServerConfig {
  name: string;
  url: string;
  apiKey?: string;
  timeout?: number;
  retryAttempts?: number;
}

export interface MCPToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface MCPRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: unknown;
}

export interface MCPResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: unknown;
  error?: MCPError;
}

export interface MCPError {
  code: number;
  message: string;
  data?: unknown;
}

// ============================================================================
// PIPELINE TYPES
// ============================================================================

export interface PipelineStage {
  name: string;
  startTime: number;
  endTime?: number;
  latencyMs?: number;
  status: 'pending' | 'running' | 'completed' | 'error';
  error?: Error;
}

export interface PipelineMetrics {
  stages: PipelineStage[];
  totalLatencyMs: number;
  firstByteLatencyMs: number;
}

// ============================================================================
// LOGGING TYPES
// ============================================================================

export interface Logger {
  debug: (msg: string, data?: Record<string, unknown>) => void;
  info: (msg: string, data?: Record<string, unknown>) => void;
  warn: (msg: string, data?: Record<string, unknown>) => void;
  error: (msg: string, data?: Record<string, unknown>) => void;
  child: (bindings: Record<string, unknown>) => Logger;
}

export interface LogContext {
  sessionId?: string;
  tenantId?: string;
  provider?: string;
  operation?: string;
  latencyMs?: number;
  [key: string]: unknown;
}

// ============================================================================
// ERROR TYPES
// ============================================================================

export class VoiceAgentError extends Error {
  constructor(
    message: string,
    public code: string,
    public provider?: string,
    public retryable: boolean = false,
    public originalError?: Error
  ) {
    super(message);
    this.name = 'VoiceAgentError';
  }
}

export class ProviderError extends VoiceAgentError {
  constructor(
    message: string,
    provider: string,
    code: string,
    retryable: boolean = false,
    originalError?: Error
  ) {
    super(message, code, provider, retryable, originalError);
    this.name = 'ProviderError';
  }
}

export class TimeoutError extends VoiceAgentError {
  constructor(
    message: string,
    provider?: string,
    public timeoutMs?: number
  ) {
    super(message, 'TIMEOUT', provider, true);
    this.name = 'TimeoutError';
  }
}

// ============================================================================
// LATENCY OPTIMIZATION TYPES
// ============================================================================

export interface TurnDetectionConfig {
  /** Minimum silence duration (ms) before considering turn complete */
  silenceThresholdMs: number;
  /** Maximum wait time (ms) for additional speech after silence detected */
  maxWaitAfterSilenceMs: number;
  /** Minimum transcript length before processing */
  minTranscriptLength: number;
  /** Enable punctuation-based endpointing */
  usePunctuationEndpoint: boolean;
  /** Ignore STT during TTS playback (echo suppression) */
  suppressEchoDuringPlayback: boolean;
}

export interface FillerConfig {
  /** Enable filler speech during tool execution */
  enabled: boolean;
  /** Use cached audio for fillers (faster) */
  useCachedAudio: boolean;
  /** Categories of fillers to use */
  categories: ('tool_execution' | 'thinking' | 'acknowledgment')[];
}

export interface AudioCachingConfig {
  /** Enable audio caching */
  enabled: boolean;
  /** Preload common phrases on startup */
  preloadOnStart: boolean;
  /** Languages to preload */
  preloadLanguages: SupportedLanguage[];
  /** Maximum cache size */
  maxCacheSize: number;
}

export interface LatencyOptimizationConfig {
  turnDetection: TurnDetectionConfig;
  fillers: FillerConfig;
  audioCaching: AudioCachingConfig;
}

export const DEFAULT_LATENCY_CONFIG: LatencyOptimizationConfig = {
  turnDetection: {
    // Phase 5: Smart Balanced - Confidence-based dynamic thresholds
    // Based on industry research (Cresta, AssemblyAI, Twilio):
    // - Complete sentences with punctuation: 200-250ms (fast-tracked)
    // - Medium confidence: 450ms base
    // - Incomplete thoughts: up to 900ms max
    // Target: sub-500ms median, sub-800ms P95
    silenceThresholdMs: 450,        // Base wait - balanced between speed and accuracy
    maxWaitAfterSilenceMs: 900,     // Max wait for incomplete utterances (reduced from 1800)
    minTranscriptLength: 4,         // Process shorter inputs for responsiveness
    usePunctuationEndpoint: true,   // Critical: fast-track complete sentences
    suppressEchoDuringPlayback: true
  },
  fillers: {
    enabled: true,
    useCachedAudio: true,
    categories: ['tool_execution', 'thinking']
  },
  audioCaching: {
    enabled: true,
    preloadOnStart: true,
    preloadLanguages: ['en-IN', 'hi-IN'],
    maxCacheSize: 100
  }
};

// ============================================================================
// EVENT TYPES
// ============================================================================

export type VoiceAgentEvent = 
  | { type: 'session_started'; sessionId: string; tenantId: string }
  | { type: 'session_ended'; sessionId: string; metrics: CallMetrics }
  | { type: 'stt_partial'; sessionId: string; text: string }
  | { type: 'stt_final'; sessionId: string; text: string }
  | { type: 'llm_token'; sessionId: string; token: string }
  | { type: 'llm_sentence'; sessionId: string; sentence: string }
  | { type: 'llm_tool_call'; sessionId: string; toolCall: ToolCall }
  | { type: 'tts_audio_chunk'; sessionId: string; chunk: Buffer }
  | { type: 'tts_complete'; sessionId: string }
  | { type: 'error'; sessionId: string; error: VoiceAgentError }
  | { type: 'barge_in'; sessionId: string };

export interface EventEmitter {
  emit: (event: VoiceAgentEvent) => void;
  on: (type: VoiceAgentEvent['type'], handler: (event: VoiceAgentEvent) => void) => void;
  off: (type: VoiceAgentEvent['type'], handler: (event: VoiceAgentEvent) => void) => void;
}
