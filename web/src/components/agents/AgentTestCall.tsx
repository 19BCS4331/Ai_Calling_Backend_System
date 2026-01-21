import { useState, useEffect, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import { 
  Phone, 
  PhoneOff, 
  Mic, 
  MicOff, 
  Volume2, 
  Loader,
  AlertCircle,
  Clock,
  Zap,
  MessageSquare
} from 'lucide-react';
import { useWebSocket } from '../../hooks/useWebSocket';
import { useVoiceStore } from '../../store/voice';
import type { Agent } from '../../lib/supabase-types';
import { cn } from '../../lib/utils';

interface AgentTestCallProps {
  agent: Agent;
  className?: string;
}

export function AgentTestCall({ agent, className }: AgentTestCallProps) {
  const [isStarting, setIsStarting] = useState(false);
  const sessionStartedRef = useRef(false);
  
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

  // Build session config from agent settings
  const buildSessionConfig = useCallback(() => {
    return {
      agentId: agent.id,
      systemPrompt: agent.system_prompt || '',
      language: agent.language || 'en-IN',
      stt: { 
        provider: agent.stt_provider || 'sarvam', 
        apiKey: '', // Backend uses env vars
        language: agent.language || 'unknown',
        ...agent.stt_config
      },
      llm: { 
        provider: agent.llm_provider || 'gemini', 
        apiKey: '', // Backend uses env vars
        model: agent.llm_config?.model || 'gemini-2.5-flash',
        temperature: agent.llm_config?.temperature ?? 0.7
      },
      tts: { 
        provider: agent.tts_provider || 'cartesia', 
        apiKey: '', // Backend uses env vars
        voiceId: agent.voice_id || agent.tts_config?.voiceId || 'faf0731e-dfb9-4cfc-8119-259a79b27e12',
        language: agent.language || 'en-IN',
        ...agent.tts_config
      },
      firstMessage: agent.first_message,
      endCallPhrases: agent.end_call_phrases,
      interruptionSensitivity: agent.interruption_sensitivity,
      silenceTimeoutMs: agent.silence_timeout_ms,
      maxCallDurationSeconds: agent.max_call_duration_seconds
    };
  }, [agent]);

  // Start/end call handler
  const handleToggleCall = useCallback(async () => {
    if (sessionStatus === 'active') {
      // End call
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

  // Auto-start session when connected
  useEffect(() => {
    if (isStarting && connectionStatus === 'connected' && sessionStatus !== 'active' && !sessionStartedRef.current) {
      sessionStartedRef.current = true;
      const config = buildSessionConfig();
      startSession(config);
    }
  }, [isStarting, connectionStatus, sessionStatus, startSession, buildSessionConfig]);

  // Auto-start recording when session is active
  useEffect(() => {
    if (isStarting && sessionStatus === 'active' && !isRecording) {
      startRecording();
      setIsStarting(false);
      sessionStartedRef.current = false;
    }
  }, [isStarting, sessionStatus, isRecording, startRecording]);

  // Reset on error
  useEffect(() => {
    if (error) {
      setIsStarting(false);
      sessionStartedRef.current = false;
    }
  }, [error]);

  // Reset ref when session ends
  useEffect(() => {
    if (sessionStatus === 'idle') {
      sessionStartedRef.current = false;
    }
  }, [sessionStatus]);

  const handleToggleMute = () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  const isSessionActive = sessionStatus === 'active';
  const isActive = isSessionActive && isRecording;

  return (
    <div className={cn('space-y-4', className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={cn(
            'w-10 h-10 rounded-xl flex items-center justify-center',
            isActive ? 'bg-green-500/20' :
            isStarting ? 'bg-yellow-500/20' :
            'bg-purple-500/20'
          )}>
            <Phone size={20} className={cn(
              isActive ? 'text-green-400' :
              isStarting ? 'text-yellow-400' :
              'text-purple-400'
            )} />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-white">Test Call</h3>
            <p className="text-sm text-white/50">
              {isActive ? 'Call in progress' :
               isStarting ? 'Connecting...' :
               'Test your agent via web call'}
            </p>
          </div>
        </div>

        {/* Status indicator */}
        <div className={cn(
          'px-3 py-1.5 rounded-full text-xs font-medium flex items-center gap-2',
          isActive ? 'bg-green-500/10 text-green-400 border border-green-500/20' :
          isStarting ? 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20' :
          'bg-white/5 text-white/50 border border-white/10'
        )}>
          <div className={cn(
            'w-2 h-2 rounded-full',
            isActive ? 'bg-green-400 animate-pulse' :
            isStarting ? 'bg-yellow-400 animate-pulse' :
            'bg-white/30'
          )} />
          {isActive ? 'Active' : isStarting ? 'Connecting' : 'Ready'}
        </div>
      </div>

      {/* Main call interface */}
      <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-6">
        {/* Voice visualization */}
        <div className="relative h-32 mb-6 flex items-center justify-center">
          {/* Outer pulse ring */}
          <motion.div
            className={cn(
              'absolute w-28 h-28 rounded-full',
              isRecording ? 'bg-green-500/20' : isAIPlaying ? 'bg-purple-500/20' : 'bg-white/[0.02]'
            )}
            animate={(isRecording || isAIPlaying) ? {
              scale: [1, 1.3, 1],
              opacity: [0.2, 0.4, 0.2],
            } : {}}
            transition={{ duration: 2, repeat: Infinity }}
          />
          {/* Middle pulse ring */}
          <motion.div
            className={cn(
              'absolute w-20 h-20 rounded-full',
              isAIPlaying ? 'bg-purple-500/30' : isRecording ? 'bg-green-500/30' : 'bg-white/[0.03]'
            )}
            animate={(isAIPlaying || isRecording) ? {
              scale: [1, 1.2, 1],
              opacity: [0.3, 0.6, 0.3],
            } : {}}
            transition={{ duration: 1.5, repeat: Infinity }}
          />
          {/* Main button */}
          <motion.button
            onClick={handleToggleCall}
            disabled={isStarting}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            className={cn(
              'relative w-16 h-16 rounded-full flex items-center justify-center transition-all duration-300',
              isActive 
                ? 'bg-gradient-to-br from-red-500 to-red-600 shadow-lg shadow-red-500/30' 
                : isAIPlaying
                ? 'bg-gradient-to-br from-purple-500 to-pink-500 shadow-lg shadow-purple-500/30'
                : 'bg-gradient-to-br from-green-500 to-green-600 shadow-lg shadow-green-500/30',
              isStarting && 'opacity-50 cursor-not-allowed'
            )}
          >
            {isStarting ? (
              <Loader size={24} className="text-white animate-spin" />
            ) : isActive ? (
              <PhoneOff size={24} className="text-white" />
            ) : isAIPlaying ? (
              <Volume2 size={24} className="text-white" />
            ) : (
              <Phone size={24} className="text-white" />
            )}
          </motion.button>
        </div>

        {/* Status text */}
        <p className="text-center text-sm text-white/40 mb-4">
          {isActive ? 'Click to end call' :
           isAIPlaying ? `${agent.name} is speaking...` :
           isStarting ? `Connecting to ${agent.name}...` :
           `Click to start test call with ${agent.name}`}
        </p>

        {/* Call controls - only show when active */}
        {isSessionActive && (
          <div className="flex gap-3 justify-center mb-6">
            <button
              onClick={handleToggleMute}
              className={cn(
                'px-4 py-2.5 rounded-xl text-sm font-medium transition-all flex items-center gap-2',
                isRecording 
                  ? 'bg-white/5 border border-white/10 text-white/70 hover:bg-white/10'
                  : 'bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20'
              )}
            >
              {isRecording ? <Mic size={16} /> : <MicOff size={16} />}
              {isRecording ? 'Mute' : 'Unmute'}
            </button>
            <button
              onClick={handleToggleCall}
              className="px-4 py-2.5 bg-red-500/10 border border-red-500/20 rounded-xl text-sm font-medium text-red-400 hover:bg-red-500/20 transition-all flex items-center gap-2"
            >
              <PhoneOff size={16} />
              End Call
            </button>
          </div>
        )}

        {/* Transcripts */}
        <div className="space-y-3">
          <div className="p-4 bg-white/[0.02] border border-white/5 rounded-xl min-h-[60px]">
            <div className="flex items-center gap-2 mb-2">
              <Mic size={12} className="text-white/30" />
              <p className="text-xs text-white/30">You</p>
            </div>
            <p className="text-sm text-white/70">{userTranscript || 'Waiting for input...'}</p>
          </div>
          <div className="p-4 bg-purple-500/5 border border-purple-500/10 rounded-xl min-h-[60px]">
            <div className="flex items-center gap-2 mb-2">
              <MessageSquare size={12} className="text-purple-400/60" />
              <p className="text-xs text-purple-400/60">{agent.name}</p>
            </div>
            <p className="text-sm text-white/80">{aiResponse || 'Waiting for response...'}</p>
          </div>
        </div>

        {/* Error Display */}
        {error && (
          <div className="mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl flex items-start gap-3">
            <AlertCircle size={18} className="text-red-400 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-400">{error}</p>
          </div>
        )}

        {/* Metrics */}
        {metrics && (
          <div className="mt-4 pt-4 border-t border-white/5">
            <div className="flex items-center gap-2 mb-3">
              <Zap size={14} className="text-white/30" />
              <p className="text-xs text-white/30">Performance Metrics</p>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="text-center">
                <p className="text-lg font-semibold text-purple-400">{metrics.firstLLMTokenMs}ms</p>
                <p className="text-xs text-white/40">LLM Latency</p>
              </div>
              <div className="text-center">
                <p className="text-lg font-semibold text-purple-400">{metrics.firstTTSByteMs}ms</p>
                <p className="text-xs text-white/40">TTS Latency</p>
              </div>
              <div className="text-center">
                <p className="text-lg font-semibold text-purple-400">{metrics.turnDurationMs}ms</p>
                <p className="text-xs text-white/40">Total Turn</p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Agent config summary */}
      <div className="bg-white/[0.02] border border-white/5 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <Clock size={14} className="text-white/30" />
          <p className="text-xs text-white/30">Test Configuration</p>
        </div>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-white/40 text-xs">STT Provider</p>
            <p className="text-white/70">{agent.stt_provider || 'sarvam'}</p>
          </div>
          <div>
            <p className="text-white/40 text-xs">LLM Provider</p>
            <p className="text-white/70">{agent.llm_provider || 'gemini'}</p>
          </div>
          <div>
            <p className="text-white/40 text-xs">TTS Provider</p>
            <p className="text-white/70">{agent.tts_provider || 'cartesia'}</p>
          </div>
          <div>
            <p className="text-white/40 text-xs">Language</p>
            <p className="text-white/70">{agent.language || 'en-IN'}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
