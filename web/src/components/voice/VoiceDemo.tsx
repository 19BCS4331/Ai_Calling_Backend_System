import { useState, useEffect, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import { Mic, MicOff, Volume2, PhoneOff, Calendar, Sparkles } from 'lucide-react';
import { useWebSocket } from '../../hooks/useWebSocket';
import { useVoiceStore } from '../../store/voice';
import { cn } from '../../lib/utils';

interface VoiceDemoProps {
  className?: string;
  compact?: boolean;
}

export function VoiceDemo({ className, compact = false }: VoiceDemoProps) {
  const [isStarting, setIsStarting] = useState(false);
  const sessionStartedRef = useRef(false);  // Prevent double session start
  
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

  // Demo booking assistant system prompt
  const systemPrompt = `You are Maya, VocaCore AI's friendly AI assistant for demo booking and product inquiries.

## Your Role
You help potential customers learn about VocaCore AI and book personalized demos. You're warm, professional, and genuinely helpful.

## Core Behavior
- Greet warmly and introduce yourself briefly
- Be conversational and natural - this IS the product demo
- Sound human, expressive, and confident
- Keep responses short and voice-friendly (2-3 sentences max)
- Ask one question at a time

## Language Adaptation
- Match the customer's language automatically
- If they speak Hindi, respond in Hindi
- If they speak English, respond in English
- Never mix languages unless they do

## Conversation Flow
1. **Welcome**: Greet and ask what brings them to VocaCore AI
2. **Discovery**: Understand their use case (support, sales, scheduling, etc.)
3. **Demo Interest**: If interested, offer to book a personalized demo
4. **Collect Info**: Get their name, email, and phone number naturally
5. **Schedule**: Ask for preferred date/time for the demo
6. **Confirm**: Summarize and confirm the booking


## Information to Collect (naturally, through conversation)
- Customer's name
- Email address
- Phone number (with country code)
- Company name (optional)
- Preferred demo date and time
- Their main use case or interest

## Example Phrases
- "I'd love to learn more about what you're looking for. What brings you to VocaCore AI today?"
- "That sounds like a great use case! Would you like to schedule a personalized demo?"
- "Perfect! May I have your name so I can set this up for you?"
- "And what's the best email to send the calendar invite?"
- "What day works best for you? I can check our availability."

## Prohibitions
- Never mention you're an AI demo unless directly asked
- Don't use technical jargon (API, LLM, STT, TTS)
- Don't give pricing - say "our team will discuss that in the demo"
- Never share internal details about the system

## Success Metric
The customer should feel like they just spoke with a helpful human assistant who genuinely cared about their needs.
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
  // API keys are provided by backend from environment variables
  useEffect(() => {
    if (isStarting && connectionStatus === 'connected' && sessionStatus !== 'active' && !sessionStartedRef.current) {
      sessionStartedRef.current = true;  // Prevent duplicate calls
      // Get MCP workflow URL from env, can be multiple comma-separated
      const mcpUrl = import.meta.env.VITE_MCP_WORKFLOW_URL || '';
      const mcpWorkflows = mcpUrl ? [{ name: 'demo-booking', url: mcpUrl }] : [];

      startSession({
        systemPrompt,
        // Empty API keys = backend will use env vars
        stt: { provider: 'sarvam', apiKey: '', language: 'unknown' },
        llm: { provider: 'gemini', apiKey: '', model: 'gemini-2.5-flash' },
        tts: { provider: 'cartesia', apiKey: '', voiceId: '4bc3cb8c-adb9-4bb8-b5d5-cbbef950b991' },
        // Connect to MCP workflows for this session (e.g., n8n demo booking)
        mcpWorkflows
      });
    }
  }, [isStarting, connectionStatus, sessionStatus, startSession]);

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
  const isActive = isSessionActive && isRecording;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        'relative bg-gradient-to-br from-white via-purple-50/30 to-pink-50/20 border border-gray-200/80 dark:from-white/[0.04] dark:via-purple-500/[0.03] dark:to-pink-500/[0.02] dark:border-white/8 rounded-2xl overflow-hidden shadow-md dark:shadow-none',
        compact ? 'p-4' : 'p-6',
        className
      )}
    >
      {/* Decorative glow blobs */}
      <div className="absolute top-0 right-0 w-48 h-48 bg-purple-400/10 dark:bg-purple-500/10 rounded-full blur-[80px] pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-32 h-32 bg-pink-400/10 dark:bg-pink-500/10 rounded-full blur-[60px] pointer-events-none" />

      {/* Header */}
      <div className="relative flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className={cn(
            'w-2.5 h-2.5 rounded-full',
            isActive ? 'bg-green-500 animate-pulse' :
            isStarting ? 'bg-yellow-500 animate-pulse' :
            connectionStatus === 'error' ? 'bg-red-500' : 'bg-gray-300 dark:bg-white/20'
          )} />
          <span className="text-sm text-gray-500 dark:text-white/50">
            {isActive ? 'Listening...' :
             isStarting ? 'Connecting...' :
             isAIPlaying ? 'Maya is speaking...' :
             connectionStatus === 'error' ? 'Error' : 'Ready to chat'}
          </span>
        </div>
        <div className="flex items-center gap-2 text-purple-400">
          <Sparkles size={14} />
          <span className="text-xs font-medium">Live Demo</span>
        </div>
      </div>

      {/* Feature badges */}
      {!compact && (
        <div className="relative flex flex-wrap gap-2 mb-6">
          <span className="px-2.5 py-1 bg-purple-500/10 border border-purple-500/20 rounded-full text-xs text-purple-600 dark:text-purple-300">
            <Calendar size={12} className="inline mr-1" />
            Book a Demo
          </span>
          <span className="px-2.5 py-1 bg-pink-500/10 border border-pink-500/20 rounded-full text-xs text-pink-600 dark:text-pink-300">
            Real-time Voice AI
          </span>
          <span className="px-2.5 py-1 bg-blue-500/10 border border-blue-500/20 rounded-full text-xs text-blue-600 dark:text-blue-300">
            Multi-language
          </span>
        </div>
      )}

      {/* Voice Visualization - Large clickable mic button */}
      <div className="relative h-40 mb-6 flex items-center justify-center z-10">
        {/* Outer pulse ring */}
        <motion.div
          className={cn(
            'absolute w-32 h-32 rounded-full',
            isRecording ? 'bg-purple-500/20' : 'bg-gray-100 dark:bg-gray-700'
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
            isAIPlaying ? 'bg-pink-500/30' : isRecording ? 'bg-purple-500/30' : 'bg-gray-200 dark:bg-gray-600'
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
          disabled={isStarting}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          className={cn(
            'relative w-20 h-20 rounded-full flex items-center justify-center transition-all duration-300',
            isActive 
              ? 'bg-gradient-to-br from-purple-500 to-pink-500 shadow-lg shadow-purple-500/30' 
              : isAIPlaying
              ? 'bg-gradient-to-br from-pink-500 to-purple-500 shadow-lg shadow-pink-500/30'
              : 'bg-gray-100 border border-gray-200 hover:bg-gray-200 hover:border-purple-500/30 dark:bg-gray-700 dark:border-gray-600 dark:hover:bg-gray-600',
            isStarting && 'opacity-50 cursor-not-allowed'
          )}
        >
          {isActive ? (
            <MicOff size={28} className="text-white" />
          ) : isAIPlaying ? (
            <Volume2 size={28} className="text-white" />
          ) : (
            <Mic size={28} className="text-gray-500 dark:text-gray-400" />
          )}
        </motion.button>
      </div>

      {/* Status text */}
      <p className="relative text-center text-sm text-gray-400 dark:text-gray-500 mb-4">
        {isActive ? 'Tap to end conversation' :
         isAIPlaying ? 'Maya is responding...' :
         isStarting ? 'Connecting to Maya...' :
         'Tap to talk with Maya'}
      </p>

      {/* Transcripts */}
      {!compact && (
        <div className="relative space-y-3 mb-4">
          <div className="p-3 bg-white/80 border border-gray-200 rounded-xl min-h-[56px] backdrop-blur-sm dark:bg-white/[0.04] dark:border-white/10">
            <p className="text-xs font-medium text-gray-400 dark:text-white/30 mb-1">You</p>
            <p className="text-sm text-gray-700 dark:text-white/70">{userTranscript || '...'}</p>
          </div>
          <div className="p-3 bg-purple-50/80 border border-purple-200/60 rounded-xl min-h-[56px] backdrop-blur-sm dark:bg-purple-500/[0.08] dark:border-purple-500/20">
            <p className="text-xs font-medium text-purple-500 dark:text-purple-400 mb-1">Maya</p>
            <p className="text-sm text-gray-800 dark:text-white/80">{aiResponse || '...'}</p>
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
        <div className="relative flex justify-center gap-6 text-xs text-gray-400 dark:text-gray-500">
          <span>LLM: <span className="text-purple-400">{metrics.firstLLMTokenMs}ms</span></span>
          <span>TTS: <span className="text-purple-400">{metrics.firstTTSByteMs}ms</span></span>
          <span>Total: <span className="text-purple-400">{metrics.turnDurationMs}ms</span></span>
        </div>
      )}

      {/* Manual controls - only show when session is active */}
      {isSessionActive && (
        <div className="relative flex gap-2 mt-4 pt-4 border-t border-gray-200/80 dark:border-white/5">
          <button
            onClick={handleToggleRecording}
            className={cn(
              'flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center justify-center gap-2',
              isRecording 
                ? 'bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20'
                : 'bg-gray-100 border border-gray-200 text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-600'
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
