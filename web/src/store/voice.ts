import { create } from 'zustand';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';
export type SessionStatus = 'idle' | 'starting' | 'active' | 'ending';

interface VoiceState {
  connectionStatus: ConnectionStatus;
  sessionStatus: SessionStatus;
  sessionId: string | null;
  isRecording: boolean;
  isSpeaking: boolean;
  isAIPlaying: boolean;
  userTranscript: string;
  aiResponse: string;
  error: string | null;
  metrics: {
    firstLLMTokenMs: number;
    firstTTSByteMs: number;
    turnDurationMs: number;
  } | null;
  
  setConnectionStatus: (status: ConnectionStatus) => void;
  setSessionStatus: (status: SessionStatus) => void;
  setSessionId: (id: string | null) => void;
  setIsRecording: (recording: boolean) => void;
  setIsSpeaking: (speaking: boolean) => void;
  setIsAIPlaying: (playing: boolean) => void;
  setUserTranscript: (transcript: string) => void;
  appendAIResponse: (token: string) => void;
  setAIResponse: (response: string) => void;
  setError: (error: string | null) => void;
  setMetrics: (metrics: VoiceState['metrics']) => void;
  reset: () => void;
}

const initialState = {
  connectionStatus: 'disconnected' as ConnectionStatus,
  sessionStatus: 'idle' as SessionStatus,
  sessionId: null,
  isRecording: false,
  isSpeaking: false,
  isAIPlaying: false,
  userTranscript: '',
  aiResponse: '',
  error: null,
  metrics: null,
};

export const useVoiceStore = create<VoiceState>((set) => ({
  ...initialState,
  
  setConnectionStatus: (status) => set({ connectionStatus: status }),
  setSessionStatus: (status) => set({ sessionStatus: status }),
  setSessionId: (id) => set({ sessionId: id }),
  setIsRecording: (recording) => set({ isRecording: recording }),
  setIsSpeaking: (speaking) => set({ isSpeaking: speaking }),
  setIsAIPlaying: (playing) => set({ isAIPlaying: playing }),
  setUserTranscript: (transcript) => set({ userTranscript: transcript }),
  appendAIResponse: (token) => set((state) => ({ 
    aiResponse: state.aiResponse === '' ? token : state.aiResponse + token 
  })),
  setAIResponse: (response) => set({ aiResponse: response }),
  setError: (error) => set({ error }),
  setMetrics: (metrics) => set({ metrics }),
  reset: () => set(initialState),
}));
