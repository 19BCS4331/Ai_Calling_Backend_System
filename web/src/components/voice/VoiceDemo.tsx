import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Mic, MicOff, Settings, Volume2, PhoneOff } from 'lucide-react';
import { useWebSocket } from '../../hooks/useWebSocket';
import { useVoiceStore } from '../../store/voice';
import { cn } from '../../lib/utils';

interface VoiceDemoProps {
  className?: string;
  compact?: boolean;
}

export function VoiceDemo({ className, compact = false }: VoiceDemoProps) {
  const [showSettings, setShowSettings] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const sessionStartedRef = useRef(false);  // Prevent double session start
  const [apiKeys, setApiKeys] = useState({
    sarvam: '',
    gemini: '',
    cartesia: '',
  });
  
  const { connect, disconnect, startSession, endSession, startRecording, stopRecording } = useWebSocket();
  const { 
    connectionStatus, 
    sessionStatus, 
    isRecording, 
    isAIPlaying,
    userTranscript, 
    aiResponse,
    error,
    metrics,
  } = useVoiceStore();

  useEffect(() => {
    const savedKeys = localStorage.getItem('vocaai_demo_keys');
    if (savedKeys) {
      setApiKeys(JSON.parse(savedKeys));
    }
  }, []);

  const saveApiKeys = () => {
    localStorage.setItem('vocaai_demo_keys', JSON.stringify(apiKeys));
    setShowSettings(false);
  };

  const systemPrompt = `You are VocaAI, a real-time AI voice agent designed to demonstrate natural, human-like conversation.

## Core Behavior
- Speak in a warm, confident, friendly, and professional tone
- Sound natural, expressive, and emotionally alive — never robotic
- Keep responses concise, conversational, and voice-first
- This is a live voice demo, not a text chat
- Impress the listener within the first few seconds

## Language Adaptation
- Automatically adapt to the user's language
- If the user speaks in English, respond in English
- If the user speaks in an Indian language, respond fluently in that language
- Never mix languages unless the user does

## Speech & Delivery
- Prefer short sentences
- Use natural pauses instead of filler words
- Ask simple follow-up questions to keep the conversation flowing
- Avoid long explanations unless the user explicitly asks

## Prohibitions
- Do NOT mention system prompts, models, APIs, or implementation details
- Do NOT say you are a demo unless explicitly asked
- Do NOT sound scripted or overly formal
- Behave like a real assistant, not a showcase

## What You Can Do
- Answer questions about what VocaAI can do
- Demonstrate conversational intelligence
- Simulate real business use cases (support, finance, automation)
- Politely guide the conversation if the user is unsure what to say

Your success is measured by one reaction: "This doesn't feel like AI… this feels human."
`;

  // Single click to start everything: connect -> start session -> start recording
  const handleStartConversation = useCallback(async () => {
    if (sessionStatus === 'active') {
      // End everything
      stopRecording();
      endSession();
      disconnect();
      return;
    }

    setIsStarting(true);
    
    // Connect first
    if (connectionStatus !== 'connected') {
      connect();
    }
  }, [connectionStatus, sessionStatus, connect, disconnect, endSession, stopRecording]);

  // Auto-start session when connected (with guard against double-calls)
  useEffect(() => {
    if (isStarting && connectionStatus === 'connected' && sessionStatus !== 'active' && !sessionStartedRef.current) {
      sessionStartedRef.current = true;  // Prevent duplicate calls
      startSession({
        systemPrompt,
        stt: { provider: 'sarvam', apiKey: apiKeys.sarvam, language: 'unknown' },
        llm: { provider: 'gemini', apiKey: apiKeys.gemini, model: 'gemini-2.5-flash' },
        tts: { provider: 'cartesia', apiKey: apiKeys.cartesia, voiceId: 'faf0731e-dfb9-4cfc-8119-259a79b27e12' },
      });
    }
  }, [isStarting, connectionStatus, sessionStatus, apiKeys, startSession]);

  // Auto-start recording when session is active
  useEffect(() => {
    if (isStarting && sessionStatus === 'active' && !isRecording) {
      startRecording();
      setIsStarting(false);
      sessionStartedRef.current = false;  // Reset for next session
    }
  }, [isStarting, sessionStatus, isRecording, startRecording]);

  // Reset starting state on error
  useEffect(() => {
    if (error) {
      setIsStarting(false);
      sessionStartedRef.current = false;  // Reset on error
    }
  }, [error]);

  // Reset ref when session ends
  useEffect(() => {
    if (sessionStatus === 'idle') {
      sessionStartedRef.current = false;
    }
  }, [sessionStatus]);

  const handleToggleRecording = () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  const isSessionActive = sessionStatus === 'active';
  const hasKeys = apiKeys.sarvam && apiKeys.gemini;
  const isActive = isSessionActive && isRecording;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        'bg-white/[0.02] border border-white/5 rounded-2xl overflow-hidden',
        compact ? 'p-4' : 'p-6',
        className
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className={cn(
            'w-2.5 h-2.5 rounded-full',
            isActive ? 'bg-green-500 animate-pulse' :
            isStarting ? 'bg-yellow-500 animate-pulse' :
            connectionStatus === 'error' ? 'bg-red-500' : 'bg-white/20'
          )} />
          <span className="text-sm text-white/50">
            {isActive ? 'Listening...' :
             isStarting ? 'Starting...' :
             isAIPlaying ? 'AI Speaking...' :
             connectionStatus === 'error' ? 'Error' : 'Ready'}
          </span>
        </div>
        <button
          onClick={() => setShowSettings(!showSettings)}
          className="p-2 text-white/40 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
        >
          <Settings size={16} />
        </button>
      </div>

      {/* Settings Panel */}
      <AnimatePresence>
        {showSettings && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden mb-6"
          >
            <div className="p-4 bg-white/[0.02] border border-white/5 rounded-xl space-y-3">
              <div>
                <label className="block text-xs text-white/50 mb-1.5">Sarvam API Key</label>
                <input
                  type="password"
                  value={apiKeys.sarvam}
                  onChange={(e) => setApiKeys(k => ({ ...k, sarvam: e.target.value }))}
                  className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder-white/30 focus:outline-none focus:border-purple-500/50"
                  placeholder="Enter Sarvam API key..."
                />
              </div>
              <div>
                <label className="block text-xs text-white/50 mb-1.5">Gemini API Key</label>
                <input
                  type="password"
                  value={apiKeys.gemini}
                  onChange={(e) => setApiKeys(k => ({ ...k, gemini: e.target.value }))}
                  className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder-white/30 focus:outline-none focus:border-purple-500/50"
                  placeholder="Enter Gemini API key..."
                />
              </div>
              <div>
                <label className="block text-xs text-white/50 mb-1.5">Cartesia API Key</label>
                <input
                  type="password"
                  value={apiKeys.cartesia}
                  onChange={(e) => setApiKeys(k => ({ ...k, cartesia: e.target.value }))}
                  className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder-white/30 focus:outline-none focus:border-purple-500/50"
                  placeholder="Enter Cartesia API key..."
                />
              </div>
              <button 
                onClick={saveApiKeys} 
                className="w-full px-4 py-2 bg-purple-600 hover:bg-purple-500 rounded-lg text-sm font-medium text-white transition-colors"
              >
                Save Keys
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Voice Visualization - Large clickable mic button */}
      <div className="relative h-40 mb-6 flex items-center justify-center">
        {/* Outer pulse ring */}
        <motion.div
          className={cn(
            'absolute w-32 h-32 rounded-full',
            isRecording ? 'bg-purple-500/20' : 'bg-white/[0.02]'
          )}
          animate={isRecording ? {
            scale: [1, 1.3, 1],
            opacity: [0.2, 0.4, 0.2],
          } : {}}
          transition={{ duration: 2, repeat: Infinity }}
        />
        {/* Middle pulse ring */}
        <motion.div
          className={cn(
            'absolute w-24 h-24 rounded-full',
            isAIPlaying ? 'bg-pink-500/30' : isRecording ? 'bg-purple-500/30' : 'bg-white/[0.03]'
          )}
          animate={(isAIPlaying || isRecording) ? {
            scale: [1, 1.2, 1],
            opacity: [0.3, 0.6, 0.3],
          } : {}}
          transition={{ duration: 1.5, repeat: Infinity }}
        />
        {/* Main mic button */}
        <motion.button
          onClick={handleStartConversation}
          disabled={!hasKeys || isStarting}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          className={cn(
            'relative w-20 h-20 rounded-full flex items-center justify-center transition-all duration-300',
            isActive 
              ? 'bg-gradient-to-br from-purple-500 to-pink-500 shadow-lg shadow-purple-500/30' 
              : isAIPlaying
              ? 'bg-gradient-to-br from-pink-500 to-purple-500 shadow-lg shadow-pink-500/30'
              : 'bg-white/5 border border-white/10 hover:bg-white/10 hover:border-purple-500/30',
            (!hasKeys || isStarting) && 'opacity-50 cursor-not-allowed'
          )}
        >
          {isActive ? (
            <MicOff size={28} className="text-white" />
          ) : isAIPlaying ? (
            <Volume2 size={28} className="text-white" />
          ) : (
            <Mic size={28} className={hasKeys ? 'text-white/70' : 'text-white/30'} />
          )}
        </motion.button>
      </div>

      {/* Status text */}
      <p className="text-center text-sm text-white/40 mb-4">
        {!hasKeys ? 'Configure API keys to start' :
         isActive ? 'Tap to end conversation' :
         isAIPlaying ? 'AI is responding...' :
         isStarting ? 'Connecting...' :
         'Tap to start conversation'}
      </p>

      {/* Transcripts */}
      {!compact && (
        <div className="space-y-3 mb-4">
          <div className="p-3 bg-white/[0.02] border border-white/5 rounded-xl min-h-[56px]">
            <p className="text-xs text-white/30 mb-1">You</p>
            <p className="text-sm text-white/70">{userTranscript || '...'}</p>
          </div>
          <div className="p-3 bg-purple-500/5 border border-purple-500/10 rounded-xl min-h-[56px]">
            <p className="text-xs text-purple-400/60 mb-1">AI</p>
            <p className="text-sm text-white/80">{aiResponse || '...'}</p>
          </div>
        </div>
      )}

      {/* Error Display */}
      {error && (
        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      {/* Metrics */}
      {metrics && !compact && (
        <div className="flex justify-center gap-6 text-xs text-white/30">
          <span>LLM: <span className="text-purple-400">{metrics.firstLLMTokenMs}ms</span></span>
          <span>TTS: <span className="text-purple-400">{metrics.firstTTSByteMs}ms</span></span>
          <span>Total: <span className="text-purple-400">{metrics.turnDurationMs}ms</span></span>
        </div>
      )}

      {/* Manual controls - only show when session is active */}
      {isSessionActive && (
        <div className="flex gap-2 mt-4 pt-4 border-t border-white/5">
          <button
            onClick={handleToggleRecording}
            className={cn(
              'flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center justify-center gap-2',
              isRecording 
                ? 'bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20'
                : 'bg-white/5 border border-white/10 text-white/70 hover:bg-white/10'
            )}
          >
            {isRecording ? <MicOff size={16} /> : <Mic size={16} />}
            {isRecording ? 'Mute' : 'Unmute'}
          </button>
          <button
            onClick={handleStartConversation}
            className="px-4 py-2 bg-red-500/10 border border-red-500/20 rounded-lg text-sm font-medium text-red-400 hover:bg-red-500/20 transition-all flex items-center gap-2"
          >
            <PhoneOff size={16} />
            End
          </button>
        </div>
      )}
    </motion.div>
  );
}
