/**
 * Base Telephony Adapter
 * Abstract class that all telephony providers must implement
 */

import { EventEmitter } from 'events';
import { Logger } from '../../types';
import { 
  TelephonyConfig, 
  IncomingCall, 
  TelephonyAudioPacket,
  TelephonySession 
} from '../types';

export abstract class BaseTelephonyAdapter extends EventEmitter {
  protected logger: Logger;
  protected sessions: Map<string, TelephonySession> = new Map();

  constructor(logger: Logger) {
    super();
    this.logger = logger;
  }

  /**
   * Get adapter name
   */
  abstract getName(): string;

  /**
   * Initialize the adapter with configuration
   */
  abstract init(config: TelephonyConfig): Promise<void>;

  /**
   * Make an outbound call
   */
  abstract makeCall(to: string, from: string): Promise<string>;

  /**
   * End an active call
   */
  abstract endCall(callId: string): Promise<void>;

  /**
   * Send audio to a call
   * @param callId - Call identifier
   * @param audioData - Raw PCM audio buffer
   * @param sampleRate - Sample rate of the audio
   */
  abstract sendAudio(callId: string, audioData: Buffer, sampleRate: number): void;

  /**
   * Clear any buffered audio (for barge-in)
   */
  abstract clearAudio(callId: string): void;

  /**
   * Get XML/webhook response for answering incoming calls
   * Returns provider-specific XML for call handling
   */
  abstract getAnswerXml(callId: string, streamUrl: string): string;

  /**
   * Handle incoming webhook from provider
   */
  abstract handleWebhook(path: string, method: string, body: any, query: any): any;

  /**
   * Get active session for a call
   */
  getSession(callId: string): TelephonySession | undefined {
    return this.sessions.get(callId);
  }

  /**
   * Get all active sessions
   */
  getAllSessions(): TelephonySession[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Clean up resources
   */
  async shutdown(): Promise<void> {
    // End all active calls
    for (const session of this.sessions.values()) {
      try {
        await this.endCall(session.callId);
      } catch (error) {
        this.logger.error('Error ending call during shutdown', { 
          callId: session.callId, 
          error: (error as Error).message 
        });
      }
    }
    this.sessions.clear();
    this.removeAllListeners();
  }

  /**
   * Register a new session
   */
  protected registerSession(session: TelephonySession): void {
    this.sessions.set(session.callId, session);
    this.logger.info('Telephony session registered', { 
      callId: session.callId,
      streamId: session.streamId 
    });
  }

  /**
   * Remove a session
   */
  protected removeSession(callId: string): void {
    this.sessions.delete(callId);
    this.logger.info('Telephony session removed', { callId });
  }

  /**
   * Emit call started event
   */
  protected emitCallStarted(call: IncomingCall): void {
    this.emit('call:started', call);
  }

  /**
   * Emit call ended event
   */
  protected emitCallEnded(callId: string, reason: string): void {
    this.emit('call:ended', callId, reason);
  }

  /**
   * Emit audio received event
   */
  protected emitAudioPacket(packet: TelephonyAudioPacket): void {
    this.emit('audio:received', packet);
  }

  /**
   * Emit DTMF event
   */
  protected emitDTMF(callId: string, digit: string): void {
    this.emit('dtmf', callId, digit);
  }

  /**
   * Emit error event
   */
  protected emitError(callId: string, error: Error): void {
    this.emit('error', callId, error);
  }
}
