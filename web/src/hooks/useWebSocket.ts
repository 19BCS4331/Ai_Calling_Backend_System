import { useCallback, useRef, useEffect } from 'react';
import { useVoiceStore } from '../store/voice';

const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:3000';

interface MCPWorkflow {
  name: string;
  url: string;
  apiKey?: string;
}

interface SessionConfig {
  agentId?: string;  // Agent ID to retrieve tools and configuration
  language?: string;
  systemPrompt: string;
  stt: { provider: string; apiKey: string; language?: string };
  llm: { provider: string; apiKey: string; model: string; temperature?: number };
  tts: { provider: string; apiKey: string; voiceId: string; language?: string };
  mcpWorkflows?: MCPWorkflow[];  // Array of MCP workflows to connect for this session
  firstMessage?: string | null;  // Agent's first message
  endCallPhrases?: string[];  // Phrases that trigger call end
  interruptionSensitivity?: number;  // Interruption sensitivity
  silenceTimeoutMs?: number;  // Silence timeout
  maxCallDurationSeconds?: number;  // Max call duration
  context?: Record<string, any>;  // Additional context
}

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const recordingContextRef = useRef<AudioContext | null>(null);  // Track recording AudioContext
  const bargedInRef = useRef<boolean>(false);  // Drop audio after barge-in until next turn
  const isAIPlayingRef = useRef<boolean>(false);  // Track AI playback for client-side barge-in
  const consecutiveLoudRef = useRef<number>(0);  // Consecutive loud audio chunks for VAD
  
  const {
    setConnectionStatus,
    setSessionStatus,
    setSessionId,
    setUserTranscript,
    appendAIResponse,
    setAIResponse,
    setIsAIPlaying,
    setError,
    setMetrics,
    reset,
  } = useVoiceStore();

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    
    setConnectionStatus('connecting');
    wsRef.current = new WebSocket(WS_URL);

    wsRef.current.onopen = () => {
      setConnectionStatus('connected');
      setError(null);
    };

    wsRef.current.onclose = () => {
      setConnectionStatus('disconnected');
      setSessionStatus('idle');
      setSessionId(null);
    };

    wsRef.current.onerror = () => {
      setConnectionStatus('error');
      setError('WebSocket connection failed');
    };

    wsRef.current.onmessage = async (event) => {
      if (event.data instanceof Blob) {
        await handleAudioData(event.data);
        return;
      }

      try {
        const msg = JSON.parse(event.data);
        handleMessage(msg);
      } catch (e) {
        console.error('Failed to parse message:', e);
      }
    };
  }, []);

  const disconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    reset();
  }, [reset]);

  const cleanupAudioPlayback = useCallback(() => {
    if (workletNodeRef.current) {
      workletNodeRef.current.disconnect();
      workletNodeRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
  }, []);

  const handleMessage = useCallback((msg: Record<string, unknown>) => {
    switch (msg.type) {
      case 'connected':
        console.log('Connected:', msg.connectionId);
        break;

      case 'session_started':
        setSessionStatus('active');
        setSessionId(msg.sessionId as string);
        initAudioPlayback(msg.audioFormat as { sampleRate: number });
        break;

      case 'session_ended':
        setSessionStatus('idle');
        setSessionId(null);
        setMetrics(msg.metrics as { firstLLMTokenMs: number; firstTTSByteMs: number; turnDurationMs: number });
        // Clean up audio playback resources
        cleanupAudioPlayback();
        break;

      case 'stt_partial':
        setUserTranscript(msg.text as string);
        break;

      case 'stt_final':
        setUserTranscript(msg.text as string);
        break;

      case 'llm_token':
        bargedInRef.current = false;  // New turn started, accept audio again
        appendAIResponse(msg.token as string);
        break;

      case 'turn_complete':
        setMetrics(msg.metrics as { firstLLMTokenMs: number; firstTTSByteMs: number; turnDurationMs: number });
        break;

      case 'barge_in':
        // Immediately stop audio output: set flag first, clear worklet buffer, then
        // suspend the AudioContext for instant hardware-level silence.
        // Chunks still in-flight (async decode) are dropped by the flag check in handleAudioData.
        bargedInRef.current = true;
        consecutiveLoudRef.current = 0;
        if (workletNodeRef.current) {
          workletNodeRef.current.port.postMessage({ type: 'clear' });
        }
        if (audioContextRef.current && audioContextRef.current.state === 'running') {
          audioContextRef.current.suspend().then(() => {
            // Resume after a short gap so the context is ready for the next TTS turn
            setTimeout(() => {
              if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
                audioContextRef.current.resume();
              }
            }, 80);
          });
        }
        isAIPlayingRef.current = false;
        setIsAIPlaying(false);
        setAIResponse('');  // Clear AI response for new turn
        break;

      case 'error':
        setError(msg.error as string);
        break;
    }
  }, [setSessionStatus, setSessionId, setUserTranscript, appendAIResponse, setError, setMetrics, setIsAIPlaying, setAIResponse, cleanupAudioPlayback]);

  const initAudioPlayback = async (audioFormat: { sampleRate: number }) => {
    const sampleRate = audioFormat?.sampleRate || 44100;
    
    audioContextRef.current = new AudioContext({ sampleRate });
    
    const workletCode = `
      class PCMProcessor extends AudioWorkletProcessor {
        constructor() {
          super();
          this.buffer = new Float32Array(661500);
          this.writeIdx = 0;
          this.readIdx = 0;
          this.available = 0;
          
          this.port.onmessage = (e) => {
            if (e.data.type === 'samples') {
              const samples = e.data.samples;
              for (let i = 0; i < samples.length; i++) {
                this.buffer[this.writeIdx] = samples[i];
                this.writeIdx = (this.writeIdx + 1) % 661500;
                if (this.available < 661500) this.available++;
              }
            } else if (e.data.type === 'clear') {
              this.writeIdx = 0;
              this.readIdx = 0;
              this.available = 0;
            }
          };
        }
        
        process(inputs, outputs) {
          const output = outputs[0][0];
          for (let i = 0; i < output.length; i++) {
            if (this.available > 0) {
              output[i] = this.buffer[this.readIdx];
              this.readIdx = (this.readIdx + 1) % 661500;
              this.available--;
            } else {
              output[i] = 0;
            }
          }
          return true;
        }
      }
      registerProcessor('pcm-processor', PCMProcessor);
    `;
    
    const blob = new Blob([workletCode], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    
    await audioContextRef.current.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
    
    workletNodeRef.current = new AudioWorkletNode(audioContextRef.current, 'pcm-processor');
    workletNodeRef.current.connect(audioContextRef.current.destination);
  };

  const handleAudioData = async (blob: Blob) => {
    if (!workletNodeRef.current || !audioContextRef.current) return;
    
    // Drop audio that arrives after barge-in (stale TTS chunks still in flight)
    if (bargedInRef.current) return;
    
    isAIPlayingRef.current = true;
    setIsAIPlaying(true);
    
    const arrayBuffer = await blob.arrayBuffer();
    
    // Re-check after async decode — barge-in may have arrived while we were awaiting
    if (bargedInRef.current) return;
    
    const header = new Uint8Array(arrayBuffer.slice(0, 4));
    const isWav = header[0] === 0x52 && header[1] === 0x49;
    
    let pcmData = arrayBuffer;
    if (isWav) {
      pcmData = arrayBuffer.slice(44);
    }
    
    const int16 = new Int16Array(pcmData);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
      float32[i] = int16[i] / 32768;
    }
    
    workletNodeRef.current.port.postMessage({ type: 'samples', samples: float32 });
  };

  const startSession = useCallback((config: SessionConfig) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      setError('Not connected to server');
      return;
    }

    setSessionStatus('starting');
    setAIResponse('');
    setUserTranscript('');

    wsRef.current.send(JSON.stringify({
      type: 'start_session',
      tenantId: 'web-demo',
      config,
    }));
  }, [setSessionStatus, setAIResponse, setUserTranscript, setError]);

  const endSession = useCallback(() => {
    const sessionId = useVoiceStore.getState().sessionId;
    if (!wsRef.current || !sessionId) return;

    setSessionStatus('ending');
    wsRef.current.send(JSON.stringify({
      type: 'end_session',
      sessionId,
    }));
    
    stopRecording();
  }, [setSessionStatus]);

  const startRecording = useCallback(async () => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    try {
      mediaStreamRef.current = await navigator.mediaDevices.getUserMedia({
        audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });

      // Close previous recording context if exists
      if (recordingContextRef.current) {
        recordingContextRef.current.close().catch(() => {});
      }
      
      recordingContextRef.current = new AudioContext({ sampleRate: 16000 });
      const source = recordingContextRef.current.createMediaStreamSource(mediaStreamRef.current);
      processorRef.current = recordingContextRef.current.createScriptProcessor(4096, 1, 1);

      processorRef.current.onaudioprocess = (e) => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
        
        const input = e.inputBuffer.getChannelData(0);
        const pcm = new Int16Array(input.length);
        let sumSquares = 0;
        for (let i = 0; i < input.length; i++) {
          pcm[i] = Math.max(-32768, Math.min(32767, input[i] * 32768));
          sumSquares += input[i] * input[i];
        }
        wsRef.current.send(pcm.buffer);
        
        // Smart client-side VAD for barge-in.
        // Layer 1: RMS energy gate — reject true silence
        // Layer 2: High-band energy ratio via first-difference — filters AC hum (<120Hz)
        // Layer 3: Zero Crossing Rate range — speech is 50-250 ZCR/10ms; pure tones are low
        // Require 3 consecutive speech-like frames before triggering (~768ms at 4096/16kHz)
        if (isAIPlayingRef.current && !bargedInRef.current) {
          const rms = Math.sqrt(sumSquares / input.length);

          // High-band proxy: first-difference of float32 samples
          let highBandSumSq = 0;
          let zeroCrossings = 0;
          for (let i = 1; i < input.length; i++) {
            const diff = input[i] - input[i - 1];
            highBandSumSq += diff * diff;
            if ((input[i] >= 0) !== (input[i - 1] >= 0)) zeroCrossings++;
          }
          const bandRatio = sumSquares > 0 ? Math.sqrt(highBandSumSq / sumSquares) : 0;
          // ZCR per 10ms (input.length samples at 16kHz)
          const durationMs = (input.length / 16000) * 1000;
          const zcrPer10ms = (zeroCrossings / durationMs) * 10;

          // Speech thresholds (mid sensitivity defaults)
          const isSpeechLike =
            rms > 0.018 &&         // not silence (float32 ~= RMS 280 in int16)
            bandRatio > 0.28 &&    // has high-frequency content (not AC hum)
            zcrPer10ms >= 30 &&    // enough zero crossings for speech
            zcrPer10ms <= 280;     // but not pure broadband impulse noise

          if (isSpeechLike) {
            consecutiveLoudRef.current++;
            if (consecutiveLoudRef.current >= 3) {
              console.log('[barge-in] Smart VAD triggered', {
                rms: rms.toFixed(4), bandRatio: bandRatio.toFixed(3), zcr: zcrPer10ms.toFixed(1)
              });
              bargedInRef.current = true;
              consecutiveLoudRef.current = 0;
              if (workletNodeRef.current) {
                workletNodeRef.current.port.postMessage({ type: 'clear' });
              }
              isAIPlayingRef.current = false;
              setIsAIPlaying(false);
              setAIResponse('');
              wsRef.current.send(JSON.stringify({ type: 'barge_in' }));
            }
          } else {
            // Hangover: only reset after 5 non-speech frames to avoid flickering
            if (consecutiveLoudRef.current > 0) {
              consecutiveLoudRef.current = Math.max(0, consecutiveLoudRef.current - 1);
            }
          }
        }
      };

      source.connect(processorRef.current);
      processorRef.current.connect(recordingContextRef.current.destination);
      
      useVoiceStore.getState().setIsRecording(true);
    } catch (err) {
      setError('Microphone access denied');
    }
  }, [setError]);

  const stopRecording = useCallback(() => {
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (recordingContextRef.current) {
      recordingContextRef.current.close().catch(() => {});
      recordingContextRef.current = null;
    }
    useVoiceStore.getState().setIsRecording(false);
  }, []);

  useEffect(() => {
    return () => {
      disconnect();
      stopRecording();
      cleanupAudioPlayback();
    };
  }, [disconnect, stopRecording, cleanupAudioPlayback]);

  return {
    connect,
    disconnect,
    startSession,
    endSession,
    startRecording,
    stopRecording,
  };
}
