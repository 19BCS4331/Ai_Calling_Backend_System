/**
 * TATA Teleservices Telephony Adapter
 * Implements TATA's bidirectional audio streaming WebSocket protocol
 */

import { WebSocket } from 'ws';
import { Logger } from '../../types';
import { BaseTelephonyAdapter } from './base-adapter';
import {
  TelephonyConfig,
  IncomingCall,
  TelephonyAudioPacket,
  TelephonySession,
  TataOutgoingMessage,
  TataIncomingMessage,
  TataIncomingConnectedMessage,
  TataIncomingStartMessage,
  TataIncomingMediaMessage,
  TataIncomingStopMessage,
  TataIncomingDTMFMessage,
  TataIncomingMarkMessage
} from '../types';
import { pipelineToTelephony, mulawToLinear } from '../audio-converter';

interface TataConfig extends TelephonyConfig {
  provider: 'tata';
}

/**
 * TATA Adapter
 * Listens on WebSocket URL for incoming connections from TATA
 * Implements TATA's specific protocol for bidirectional streaming
 */
export class TataAdapter extends BaseTelephonyAdapter {
  private config!: TataConfig;
  private activeStreams: Map<string, WebSocket> = new Map();  // streamSid -> WebSocket
  private callToStream: Map<string, string> = new Map();      // callId -> streamSid
  private audioBuffers: Map<string, Buffer> = new Map();      // callId -> audio buffer
  private sequenceNumbers: Map<string, number> = new Map();   // streamSid -> sequence number
  private chunkCounters: Map<string, number> = new Map();     // streamSid -> chunk counter
  private pendingMarks: Map<string, string[]> = new Map();    // streamSid -> mark names
  
  // TATA requires mulaw payloads to be multiples of 160 bytes
  private readonly MULAW_CHUNK_SIZE = 160;
  
  // Media packets sent every 100ms
  private readonly MEDIA_INTERVAL_MS = 100;

  constructor(logger: Logger) {
    super(logger.child({ adapter: 'tata' }));
  }

  getName(): string {
    return 'tata';
  }

  async init(config: TelephonyConfig): Promise<void> {
    if (config.provider !== 'tata') {
      throw new Error('Invalid provider for TataAdapter');
    }
    this.config = config as TataConfig;
    this.logger.info('TATA adapter initialized', {
      webhookBaseUrl: config.webhookBaseUrl
    });
  }

  /**
   * Make an outbound call
   * For TATA, this would require their API integration
   * Currently placeholder - implement based on TATA's API documentation
   */
  async makeCall(to: string, from: string): Promise<string> {
    throw new Error('TATA outbound calling not yet implemented');
  }

  /**
   * End a call
   */
  async endCall(callId: string): Promise<void> {
    const streamSid = this.callToStream.get(callId);
    if (!streamSid) {
      this.logger.warn('No active stream for call', { callId });
      return;
    }

    const ws = this.activeStreams.get(streamSid);
    if (ws && ws.readyState === WebSocket.OPEN) {
      // Just close the WebSocket - TATA will send stop message to us
      ws.close();
    }

    // Clean up
    this.activeStreams.delete(streamSid);
    this.callToStream.delete(callId);
    this.audioBuffers.delete(callId);
    this.sequenceNumbers.delete(streamSid);
    this.chunkCounters.delete(streamSid);
    this.pendingMarks.delete(streamSid);
    this.removeSession(callId);
  }

  /**
   * Send audio to a call
   * Converts pipeline audio to mulaw/8000 and ensures 160-byte alignment
   */
  sendAudio(callId: string, audioData: Buffer, sampleRate: number): void {
    const streamSid = this.callToStream.get(callId);
    if (!streamSid) {
      this.logger.warn('No active stream for call', { callId });
      return;
    }

    const ws = this.activeStreams.get(streamSid);
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      this.logger.warn('WebSocket not open for stream', { streamSid });
      return;
    }

    // Convert to mulaw/8000
    const mulawData = pipelineToTelephony(audioData, sampleRate, 'mulaw');
    
    // Get or create buffer for this call
    let buffer = this.audioBuffers.get(callId) || Buffer.alloc(0);
    buffer = Buffer.concat([buffer, mulawData]);
    
    // Send in 160-byte aligned chunks to prevent audio gaps
    while (buffer.length >= this.MULAW_CHUNK_SIZE) {
      const chunk = buffer.subarray(0, this.MULAW_CHUNK_SIZE);
      buffer = buffer.subarray(this.MULAW_CHUNK_SIZE);
      
      this.sendMediaMessage(streamSid, chunk);
    }
    
    // Store remaining buffer
    this.audioBuffers.set(callId, buffer);
  }

  /**
   * Clear buffered audio (for barge-in)
   */
  clearAudio(callId: string): void {
    // Clear local buffer
    this.audioBuffers.delete(callId);
    
    // Note: TATA's clear message is sent FROM vendor TO us
    // We don't send clear messages to TATA
    // Instead, we just stop sending media messages
    this.logger.debug('Cleared audio buffer for barge-in', { callId });
  }

  /**
   * Get answer XML - not used for TATA
   * TATA uses direct WebSocket connection
   */
  getAnswerXml(callId: string, streamUrl: string): string {
    throw new Error('TATA does not use XML answer - uses direct WebSocket connection');
  }

  /**
   * Handle webhooks - TATA may use this for call status
   */
  handleWebhook(path: string, method: string, body: any, query: any): any {
    this.logger.debug('TATA webhook received', { path, method, body });
    
    // Implement based on TATA's webhook documentation
    return { success: true };
  }

  /**
   * Handle new WebSocket connection from TATA
   * TATA initiates the connection to our WebSocket endpoint
   */
  handleStreamConnection(ws: WebSocket): void {
    this.logger.info('TATA stream WebSocket connected');

    // TATA will send us 'connected' and then 'start' - we just listen

    ws.on('message', (data: Buffer | string) => {
      try {
        const message: TataIncomingMessage = typeof data === 'string' 
          ? JSON.parse(data) 
          : JSON.parse(data.toString());
        
        this.handleIncomingMessage(ws, message);
      } catch (error) {
        this.logger.error('Error parsing TATA message', { 
          error: (error as Error).message 
        });
      }
    });

    ws.on('close', (code, reason) => {
      this.logger.info('TATA stream WebSocket closed', { code, reason: reason.toString() });
      this.handleStreamClose(ws);
    });

    ws.on('error', (error) => {
      this.logger.error('TATA stream WebSocket error', { error: error.message });
    });
  }

  /**
   * Handle incoming messages from TATA
   */
  private handleIncomingMessage(ws: WebSocket, message: TataIncomingMessage): void {
    switch (message.event) {
      case 'connected':
        this.handleIncomingConnected(message as TataIncomingConnectedMessage);
        break;

      case 'start':
        this.handleIncomingStart(ws, message as TataIncomingStartMessage);
        break;

      case 'media':
        this.handleIncomingMedia(message as TataIncomingMediaMessage);
        break;

      case 'stop':
        this.handleIncomingStop(message as TataIncomingStopMessage);
        break;

      case 'dtmf':
        this.handleIncomingDTMF(message as TataIncomingDTMFMessage);
        break;

      case 'mark':
        this.handleIncomingMark(message as TataIncomingMarkMessage);
        break;

      default:
        this.logger.warn('Unknown TATA event', { event: (message as any).event });
    }
  }

  /**
   * Handle connected message from TATA
   */
  private handleIncomingConnected(message: TataIncomingConnectedMessage): void {
    this.logger.debug('TATA connected event received');
  }

  /**
   * Handle start message from TATA - this initiates the call
   */
  private handleIncomingStart(ws: WebSocket, message: TataIncomingStartMessage): void {
    const { streamSid, start } = message;
    const { callSid, from, to, direction } = start;

    this.logger.info('TATA call started', { streamSid, callSid, from, to, direction });

    // Store stream mapping
    this.activeStreams.set(streamSid, ws);
    const internalCallId = `tata_${callSid}`;
    this.callToStream.set(internalCallId, streamSid);

    // Initialize counters
    this.sequenceNumbers.set(streamSid, 0);
    this.chunkCounters.set(streamSid, 0);

    // Create call metadata
    const call: IncomingCall = {
      callId: internalCallId,
      streamId: streamSid,
      from,
      to,
      direction,
      startTime: new Date(),
      provider: 'tata'
    };

    // Create session
    const session: TelephonySession = {
      callId: internalCallId,
      streamId: streamSid,
      call,
      isActive: true,
      startTime: new Date(),
      audioFormat: {
        encoding: 'mulaw',
        sampleRate: 8000,
        channels: 1
      }
    };

    this.registerSession(session);
    this.emitCallStarted(call);
  }

  /**
   * Handle stop message from TATA
   */
  private handleIncomingStop(message: TataIncomingStopMessage): void {
    const { streamSid, stop } = message;
    
    // Find callId
    let callId: string | undefined;
    for (const [cId, sId] of this.callToStream.entries()) {
      if (sId === streamSid) {
        callId = cId;
        break;
      }
    }

    if (callId) {
      this.logger.info('TATA call stopped', { streamSid, callId, reason: stop.reason });
      this.emitCallEnded(callId, stop.reason);
      this.removeSession(callId);
      this.callToStream.delete(callId);
      this.audioBuffers.delete(callId);
    }

    this.activeStreams.delete(streamSid);
    this.sequenceNumbers.delete(streamSid);
    this.chunkCounters.delete(streamSid);
    this.pendingMarks.delete(streamSid);
  }

  /**
   * Handle DTMF from TATA
   */
  private handleIncomingDTMF(message: TataIncomingDTMFMessage): void {
    const { streamSid, dtmf } = message;
    
    // Find callId
    let callId: string | undefined;
    for (const [cId, sId] of this.callToStream.entries()) {
      if (sId === streamSid) {
        callId = cId;
        break;
      }
    }

    if (callId) {
      this.logger.info('DTMF received from TATA', { callId, digit: dtmf.digit });
      this.emitDTMF(callId, dtmf.digit);
    }
  }

  /**
   * Handle incoming media (audio from caller)
   */
  private handleIncomingMedia(message: TataIncomingMediaMessage): void {
    const { streamSid, media } = message;
    
    // Find callId for this stream
    let callId: string | undefined;
    for (const [cId, sId] of this.callToStream.entries()) {
      if (sId === streamSid) {
        callId = cId;
        break;
      }
    }

    if (!callId) {
      this.logger.warn('Received media for unknown stream', { streamSid });
      return;
    }

    // Decode base64 mulaw audio
    const mulawData = Buffer.from(media.payload, 'base64');
    
    // Convert mulaw to linear16 for pipeline
    const linear16Data = mulawToLinear(mulawData);

    // Create audio packet
    const packet: TelephonyAudioPacket = {
      callId,
      streamId: streamSid,
      sequenceNumber: parseInt(media.chunk),  // Convert string to number
      timestamp: Date.now(),
      payload: linear16Data,
      encoding: 'linear16',  // Converted to linear16
      sampleRate: 8000
    };

    this.emitAudioPacket(packet);
  }

  /**
   * Handle incoming mark message from TATA
   * TATA sends this when they want us to know something
   */
  private handleIncomingMark(message: TataIncomingMarkMessage): void {
    const { streamSid, mark } = message;
    this.logger.debug('TATA mark received from client', { streamSid, markName: mark.name });
  }

  /**
   * Send media message to TATA
   */
  private sendMediaMessage(streamSid: string, mulawChunk: Buffer): void {
    const ws = this.activeStreams.get(streamSid);
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    const chunkNum = this.getNextChunk(streamSid);

    const mediaMessage: TataOutgoingMessage = {
      event: 'media',
      streamSid,
      media: {
        payload: mulawChunk.toString('base64'),
        chunk: chunkNum
      }
    };

    ws.send(JSON.stringify(mediaMessage));
  }

  /**
   * Send mark message to TATA
   */
  private sendMarkMessage(streamSid: string, markName: string): void {
    const ws = this.activeStreams.get(streamSid);
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    const markMessage: TataOutgoingMessage = {
      event: 'mark',
      streamSid,
      mark: {
        name: markName
      }
    };

    ws.send(JSON.stringify(markMessage));
  }

  /**
   * Get next sequence number for stream
   */
  private getNextSequence(streamSid: string): number {
    const current = this.sequenceNumbers.get(streamSid) || 0;
    const next = current + 1;
    this.sequenceNumbers.set(streamSid, next);
    return next;
  }

  /**
   * Get next chunk number for stream
   */
  private getNextChunk(streamSid: string): number {
    const current = this.chunkCounters.get(streamSid) || 0;
    const next = current + 1;
    this.chunkCounters.set(streamSid, next);
    return next;
  }

  /**
   * Handle WebSocket close
   */
  private handleStreamClose(ws: WebSocket): void {
    // Find and clean up any streams associated with this WebSocket
    for (const [streamSid, streamWs] of this.activeStreams.entries()) {
      if (streamWs === ws) {
        this.activeStreams.delete(streamSid);
        this.sequenceNumbers.delete(streamSid);
        this.chunkCounters.delete(streamSid);
        this.pendingMarks.delete(streamSid);
        
        // Find and clean up the callId
        for (const [callId, sId] of this.callToStream.entries()) {
          if (sId === streamSid) {
            this.emitCallEnded(callId, 'websocket_closed');
            this.removeSession(callId);
            this.callToStream.delete(callId);
            this.audioBuffers.delete(callId);
            break;
          }
        }
        break;
      }
    }
  }

  /**
   * Flush remaining audio buffer for a call
   * Pads to 160-byte boundary if needed
   */
  flushAudio(callId: string): void {
    const buffer = this.audioBuffers.get(callId);
    if (!buffer || buffer.length === 0) return;

    const streamSid = this.callToStream.get(callId);
    if (!streamSid) return;

    // Pad to 160-byte boundary with silence (mulaw 0xFF = silence)
    const paddingNeeded = this.MULAW_CHUNK_SIZE - (buffer.length % this.MULAW_CHUNK_SIZE);
    let finalBuffer = buffer;
    
    if (paddingNeeded > 0 && paddingNeeded < this.MULAW_CHUNK_SIZE) {
      const padding = Buffer.alloc(paddingNeeded, 0xFF);
      finalBuffer = Buffer.concat([buffer, padding]);
    }

    // Send final chunk(s)
    let offset = 0;
    while (offset < finalBuffer.length) {
      const chunk = finalBuffer.subarray(offset, offset + this.MULAW_CHUNK_SIZE);
      this.sendMediaMessage(streamSid, chunk);
      offset += this.MULAW_CHUNK_SIZE;
    }

    this.audioBuffers.delete(callId);
    
    // Send mark to indicate playback complete
    const markName = `complete_${Date.now()}`;
    this.sendMarkMessage(streamSid, markName);
    
    const pending = this.pendingMarks.get(streamSid) || [];
    pending.push(markName);
    this.pendingMarks.set(streamSid, pending);
  }
}
