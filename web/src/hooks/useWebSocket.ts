import { useCallback, useRef, useEffect } from 'react';
import { useVoiceStore } from '../store/voice';

const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:3000';

interface MCPWorkflow {
  name: string;
  url: string;
  apiKey?: string;
}

interface SessionConfig {
  language?: string;
  systemPrompt: string;
  stt: { provider: string; apiKey: string; language?: string };
  llm: { provider: string; apiKey: string; model: string };
  tts: { provider: string; apiKey: string; voiceId: string; language?: string };
  mcpWorkflows?: MCPWorkflow[];  // Array of MCP workflows to connect for this session
}

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const recordingContextRef = useRef<AudioContext | null>(null);  // Track recording AudioContext
  
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
        appendAIResponse(msg.token as string);
        break;

      case 'turn_complete':
        setMetrics(msg.metrics as { firstLLMTokenMs: number; firstTTSByteMs: number; turnDurationMs: number });
        break;

      case 'barge_in':
        // Clear audio buffer immediately on barge-in
        if (workletNodeRef.current) {
          workletNodeRef.current.port.postMessage({ type: 'clear' });
        }
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
    
    setIsAIPlaying(true);
    
    const arrayBuffer = await blob.arrayBuffer();
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
        for (let i = 0; i < input.length; i++) {
          pcm[i] = Math.max(-32768, Math.min(32767, input[i] * 32768));
        }
        wsRef.current.send(pcm.buffer);
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
