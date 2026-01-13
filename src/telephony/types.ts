/**
 * Telephony Layer Types
 * Provider-agnostic types for telephony integration
 */

import { Logger } from '../types';

/**
 * Telephony provider configuration
 */
export interface TelephonyConfig {
  provider: 'plivo' | 'twilio';
  credentials: {
    authId: string;
    authToken: string;
  };
  webhookBaseUrl: string;
  defaultFromNumber?: string;
}

/**
 * Incoming call metadata
 */
export interface IncomingCall {
  callId: string;
  streamId: string;
  from: string;
  to: string;
  direction: 'inbound' | 'outbound';
  startTime: Date;
  provider: string;
}

/**
 * Audio packet from telephony provider
 */
export interface TelephonyAudioPacket {
  callId: string;
  streamId: string;
  sequenceNumber: number;
  timestamp: number;
  payload: Buffer;
  encoding: 'linear16' | 'mulaw';
  sampleRate: number;
}

/**
 * Events emitted by telephony adapters
 */
export interface TelephonyEvents {
  onCallStarted: (call: IncomingCall) => void;
  onCallEnded: (callId: string, reason: string) => void;
  onAudioReceived: (packet: TelephonyAudioPacket) => void;
  onDTMF: (callId: string, digit: string) => void;
  onError: (callId: string, error: Error) => void;
}

/**
 * Audio format configuration
 */
export interface AudioFormat {
  encoding: 'linear16' | 'mulaw';
  sampleRate: number;
  channels: number;
}

/**
 * Telephony session state
 */
export interface TelephonySession {
  callId: string;
  streamId: string;
  call: IncomingCall;
  isActive: boolean;
  startTime: Date;
  audioFormat: AudioFormat;
}

/**
 * Plivo-specific message types (from Plivo WebSocket)
 */
export interface PlivoStartMessage {
  event: 'start';
  sequenceNumber: number;
  start: {
    streamId: string;
    callId: string;
    from: string;
    to: string;
    direction?: string;
  };
}

export interface PlivoMediaMessage {
  event: 'media';
  sequenceNumber: number;
  streamId: string;
  media: {
    track: 'inbound' | 'outbound';
    chunk: string;
    timestamp: string;
    payload: string;  // base64 encoded
    contentType?: string;
  };
}

export interface PlivoStopMessage {
  event: 'stop';
  sequenceNumber: number;
  streamId: string;
}

export interface PlivoDTMFMessage {
  event: 'dtmf';
  streamId: string;
  dtmf: {
    digit: string;
    duration: number;
  };
}

export type PlivoStreamMessage = 
  | PlivoStartMessage 
  | PlivoMediaMessage 
  | PlivoStopMessage 
  | PlivoDTMFMessage;

/**
 * Plivo playAudio message (to Plivo WebSocket)
 */
export interface PlivoPlayAudioMessage {
  event: 'playAudio';
  media: {
    contentType: string;
    sampleRate: number;
    payload: string;  // base64 encoded
  };
}

/**
 * Plivo clearAudio message (for barge-in)
 */
export interface PlivoClearAudioMessage {
  event: 'clearAudio';
}
