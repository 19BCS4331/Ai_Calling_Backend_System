/**
 * Plivo Telephony Adapter
 * Implements Plivo-specific audio streaming integration
 */

import { WebSocket } from 'ws';
import { Logger } from '../../types';
import { BaseTelephonyAdapter } from './base-adapter';
import {
  TelephonyConfig,
  IncomingCall,
  TelephonyAudioPacket,
  TelephonySession,
  PlivoStreamMessage,
  PlivoStartMessage,
  PlivoMediaMessage,
  PlivoStopMessage,
  PlivoDTMFMessage,
  AudioFormat
} from '../types';
import { pipelineToTelephony } from '../audio-converter';

interface PlivoConfig extends TelephonyConfig {
  provider: 'plivo';
}

export class PlivoAdapter extends BaseTelephonyAdapter {
  private config!: PlivoConfig;
  private activeStreams: Map<string, WebSocket> = new Map();  // streamId -> WebSocket
  private callToStream: Map<string, string> = new Map();       // callId -> streamId

  constructor(logger: Logger) {
    super(logger.child({ adapter: 'plivo' }));
  }

  getName(): string {
    return 'plivo';
  }

  async init(config: TelephonyConfig): Promise<void> {
    if (config.provider !== 'plivo') {
      throw new Error('Invalid provider for PlivoAdapter');
    }
    this.config = config as PlivoConfig;
    this.logger.info('Plivo adapter initialized', {
      webhookBaseUrl: config.webhookBaseUrl
    });
  }

  /**
   * Make an outbound call using Plivo API
   */
  async makeCall(to: string, from: string): Promise<string> {
    const { authId, authToken } = this.config.credentials;
    const answerUrl = `${this.config.webhookBaseUrl}/telephony/plivo/answer`;
    
    const response = await fetch(
      `https://api.plivo.com/v1/Account/${authId}/Call/`,
      {
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + Buffer.from(`${authId}:${authToken}`).toString('base64'),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: from || this.config.defaultFromNumber,
          to,
          answer_url: answerUrl,
          answer_method: 'POST'
        })
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Plivo API error: ${error}`);
    }

    const data = await response.json() as { request_uuid: string };
    return data.request_uuid;
  }

  /**
   * End a call using Plivo API
   */
  async endCall(callId: string): Promise<void> {
    const { authId, authToken } = this.config.credentials;
    
    // Get the actual Plivo call UUID (remove our prefix if present)
    const plivoCallId = callId.replace('plivo_', '');
    
    try {
      const response = await fetch(
        `https://api.plivo.com/v1/Account/${authId}/Call/${plivoCallId}/`,
        {
          method: 'DELETE',
          headers: {
            'Authorization': 'Basic ' + Buffer.from(`${authId}:${authToken}`).toString('base64')
          }
        }
      );
      if (!response.ok) {
        this.logger.warn('Plivo end call response not OK', { status: response.status });
      }
    } catch (error) {
      this.logger.error('Error ending Plivo call', { callId, error: (error as Error).message });
    }

    // Clean up local state
    const streamId = this.callToStream.get(callId);
    if (streamId) {
      const ws = this.activeStreams.get(streamId);
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
      this.activeStreams.delete(streamId);
      this.callToStream.delete(callId);
    }
    this.removeSession(callId);
  }

  /**
   * Send audio to a call
   * Converts from pipeline format to Plivo format
   */
  sendAudio(callId: string, audioData: Buffer, sampleRate: number): void {
    const streamId = this.callToStream.get(callId);
    if (!streamId) {
      this.logger.warn('No active stream for call', { callId });
      return;
    }

    const ws = this.activeStreams.get(streamId);
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      this.logger.warn('WebSocket not open for stream', { streamId });
      return;
    }

    // Convert to telephony format (8kHz linear16)
    const telephonyAudio = pipelineToTelephony(audioData, sampleRate, 'linear16');
    
    // Send as Plivo playAudio event
    const message = {
      event: 'playAudio',
      media: {
        contentType: 'audio/x-l16',
        sampleRate: 8000,
        payload: telephonyAudio.toString('base64')
      }
    };

    ws.send(JSON.stringify(message));
  }

  /**
   * Clear buffered audio (for barge-in)
   */
  clearAudio(callId: string): void {
    const streamId = this.callToStream.get(callId);
    if (!streamId) return;

    const ws = this.activeStreams.get(streamId);
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    ws.send(JSON.stringify({ event: 'clearAudio' }));
    this.logger.debug('Sent clearAudio for barge-in', { callId });
  }

  /**
   * Generate XML response for answering calls
   * This starts the bidirectional audio stream
   */
  getAnswerXml(callId: string, streamUrl: string): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Stream 
    bidirectional="true" 
    keepCallAlive="true"
    contentType="audio/x-l16;rate=8000"
    streamTimeout="3600">
    ${streamUrl}
  </Stream>
</Response>`;
  }

  /**
   * Handle incoming Plivo webhooks
   */
  handleWebhook(path: string, method: string, body: any, query: any): any {
    this.logger.debug('Plivo webhook received', { path, method, body });

    if (path === '/answer' || path === '/telephony/plivo/answer') {
      // Generate XML to start audio stream
      const callId = body.CallUUID || query.CallUUID;
      const streamUrl = `${this.config.webhookBaseUrl.replace('https://', 'wss://')}/telephony/plivo/stream`;
      
      this.logger.info('Answering call with stream', { callId, streamUrl });
      return this.getAnswerXml(callId, streamUrl);
    }

    if (path === '/status' || path === '/telephony/plivo/status') {
      // Handle status callbacks
      this.logger.info('Plivo status callback', { status: body.Status, callId: body.CallUUID });
      return { success: true };
    }

    return { error: 'Unknown webhook path' };
  }

  /**
   * Handle new WebSocket connection from Plivo audio stream
   */
  handleStreamConnection(ws: WebSocket, callId?: string): void {
    this.logger.info('Plivo stream WebSocket connected', { callId });

    ws.on('message', (data: Buffer | string) => {
      try {
        // Plivo sends JSON messages as strings
        const message = typeof data === 'string' 
          ? JSON.parse(data) 
          : JSON.parse(data.toString());
        
        this.handleStreamMessage(ws, message);
      } catch (error) {
        this.logger.error('Error parsing Plivo stream message', { 
          error: (error as Error).message 
        });
      }
    });

    ws.on('close', (code, reason) => {
      this.logger.info('Plivo stream WebSocket closed', { code, reason: reason.toString() });
      this.handleStreamClose(ws);
    });

    ws.on('error', (error) => {
      this.logger.error('Plivo stream WebSocket error', { error: error.message });
    });
  }

  /**
   * Handle Plivo stream messages
   */
  private handleStreamMessage(ws: WebSocket, message: PlivoStreamMessage): void {
    switch (message.event) {
      case 'start':
        this.handleStreamStart(ws, message as PlivoStartMessage);
        break;

      case 'media':
        this.handleStreamMedia(message as PlivoMediaMessage);
        break;

      case 'stop':
        this.handleStreamStop(message as PlivoStopMessage);
        break;

      case 'dtmf':
        this.handleStreamDTMF(message as PlivoDTMFMessage);
        break;

      default:
        this.logger.warn('Unknown Plivo stream event', { event: (message as any).event });
    }
  }

  /**
   * Handle stream start event
   */
  private handleStreamStart(ws: WebSocket, message: PlivoStartMessage): void {
    const { streamId, callId, from, to, direction } = message.start;
    
    // Use prefixed callId to avoid collisions
    const internalCallId = `plivo_${callId}`;
    
    this.logger.info('Plivo stream started', { streamId, callId: internalCallId, from, to });

    // Store stream mapping
    this.activeStreams.set(streamId, ws);
    this.callToStream.set(internalCallId, streamId);

    // Create call metadata
    const call: IncomingCall = {
      callId: internalCallId,
      streamId,
      from,
      to,
      direction: (direction as 'inbound' | 'outbound') || 'inbound',
      startTime: new Date(),
      provider: 'plivo'
    };

    // Create session
    const session: TelephonySession = {
      callId: internalCallId,
      streamId,
      call,
      isActive: true,
      startTime: new Date(),
      audioFormat: {
        encoding: 'linear16',
        sampleRate: 8000,
        channels: 1
      }
    };

    this.registerSession(session);
    this.emitCallStarted(call);
  }

  /**
   * Handle media event - audio data from caller
   */
  private handleStreamMedia(message: PlivoMediaMessage): void {
    const { streamId, sequenceNumber, media } = message;
    
    // Find the callId for this stream
    let callId: string | undefined;
    for (const [cId, sId] of this.callToStream.entries()) {
      if (sId === streamId) {
        callId = cId;
        break;
      }
    }

    if (!callId) {
      this.logger.warn('Received media for unknown stream', { streamId });
      return;
    }

    // Decode base64 audio payload
    const audioData = Buffer.from(media.payload, 'base64');
    
    // Determine encoding from contentType (default to linear16)
    const contentType = media.contentType || 'audio/x-l16;rate=8000';
    const encoding: 'linear16' | 'mulaw' = contentType.includes('mulaw') ? 'mulaw' : 'linear16';
    const sampleRate = contentType.includes('16000') ? 16000 : 8000;

    // Create audio packet
    const packet: TelephonyAudioPacket = {
      callId,
      streamId,
      sequenceNumber: parseInt(sequenceNumber.toString()),
      timestamp: parseInt(media.timestamp),
      payload: audioData,
      encoding,
      sampleRate
    };

    this.emitAudioPacket(packet);
  }

  /**
   * Handle stream stop event
   */
  private handleStreamStop(message: PlivoStopMessage): void {
    const { streamId } = message;
    
    // Find the callId for this stream
    let callId: string | undefined;
    for (const [cId, sId] of this.callToStream.entries()) {
      if (sId === streamId) {
        callId = cId;
        break;
      }
    }

    if (callId) {
      this.logger.info('Plivo stream stopped', { streamId, callId });
      this.emitCallEnded(callId, 'stream_stopped');
      this.removeSession(callId);
      this.callToStream.delete(callId);
    }

    this.activeStreams.delete(streamId);
  }

  /**
   * Handle DTMF event
   */
  private handleStreamDTMF(message: PlivoDTMFMessage): void {
    const { streamId, dtmf } = message;
    
    // Find the callId for this stream
    let callId: string | undefined;
    for (const [cId, sId] of this.callToStream.entries()) {
      if (sId === streamId) {
        callId = cId;
        break;
      }
    }

    if (callId) {
      this.logger.info('DTMF received', { callId, digit: dtmf.digit });
      this.emitDTMF(callId, dtmf.digit);
    }
  }

  /**
   * Handle WebSocket close
   */
  private handleStreamClose(ws: WebSocket): void {
    // Find and clean up any streams associated with this WebSocket
    for (const [streamId, streamWs] of this.activeStreams.entries()) {
      if (streamWs === ws) {
        this.activeStreams.delete(streamId);
        
        // Find and clean up the callId
        for (const [callId, sId] of this.callToStream.entries()) {
          if (sId === streamId) {
            this.emitCallEnded(callId, 'websocket_closed');
            this.removeSession(callId);
            this.callToStream.delete(callId);
            break;
          }
        }
        break;
      }
    }
  }
}
