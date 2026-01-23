/**
 * Telephony Manager
 * Orchestrates telephony adapters and connects calls to voice pipelines
 */

import { EventEmitter } from 'events';
import { Logger, CallSession, STTConfig, LLMConfig, TTSConfig, DEFAULT_LATENCY_CONFIG } from '../types';
import { AudioCacheService } from '../services/audio-cache';
import { SessionManager, CreateSessionOptions } from '../session/session-manager';
import { VoicePipeline } from '../pipeline/voice-pipeline';
import { STTProviderFactory } from '../providers/base/stt-provider';
import { LLMProviderFactory } from '../providers/base/llm-provider';
import { TTSProviderFactory } from '../providers/base/tts-provider';
import { ToolRegistry } from '../tools/tool-registry';
import { BaseTelephonyAdapter } from './adapters/base-adapter';
import { PlivoAdapter } from './adapters/plivo-adapter';
import { 
  TelephonyConfig, 
  IncomingCall, 
  TelephonyAudioPacket 
} from './types';
import { telephonyToPipeline } from './audio-converter';
import { createCallRecord, endCallRecord, findCallBySessionId, getOrgIdFromAgent } from '../saas-api/call-persistence';

export interface TelephonyManagerConfig {
  adapters: TelephonyConfig[];
  defaultSTTConfig: STTConfig;
  defaultLLMConfig: LLMConfig;
  defaultTTSConfig: TTSConfig;
  systemPrompt: string;
}

export class TelephonyManager extends EventEmitter {
  private logger: Logger;
  private sessionManager: SessionManager;
  private toolRegistry: ToolRegistry;
  private adapters: Map<string, BaseTelephonyAdapter> = new Map();
  private activePipelines: Map<string, VoicePipeline> = new Map();
  private callToSession: Map<string, string> = new Map();  // callId -> sessionId
  private pendingAudio: Map<string, TelephonyAudioPacket[]> = new Map();  // Buffer for early packets
  private config: TelephonyManagerConfig;
  private audioCache: AudioCacheService;

  constructor(
    config: TelephonyManagerConfig,
    sessionManager: SessionManager,
    toolRegistry: ToolRegistry,
    logger: Logger
  ) {
    super();
    this.config = config;
    this.sessionManager = sessionManager;
    this.toolRegistry = toolRegistry;
    this.logger = logger.child({ component: 'telephony-manager' });
    this.audioCache = new AudioCacheService(this.logger);
  }

  /**
   * Initialize all configured telephony adapters
   */
  async init(): Promise<void> {
    for (const adapterConfig of this.config.adapters) {
      try {
        const adapter = this.createAdapter(adapterConfig.provider);
        await adapter.init(adapterConfig);
        
        // Set up adapter event handlers
        this.setupAdapterEvents(adapter);
        
        this.adapters.set(adapterConfig.provider, adapter);
        this.logger.info('Telephony adapter initialized', { 
          provider: adapterConfig.provider 
        });
      } catch (error) {
        this.logger.error('Failed to initialize telephony adapter', {
          provider: adapterConfig.provider,
          error: (error as Error).message
        });
      }
    }
  }

  /**
   * Create adapter instance based on provider type
   */
  private createAdapter(provider: string): BaseTelephonyAdapter {
    switch (provider) {
      case 'plivo':
        return new PlivoAdapter(this.logger);
      default:
        throw new Error(`Unknown telephony provider: ${provider}`);
    }
  }

  /**
   * Set up event handlers for an adapter
   */
  private setupAdapterEvents(adapter: BaseTelephonyAdapter): void {
    adapter.on('call:started', async (call: IncomingCall) => {
      await this.handleCallStarted(adapter, call);
    });

    adapter.on('call:ended', async (callId: string, reason: string) => {
      await this.handleCallEnded(callId, reason);
    });

    adapter.on('audio:received', (packet: TelephonyAudioPacket) => {
      this.handleAudioReceived(packet);
    });

    adapter.on('dtmf', (callId: string, digit: string) => {
      this.emit('dtmf', callId, digit);
    });

    adapter.on('error', (callId: string, error: Error) => {
      this.logger.error('Telephony adapter error', { callId, error: error.message });
      this.emit('error', callId, error);
    });
  }

  /**
   * Handle incoming call - create session and pipeline
   */
  private async handleCallStarted(
    adapter: BaseTelephonyAdapter, 
    call: IncomingCall
  ): Promise<void> {
    this.logger.info('Handling incoming call', { 
      callId: call.callId, 
      from: call.from, 
      to: call.to 
    });

    try {
      // Try to find agent configuration for this phone number
      let sttConfig = this.config.defaultSTTConfig;
      let llmConfig = this.config.defaultLLMConfig;
      let ttsConfig = this.config.defaultTTSConfig;
      let systemPrompt = this.config.systemPrompt;
      let agentId: string | undefined;

      // Dynamic import to avoid circular dependency
      const { getAgentForPhoneNumber } = await import('../saas-api/phone-numbers');
      const agent = await getAgentForPhoneNumber(call.to);

      if (agent) {
        this.logger.info('Found agent configuration for phone number', {
          callId: call.callId,
          agentId: agent.id,
          agentName: agent.name
        });

        // Use agent's configuration
        agentId = agent.id;
        systemPrompt = agent.system_prompt || systemPrompt;

        // Build STT config with correct credentials for the provider
        const sttProviderType = agent.stt_provider as string;
        let sttCredentials = this.config.defaultSTTConfig.credentials;
        
        // Use provider-specific credentials from environment
        if (sttProviderType === 'sarvam') {
          sttCredentials = { apiKey: process.env.SARVAM_API_KEY || '' };
        } else if (sttProviderType === 'deepgram') {
          sttCredentials = { apiKey: process.env.DEEPGRAM_API_KEY || '' };
        }
        
        sttConfig = {
          ...this.config.defaultSTTConfig,
          type: sttProviderType as any,
          credentials: sttCredentials,
          ...(agent.stt_config as any),
          language: 'unknown' // Force multi-language support
        };

        // Build LLM config
        // Normalize provider name: gemini-flash -> gemini
        const llmProviderType = agent.llm_provider === 'gemini-flash' ? 'gemini' : agent.llm_provider;
        llmConfig = {
          ...this.config.defaultLLMConfig,
          type: llmProviderType as any,
          ...(agent.llm_config as any)
        };

        // Build TTS config with correct credentials for the provider
        const ttsProviderType = agent.tts_provider as string;
        let ttsCredentials = this.config.defaultTTSConfig.credentials;
        
        // Use provider-specific credentials from environment
        if (ttsProviderType === 'sarvam') {
          ttsCredentials = { apiKey: process.env.SARVAM_API_KEY || '' };
        } else if (ttsProviderType === 'cartesia') {
          ttsCredentials = { apiKey: process.env.CARTESIA_API_KEY || '' };
        } else if (ttsProviderType === 'elevenlabs') {
          ttsCredentials = { apiKey: process.env.ELEVENLABS_API_KEY || '' };
        }
        
        // Build voice config - use agent's voice_id or default per provider
        const agentTtsConfig = (agent.tts_config || {}) as any;
        const voiceConfig = {
          voiceId: agent.voice_id || agentTtsConfig.voiceId || (ttsProviderType === 'sarvam' ? 'anushka' : 'aura-asteria-en'),
          language: agentTtsConfig.language || 'en-IN',
          gender: agentTtsConfig.gender || 'female'
        };
        
        ttsConfig = {
          ...this.config.defaultTTSConfig,
          type: ttsProviderType as any,
          credentials: ttsCredentials,
          voice: voiceConfig,
          ...(agentTtsConfig)
        };
      } else {
        this.logger.warn('No agent found for phone number, using defaults', {
          callId: call.callId,
          phoneNumber: call.to
        });
      }

      // Create session for this call
      const sessionOptions: CreateSessionOptions = {
        tenantId: agentId || 'telephony',
        callerId: call.from,
        sttConfig,
        llmConfig,
        ttsConfig,
        systemPrompt,
        context: {
          callId: call.callId,
          from: call.from,
          to: call.to,
          provider: call.provider,
          channel: 'telephony',
          agentId
        }
      };

      const session = await this.sessionManager.createSession(sessionOptions);
      this.callToSession.set(call.callId, session.sessionId);

      // Create call record in database
      let organizationId: string | undefined;
      if (agentId) {
        organizationId = await getOrgIdFromAgent(agentId) || undefined;
      }
      
      const callRecord = await createCallRecord({
        organizationId,
        agentId,
        sessionId: session.sessionId,
        direction: call.direction || 'inbound',
        fromNumber: call.from,
        toNumber: call.to,
        sttProvider: sttConfig.type,
        ttsProvider: ttsConfig.type,
        llmProvider: llmConfig.type,
        metadata: {
          callId: call.callId,
          provider: call.provider,
          channel: 'telephony'
        }
      });

      if (callRecord) {
        this.logger.info('Call record created for telephony call', {
          callId: callRecord.id,
          sessionId: session.sessionId,
          direction: call.direction
        });
      }

      // Create providers using agent-specific or default configs
      this.logger.info('Creating providers with configs', {
        stt: sttConfig.type,
        llm: llmConfig.type,
        tts: ttsConfig.type
      });
      
      const sttProvider = STTProviderFactory.create(
        sttConfig, 
        this.logger
      );
      const llmProvider = LLMProviderFactory.create(
        llmConfig, 
        this.logger
      );
      const ttsProvider = TTSProviderFactory.create(
        ttsConfig, 
        this.logger
      );

      // Initialize audio cache with TTS provider if not already done
      if (!this.audioCache.isReady()) {
        this.audioCache.initialize(ttsProvider, ['en-IN', 'hi-IN'])
          .catch(err => this.logger.warn('Audio cache init failed', { error: err.message }));
      }

      // Create voice pipeline with latency optimization and audio cache
      const pipeline = new VoicePipeline(
        session,
        sttProvider,
        llmProvider,
        ttsProvider,
        this.toolRegistry,
        this.logger,
        { latencyOptimization: DEFAULT_LATENCY_CONFIG },
        this.audioCache
      );

      // Set up pipeline events to route audio back to telephony
      this.setupPipelineEvents(pipeline, adapter, call.callId, session.sessionId, ttsConfig);

      // Store and start pipeline
      this.activePipelines.set(call.callId, pipeline);
      await pipeline.start();
      
      // Flush any audio that arrived before pipeline was ready
      this.flushPendingAudio(call.callId);

      // Update session status
      await this.sessionManager.updateStatus(session.sessionId, 'active');

      this.logger.info('Voice pipeline started for telephony call', {
        callId: call.callId,
        sessionId: session.sessionId
      });

      this.emit('call:connected', call.callId, session.sessionId);

    } catch (error) {
      this.logger.error('Failed to set up call', {
        callId: call.callId,
        error: (error as Error).message
      });
      
      // End the call on error
      try {
        await adapter.endCall(call.callId);
      } catch (endError) {
        this.logger.error('Failed to end call after setup error', {
          callId: call.callId
        });
      }
    }
  }

  /**
   * Set up pipeline events to route TTS audio to telephony
   */
  private setupPipelineEvents(
    pipeline: VoicePipeline,
    adapter: BaseTelephonyAdapter,
    callId: string,
    sessionId: string,
    actualTtsConfig: any
  ): void {
    // Route TTS audio to telephony
    pipeline.on('tts_audio_chunk', (chunk: Buffer) => {
      // Get TTS sample rate from the actual session config
      let sampleRate: number;
      
      switch (actualTtsConfig.type) {
        case 'cartesia':
          sampleRate = actualTtsConfig.audioQuality === 'telephony' ? 8000 : 44100;
          break;
        case 'sarvam':
          sampleRate = 22050;
          break;
        default:
          sampleRate = 22050;
      }
      
      adapter.sendAudio(callId, chunk, sampleRate);
    });

    // Handle barge-in
    pipeline.on('barge_in', () => {
      adapter.clearAudio(callId);
    });

    // Log pipeline events
    pipeline.on('stt_final', (text: string) => {
      this.logger.info('STT transcript', { callId, text });
    });

    pipeline.on('turn_complete', (metrics: any) => {
      this.logger.info('Turn complete', { 
        callId, 
        firstByteLatencyMs: metrics.firstByteLatencyMs 
      });
    });

    pipeline.on('error', (error: Error) => {
      this.logger.error('Pipeline error', { callId, error: error.message });
    });

    // Handle agent-initiated call end
    pipeline.on('session_end_requested', async (data: { reason?: string }) => {
      this.logger.info('Agent requested call end', { callId, reason: data?.reason });
      
      // End the telephony call
      await adapter.endCall(callId);
    });
  }

  /**
   * Handle call ended - clean up resources
   */
  private async handleCallEnded(callId: string, reason: string): Promise<void> {
    this.logger.info('Call ended', { callId, reason });

    // Stop pipeline
    const pipeline = this.activePipelines.get(callId);
    if (pipeline) {
      await pipeline.stop();
      this.activePipelines.delete(callId);
    }

    // End session
    const sessionId = this.callToSession.get(callId);
    if (sessionId) {
      const session = await this.sessionManager.endSession(sessionId);
      
      // End call record in database
      const callRecord = await findCallBySessionId(sessionId);
      if (callRecord) {
        const durationSeconds = session?.metrics ? Math.floor(session.metrics.totalDurationMs / 1000) : 0;
        const firstResponseLatency = session?.metrics?.e2eLatencyMs?.[0] || undefined;
        const avgResponseLatency = session?.metrics?.e2eLatencyMs?.length 
          ? Math.floor(session.metrics.e2eLatencyMs.reduce((a, b) => a + b, 0) / session.metrics.e2eLatencyMs.length)
          : undefined;
        
        await endCallRecord({
          callId: callRecord.id,
          durationSeconds,
          endReason: reason,
          llmPromptTokens: session?.metrics?.llmPromptTokens || 0,
          llmCompletionTokens: session?.metrics?.llmCompletionTokens || 0,
          llmCachedTokens: session?.metrics?.llmCachedTokens || 0,
          ttsCharacters: session?.metrics?.ttsCharacters || 0,
          latencyFirstResponseMs: firstResponseLatency,
          latencyAvgResponseMs: avgResponseLatency,
          interruptionsCount: session?.metrics?.interruptionsCount || 0
        });
        
        this.logger.info('Call record ended for telephony call', {
          callId: callRecord.id,
          sessionId,
          durationSeconds,
          endReason: reason
        });
      }
      
      this.callToSession.delete(callId);
    }

    this.emit('call:ended', callId, reason);
  }

  /**
   * Handle incoming audio from telephony
   */
  private handleAudioReceived(packet: TelephonyAudioPacket): void {
    const pipeline = this.activePipelines.get(packet.callId);
    if (!pipeline) {
      // Buffer early packets until pipeline is ready
      let buffer = this.pendingAudio.get(packet.callId);
      if (!buffer) {
        buffer = [];
        this.pendingAudio.set(packet.callId, buffer);
      }
      // Limit buffer size to prevent memory issues
      if (buffer.length < 100) {
        buffer.push(packet);
      }
      return;
    }

    // Convert telephony audio to pipeline format (16kHz linear16)
    const pipelineAudio = telephonyToPipeline(
      packet.payload,
      packet.encoding,
      packet.sampleRate
    );

    // Send to pipeline
    pipeline.processAudioChunk(pipelineAudio);
  }
  
  /**
   * Flush buffered audio packets to pipeline
   */
  private flushPendingAudio(callId: string): void {
    const buffer = this.pendingAudio.get(callId);
    if (!buffer || buffer.length === 0) return;
    
    const pipeline = this.activePipelines.get(callId);
    if (!pipeline) return;
    
    this.logger.info('Flushing buffered audio packets', { 
      callId, 
      packetCount: buffer.length 
    });
    
    for (const packet of buffer) {
      const pipelineAudio = telephonyToPipeline(
        packet.payload,
        packet.encoding,
        packet.sampleRate
      );
      pipeline.processAudioChunk(pipelineAudio);
    }
    
    this.pendingAudio.delete(callId);
  }

  /**
   * Get adapter by provider name
   */
  getAdapter(provider: string): BaseTelephonyAdapter | undefined {
    return this.adapters.get(provider);
  }

  /**
   * Make an outbound call
   */
  async makeCall(provider: string, to: string, from?: string): Promise<string> {
    const adapter = this.adapters.get(provider);
    if (!adapter) {
      throw new Error(`Telephony provider not configured: ${provider}`);
    }

    const fromNumber = from || (this.config.adapters.find(
      a => a.provider === provider
    )?.defaultFromNumber);

    if (!fromNumber) {
      throw new Error('No from number specified');
    }

    return adapter.makeCall(to, fromNumber);
  }

  /**
   * End a call
   */
  async endCall(callId: string): Promise<void> {
    // Find the adapter for this call
    for (const adapter of this.adapters.values()) {
      const session = adapter.getSession(callId);
      if (session) {
        await adapter.endCall(callId);
        return;
      }
    }
    throw new Error(`Call not found: ${callId}`);
  }

  /**
   * Clean up all resources
   */
  async shutdown(): Promise<void> {
    // Stop all pipelines
    for (const pipeline of this.activePipelines.values()) {
      await pipeline.stop();
    }
    this.activePipelines.clear();

    // Shutdown all adapters
    for (const adapter of this.adapters.values()) {
      await adapter.shutdown();
    }
    this.adapters.clear();

    this.callToSession.clear();
    this.logger.info('Telephony manager shutdown complete');
  }
}
