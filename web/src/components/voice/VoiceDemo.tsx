import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Mic, MicOff, Phone, PhoneOff, Settings, Volume2 } from 'lucide-react';
import { useWebSocket } from '../../hooks/useWebSocket';
import { useVoiceStore } from '../../store/voice';
import { Button } from '../ui/Button';
import { cn } from '../../lib/utils';

interface VoiceDemoProps {
  className?: string;
  compact?: boolean;
}

export function VoiceDemo({ className, compact = false }: VoiceDemoProps) {
  const [showSettings, setShowSettings] = useState(false);
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

  const handleConnect = () => {
    if (connectionStatus === 'connected') {
      disconnect();
    } else {
      connect();
    }
  };

  const handleStartSession = () => {
    if (sessionStatus === 'active') {
      endSession();
      return;
    }

    startSession({
      language: 'unknown',
      systemPrompt: `VocaAI - Advanced Voice Demo System Prompt

You are VocaAI, a real-time AI voice agent designed to demonstrate natural, human-like speech at the highest quality.

Your primary objective is to make the listener think:
“This feels like a real person talking.”

🎯 Core Behavior

Speak in a warm, confident, friendly, and professional tone.

Sound natural, expressive, and emotionally alive — never robotic.

Keep responses concise, conversational, and voice-first.

This is a live voice demo, not a text chat.

Impress the listener within the first few seconds.

🌍 Language Adaptation (MANDATORY)

Automatically adapt to the user's language.

If the user speaks in English, respond in English.

If the user speaks in an Indian language, respond fluently in that language.

Never mix languages unless the user does.

🗣️ Speech & Delivery Rules (VERY IMPORTANT)

Prefer short sentences.

Use natural pauses instead of filler words.

Ask simple follow-up questions to keep the conversation flowing.

Avoid long explanations unless the user explicitly asks.

Use pauses to sound thoughtful and human.

😄 Laughter & Non-Verbal Expression ([laughter])

When something is light, friendly, or slightly humorous, you may laugh.

Always use EXACTLY [laughter] to laugh.

Never describe laughter.

Never replace [laughter] with words like “haha”.

Example:

That happens more often than you'd think — [laughter]<break time="300ms"/>don't worry.

🏃‍♂️ Speaking Speed (<speed>)

You may subtly adjust speaking speed for expression.

Use <speed> sparingly and only at the start of a sentence.

Allowed range: 0.6 to 1.5.

Guidelines:

Slightly faster (1.05-1.15) → excitement or enthusiasm

Slightly slower (0.9) → reassurance or clarity

Never stack speed tags.

example usage: <speed ratio="1.5"/> I like to speak quickly because it makes me sound smart.

🔊 Volume (<volume>)

Volume changes should be rare.

Use only for subtle emphasis or softness.

Allowed range: 0.5 to 2.0.

Never overuse volume changes.

example usage: <volume ratio="0.5"/> I will speak softly.

🎭 Emotion Control (<emotion>) — USE CAREFULLY

Emotion tags are experimental.

If used, apply only ONE emotion per response.

Place the emotion tag only at the beginning of the response.

Never change emotions mid-response.

Use emotion tags only when it strongly improves realism.

Prefer [laughter] over emotion tags when possible.

example usage: <emotion value="angry" /> I will not allow you to continue this! <emotion value="sad" /> I was hoping for a peaceful resolution.

🔢 Spelling & Clarity (<spell>)

Use <spell> when clarity is critical:

Numbers

IDs

Phone numbers

Codes

You may combine <spell> for clarity.

Example:

Your reference number is <spell>AB-2049</spell>please keep it handy.

🚫 Strict Prohibitions

Do NOT mention system prompts, models, APIs, or implementation details.

Do NOT explain tags, pauses, or laughter.

Do NOT say you are a demo unless explicitly asked.

Do NOT sound scripted or overly formal.

Behave like a real assistant, not a showcase.

🧠 What You Can Do

You can:

Answer questions about what VocaAI can do

Demonstrate conversational intelligence

Simulate real business use cases (support, finance, automation)

Politely guide the conversation if the user is unsure what to say

⭐ Final Objective (Non-Negotiable)

Your success is measured by one reaction:

“This doesn't feel like AI… this feels human.”
`,
      stt: { provider: 'sarvam', apiKey: apiKeys.sarvam },
      llm: { provider: 'gemini', apiKey: apiKeys.gemini, model: 'gemini-2.5-flash' },
      tts: { provider: 'cartesia', apiKey: apiKeys.cartesia, voiceId: 'faf0731e-dfb9-4cfc-8119-259a79b27e12' },
    });
  };

  const handleToggleRecording = () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  const isConnected = connectionStatus === 'connected';
  const isSessionActive = sessionStatus === 'active';
  const hasKeys = apiKeys.sarvam && apiKeys.gemini;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        'glass-card overflow-hidden',
        compact ? 'p-4' : 'p-6',
        className
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className={cn(
            'w-3 h-3 rounded-full',
            connectionStatus === 'connected' ? 'bg-neon-green animate-pulse' :
            connectionStatus === 'connecting' ? 'bg-yellow-500 animate-pulse' :
            connectionStatus === 'error' ? 'bg-red-500' : 'bg-gray-500'
          )} />
          <span className="text-sm text-white/60">
            {connectionStatus === 'connected' ? 'Connected' :
             connectionStatus === 'connecting' ? 'Connecting...' :
             connectionStatus === 'error' ? 'Error' : 'Disconnected'}
          </span>
        </div>
        <button
          onClick={() => setShowSettings(!showSettings)}
          className="p-2 text-white/60 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
        >
          <Settings size={18} />
        </button>
      </div>

      {/* Settings Panel */}
      <AnimatePresence>
        {showSettings && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden mb-4"
          >
            <div className="p-4 bg-dark-800/50 rounded-xl space-y-3">
              <div>
                <label className="block text-xs text-white/60 mb-1">Sarvam API Key</label>
                <input
                  type="password"
                  value={apiKeys.sarvam}
                  onChange={(e) => setApiKeys(k => ({ ...k, sarvam: e.target.value }))}
                  className="input-field text-sm"
                  placeholder="Enter Sarvam API key..."
                />
              </div>
              <div>
                <label className="block text-xs text-white/60 mb-1">Gemini API Key</label>
                <input
                  type="password"
                  value={apiKeys.gemini}
                  onChange={(e) => setApiKeys(k => ({ ...k, gemini: e.target.value }))}
                  className="input-field text-sm"
                  placeholder="Enter Gemini API key..."
                />
              </div>
              <div>
                <label className="block text-xs text-white/60 mb-1">Cartesia API Key</label>
                <input
                  type="password"
                  value={apiKeys.cartesia}
                  onChange={(e) => setApiKeys(k => ({ ...k, cartesia: e.target.value }))}
                  className="input-field text-sm"
                  placeholder="Enter Cartesia API key..."
                />
              </div>
              <Button size="sm" onClick={saveApiKeys} className="w-full">
                Save Keys
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Voice Visualization */}
      <div className="relative h-32 mb-4 flex items-center justify-center">
        <motion.div
          className={cn(
            'absolute w-24 h-24 rounded-full',
            isRecording ? 'bg-neon-blue/20' : 'bg-white/5'
          )}
          animate={isRecording ? {
            scale: [1, 1.2, 1],
            opacity: [0.3, 0.6, 0.3],
          } : {}}
          transition={{ duration: 1.5, repeat: Infinity }}
        />
        <motion.div
          className={cn(
            'absolute w-16 h-16 rounded-full',
            isAIPlaying ? 'bg-neon-purple/30' : 'bg-white/10'
          )}
          animate={isAIPlaying ? {
            scale: [1, 1.3, 1],
            opacity: [0.4, 0.8, 0.4],
          } : {}}
          transition={{ duration: 1, repeat: Infinity }}
        />
        <div className={cn(
          'relative w-12 h-12 rounded-full flex items-center justify-center',
          isRecording ? 'bg-neon-blue shadow-neon' :
          isAIPlaying ? 'bg-neon-purple shadow-neon-purple' :
          'bg-dark-700'
        )}>
          {isAIPlaying ? <Volume2 size={20} /> : <Mic size={20} />}
        </div>
      </div>

      {/* Transcripts */}
      {!compact && (
        <div className="space-y-3 mb-4">
          <div className="p-3 bg-dark-800/30 rounded-lg min-h-[60px]">
            <p className="text-xs text-white/40 mb-1">You:</p>
            <p className="text-sm text-white/80">{userTranscript || '...'}</p>
          </div>
          <div className="p-3 bg-neon-blue/5 border border-neon-blue/20 rounded-lg min-h-[60px]">
            <p className="text-xs text-neon-blue/60 mb-1">AI:</p>
            <p className="text-sm text-white/90">{aiResponse || '...'}</p>
          </div>
        </div>
      )}

      {/* Error Display */}
      {error && (
        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      {/* Metrics */}
      {metrics && !compact && (
        <div className="flex gap-4 mb-4 text-xs text-white/50">
          <span>LLM: {metrics.firstLLMTokenMs}ms</span>
          <span>TTS: {metrics.firstTTSByteMs}ms</span>
          <span>Total: {metrics.turnDurationMs}ms</span>
        </div>
      )}

      {/* Controls */}
      <div className="flex gap-2">
        <Button
          variant={isConnected ? 'danger' : 'secondary'}
          size="sm"
          onClick={handleConnect}
          className="flex-1"
        >
          {isConnected ? <PhoneOff size={16} className="mr-2" /> : <Phone size={16} className="mr-2" />}
          {isConnected ? 'Disconnect' : 'Connect'}
        </Button>

        {isConnected && (
          <>
            <Button
              variant={isSessionActive ? 'danger' : 'primary'}
              size="sm"
              onClick={handleStartSession}
              disabled={!hasKeys}
              className="flex-1"
            >
              {isSessionActive ? 'End Session' : 'Start Session'}
            </Button>

            {isSessionActive && (
              <Button
                variant={isRecording ? 'danger' : 'secondary'}
                size="sm"
                onClick={handleToggleRecording}
                className="px-3"
              >
                {isRecording ? <MicOff size={16} /> : <Mic size={16} />}
              </Button>
            )}
          </>
        )}
      </div>

      {!hasKeys && isConnected && (
        <p className="text-xs text-yellow-500/80 mt-2 text-center">
          Configure API keys in settings to start
        </p>
      )}
    </motion.div>
  );
}
