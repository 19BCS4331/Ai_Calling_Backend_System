/**
 * Session Manager
 * Manages call sessions with Redis-backed state for horizontal scaling
 */

import { v4 as uuidv4 } from 'uuid';
import Redis from 'ioredis';
import {
  CallSession,
  CallStatus,
  CallMetrics,
  STTConfig,
  LLMConfig,
  TTSConfig,
  ChatMessage,
  Logger
} from '../types';

export interface SessionManagerConfig {
  redis: {
    host: string;
    port: number;
    password?: string;
    db?: number;
    keyPrefix?: string;
  };
  sessionTTL: number;  // Session expiry in seconds
  cleanupInterval: number;  // Cleanup interval in ms
}

export interface CreateSessionOptions {
  tenantId: string;
  callerId: string;
  callerNumber?: string;
  sttConfig: STTConfig;
  llmConfig: LLMConfig;
  ttsConfig: TTSConfig;
  systemPrompt?: string;
  context?: Record<string, unknown>;
}

export class SessionManager {
  private redis: Redis;
  private logger: Logger;
  private config: SessionManagerConfig;
  private keyPrefix: string;
  private cleanupTimer: NodeJS.Timeout | null = null;
  private localSessions: Map<string, CallSession> = new Map();

  constructor(config: SessionManagerConfig, logger: Logger) {
    this.config = config;
    this.logger = logger.child({ component: 'session-manager' });
    this.keyPrefix = config.redis.keyPrefix || 'voice-agent:session:';

    this.redis = new Redis({
      host: config.redis.host,
      port: config.redis.port,
      password: config.redis.password,
      db: config.redis.db || 0,
      retryStrategy: (times) => Math.min(times * 50, 2000)
    });

    this.redis.on('error', (err) => {
      this.logger.error('Redis connection error', { error: err.message });
    });

    this.redis.on('connect', () => {
      this.logger.info('Redis connected');
    });
  }

  /**
   * Create a new call session
   */
  async createSession(options: CreateSessionOptions): Promise<CallSession> {
    const sessionId = uuidv4();
    const now = new Date();

    const session: CallSession = {
      sessionId,
      tenantId: options.tenantId,
      callerId: options.callerId,
      callerNumber: options.callerNumber,
      startTime: now,
      status: 'initializing',
      
      sttConfig: options.sttConfig,
      llmConfig: options.llmConfig,
      ttsConfig: options.ttsConfig,
      
      messages: options.systemPrompt ? [{
        role: 'system',
        content: options.systemPrompt
      }] : [],
      
      context: options.context || {},
      
      metrics: this.createEmptyMetrics()
    };

    await this.saveSession(session);
    this.localSessions.set(sessionId, session);

    this.logger.info('Session created', { 
      sessionId, 
      tenantId: options.tenantId,
      callerId: options.callerId 
    });

    return session;
  }

  /**
   * Get a session by ID
   */
  async getSession(sessionId: string): Promise<CallSession | null> {
    // Check local cache first
    if (this.localSessions.has(sessionId)) {
      return this.localSessions.get(sessionId)!;
    }

    // Fetch from Redis
    const key = this.keyPrefix + sessionId;
    const data = await this.redis.get(key);
    
    if (!data) {
      return null;
    }

    const session = this.deserializeSession(data);
    this.localSessions.set(sessionId, session);
    
    return session;
  }

  /**
   * Update a session
   */
  async updateSession(session: CallSession): Promise<void> {
    await this.saveSession(session);
    this.localSessions.set(session.sessionId, session);
  }

  /**
   * Update session status
   */
  async updateStatus(sessionId: string, status: CallStatus): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    session.status = status;
    
    if (status === 'ended' || status === 'error') {
      session.endTime = new Date();
      session.metrics.totalDurationMs = 
        session.endTime.getTime() - session.startTime.getTime();
    }

    await this.saveSession(session);
    this.logger.info('Session status updated', { sessionId, status });
  }

  /**
   * Add a message to conversation history
   */
  async addMessage(sessionId: string, message: ChatMessage): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    session.messages.push(message);
    await this.saveSession(session);
  }

  /**
   * Update session context
   */
  async updateContext(
    sessionId: string, 
    context: Record<string, unknown>
  ): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    session.context = { ...session.context, ...context };
    await this.saveSession(session);
  }

  /**
   * End a session
   */
  async endSession(sessionId: string): Promise<CallSession | null> {
    const session = await this.getSession(sessionId);
    if (!session) {
      return null;
    }

    session.status = 'ended';
    session.endTime = new Date();
    session.metrics.totalDurationMs = 
      session.endTime.getTime() - session.startTime.getTime();

    await this.saveSession(session);
    this.localSessions.delete(sessionId);

    this.logger.info('Session ended', { 
      sessionId, 
      duration: session.metrics.totalDurationMs,
      turnCount: session.metrics.turnCount 
    });

    return session;
  }

  /**
   * Delete a session
   */
  async deleteSession(sessionId: string): Promise<void> {
    const key = this.keyPrefix + sessionId;
    await this.redis.del(key);
    this.localSessions.delete(sessionId);
    this.logger.debug('Session deleted', { sessionId });
  }

  /**
   * Get all active sessions for a tenant
   */
  async getActiveSessions(tenantId: string): Promise<CallSession[]> {
    const pattern = `${this.keyPrefix}*`;
    const keys = await this.redis.keys(pattern);
    
    const sessions: CallSession[] = [];
    
    for (const key of keys) {
      const data = await this.redis.get(key);
      if (data) {
        const session = this.deserializeSession(data);
        if (session.tenantId === tenantId && 
            session.status !== 'ended' && 
            session.status !== 'error') {
          sessions.push(session);
        }
      }
    }

    return sessions;
  }

  /**
   * Get session count for a tenant
   */
  async getSessionCount(tenantId: string): Promise<number> {
    const sessions = await this.getActiveSessions(tenantId);
    return sessions.length;
  }

  /**
   * Update session metrics
   */
  async updateMetrics(sessionId: string, updates: Partial<CallMetrics>): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    session.metrics = { ...session.metrics, ...updates };
    await this.saveSession(session);
  }

  /**
   * Start cleanup timer
   */
  startCleanup(): void {
    if (this.cleanupTimer) {
      return;
    }

    this.cleanupTimer = setInterval(
      () => this.cleanupStaleSessions(),
      this.config.cleanupInterval
    );

    this.logger.info('Session cleanup started', { 
      interval: this.config.cleanupInterval 
    });
  }

  /**
   * Stop cleanup timer
   */
  stopCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /**
   * Cleanup stale sessions
   */
  private async cleanupStaleSessions(): Promise<void> {
    const pattern = `${this.keyPrefix}*`;
    const keys = await this.redis.keys(pattern);
    const now = Date.now();
    let cleanedCount = 0;

    for (const key of keys) {
      const data = await this.redis.get(key);
      if (data) {
        const session = this.deserializeSession(data);
        const sessionAge = now - session.startTime.getTime();
        
        // Clean up sessions older than TTL
        if (sessionAge > this.config.sessionTTL * 1000) {
          await this.redis.del(key);
          this.localSessions.delete(session.sessionId);
          cleanedCount++;
        }
      }
    }

    if (cleanedCount > 0) {
      this.logger.info('Cleaned up stale sessions', { count: cleanedCount });
    }
  }

  /**
   * Save session to Redis
   */
  private async saveSession(session: CallSession): Promise<void> {
    const key = this.keyPrefix + session.sessionId;
    const data = this.serializeSession(session);
    await this.redis.setex(key, this.config.sessionTTL, data);
  }

  /**
   * Serialize session for storage
   */
  private serializeSession(session: CallSession): string {
    return JSON.stringify({
      ...session,
      startTime: session.startTime.toISOString(),
      endTime: session.endTime?.toISOString()
    });
  }

  /**
   * Deserialize session from storage
   */
  private deserializeSession(data: string): CallSession {
    const parsed = JSON.parse(data);
    return {
      ...parsed,
      startTime: new Date(parsed.startTime),
      endTime: parsed.endTime ? new Date(parsed.endTime) : undefined
    };
  }

  /**
   * Create empty metrics object
   */
  private createEmptyMetrics(): CallMetrics {
    return {
      totalDurationMs: 0,
      sttLatencyMs: [],
      llmLatencyMs: [],
      ttsLatencyMs: [],
      e2eLatencyMs: [],
      tokenCount: 0,
      turnCount: 0,
      toolCallCount: 0,
      errorCount: 0,
      estimatedCost: 0
    };
  }

  /**
   * Shutdown the session manager
   */
  async shutdown(): Promise<void> {
    this.stopCleanup();
    await this.redis.quit();
    this.logger.info('Session manager shutdown');
  }
}

export default SessionManager;
