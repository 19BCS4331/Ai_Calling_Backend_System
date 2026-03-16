import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, PhoneIncoming, PhoneOutgoing, Globe, Clock,
  DollarSign, User, Bot, Loader2, MessageSquare, Play, Pause,
  ChevronDown, ChevronUp, Cpu, Zap
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useOrganizationStore } from '../store/organization';
import { saasApi, saasEndpoints } from '../lib/api';

interface CallDetailProps {
  call: {
    id: string;
    agent_id: string | null;
    direction: 'inbound' | 'outbound' | 'web';
    from_number: string | null;
    to_number: string | null;
    started_at: string;
    ended_at: string | null;
    duration_seconds: number;
    status: string;
    cost_total_cents: number;
    cost_user_cents: number;
    recording_url: string | null;
  };
  onClose: () => void;
}

interface CallFullData {
  id: string;
  direction: string;
  from_number: string | null;
  to_number: string | null;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number;
  billed_minutes: number;
  status: string;
  end_reason: string | null;
  stt_provider: string | null;
  tts_provider: string | null;
  llm_provider: string | null;
  cost_stt_cents: number;
  cost_tts_cents: number;
  cost_llm_cents: number;
  cost_total_cents: number;
  cost_user_cents: number;
  cost_telephony_cents: number;
  llm_prompt_tokens: number;
  llm_completion_tokens: number;
  llm_cached_tokens: number;
  tts_characters: number;
  latency_first_response_ms: number | null;
  latency_avg_response_ms: number | null;
  interruptions_count: number;
  recording_url: string | null;
  agents?: { name: string } | null;
}

interface TranscriptEntry {
  role: string;
  content: string;
  timestamp: string | null;
}

export function CallDetail({ call, onClose }: CallDetailProps) {
  const { currentOrganization } = useOrganizationStore();
  const [fullData, setFullData] = useState<CallFullData | null>(null);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [isLoadingTranscript, setIsLoadingTranscript] = useState(true);
  const [showCostBreakdown, setShowCostBreakdown] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioEl, setAudioEl] = useState<HTMLAudioElement | null>(null);

  // Fetch full call data
  useEffect(() => {
    const fetchData = async () => {
      if (!currentOrganization) return;
      try {
        const { data, error } = await supabase
          .from('calls')
          .select(`
            *,
            agents ( name )
          `)
          .eq('id', call.id)
          .eq('organization_id', currentOrganization.id)
          .single();

        if (!error && data) {
          setFullData(data as any);
        }
      } catch (err) {
        console.error('Failed to fetch call detail:', err);
      }
    };

    fetchData();
  }, [call.id, currentOrganization]);

  // Fetch transcript
  useEffect(() => {
    const fetchTranscript = async () => {
      if (!currentOrganization) return;
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const result = await saasApi.get<{ transcript: TranscriptEntry[] }>(
          saasEndpoints.callTranscript(currentOrganization.id, call.id),
          session?.access_token
        );
        setTranscript(result.transcript || []);
      } catch (err) {
        console.error('Failed to fetch transcript:', err);
      } finally {
        setIsLoadingTranscript(false);
      }
    };

    fetchTranscript();
  }, [call.id, currentOrganization]);

  // Cleanup audio on unmount
  useEffect(() => {
    return () => {
      if (audioEl) {
        audioEl.pause();
        audioEl.src = '';
      }
    };
  }, [audioEl]);

  const togglePlayback = () => {
    if (!call.recording_url) return;

    if (audioEl) {
      if (isPlaying) {
        audioEl.pause();
        setIsPlaying(false);
      } else {
        audioEl.play();
        setIsPlaying(true);
      }
    } else {
      const audio = new Audio(call.recording_url);
      audio.onended = () => setIsPlaying(false);
      audio.play();
      setIsPlaying(true);
      setAudioEl(audio);
    }
  };

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const formatDate = (dateStr: string): string => {
    return new Date(dateStr).toLocaleString('en-IN', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  const directionIcon = call.direction === 'inbound'
    ? <PhoneIncoming size={16} className="text-green-400" />
    : call.direction === 'web'
    ? <Globe size={16} className="text-blue-400" />
    : <PhoneOutgoing size={16} className="text-purple-400" />;

  const d = fullData;
  const userCost = (d?.cost_user_cents || call.cost_user_cents || call.cost_total_cents) / 100;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      >
        <motion.div
          initial={{ x: '100%' }}
          animate={{ x: 0 }}
          exit={{ x: '100%' }}
          transition={{ type: 'spring', damping: 25, stiffness: 250 }}
          className="absolute right-0 top-0 h-full w-full max-w-2xl bg-[#0a0a0f] border-l border-white/10 overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="sticky top-0 z-10 bg-[#0a0a0f]/95 backdrop-blur-sm border-b border-white/10 p-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                  call.direction === 'inbound' ? 'bg-green-500/10 border border-green-500/20'
                  : call.direction === 'web' ? 'bg-blue-500/10 border border-blue-500/20'
                  : 'bg-purple-500/10 border border-purple-500/20'
                }`}>
                  {directionIcon}
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-white">Call Details</h2>
                  <p className="text-sm text-white/40">
                    {call.direction.charAt(0).toUpperCase() + call.direction.slice(1)} · {formatDate(call.started_at)}
                  </p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="p-2 text-white/40 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
              >
                <X size={20} />
              </button>
            </div>
          </div>

          <div className="p-6 space-y-6">
            {/* Quick Stats */}
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-white/[0.03] border border-white/5 rounded-xl p-4 text-center">
                <Clock size={18} className="text-blue-400 mx-auto mb-2" />
                <p className="text-lg font-bold text-white">{formatDuration(call.duration_seconds)}</p>
                <p className="text-xs text-white/40">Duration</p>
              </div>
              <div className="bg-white/[0.03] border border-white/5 rounded-xl p-4 text-center">
                <DollarSign size={18} className="text-green-400 mx-auto mb-2" />
                <p className="text-lg font-bold text-white">${userCost.toFixed(2)}</p>
                <p className="text-xs text-white/40">Cost</p>
              </div>
              <div className="bg-white/[0.03] border border-white/5 rounded-xl p-4 text-center">
                <Zap size={18} className="text-yellow-400 mx-auto mb-2" />
                <p className="text-lg font-bold text-white">
                  {d?.latency_first_response_ms ? `${(d.latency_first_response_ms / 1000).toFixed(1)}s` : '—'}
                </p>
                <p className="text-xs text-white/40">First Response</p>
              </div>
            </div>

            {/* Call Info */}
            <div className="bg-white/[0.03] border border-white/5 rounded-xl p-5">
              <h3 className="text-sm font-medium text-white/60 uppercase tracking-wider mb-4">Call Information</h3>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-white/50">Status</span>
                  <span className={`px-2 py-0.5 rounded-full text-xs border ${
                    call.status === 'completed' ? 'bg-green-500/10 text-green-400 border-green-500/20'
                    : call.status === 'failed' ? 'bg-red-500/10 text-red-400 border-red-500/20'
                    : 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20'
                  }`}>
                    {call.status.replace('_', ' ')}
                  </span>
                </div>
                {d?.end_reason && (
                  <div className="flex justify-between">
                    <span className="text-white/50">End Reason</span>
                    <span className="text-white">{d.end_reason}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-white/50">From</span>
                  <span className="text-white">{call.from_number || 'Web User'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/50">To</span>
                  <span className="text-white">{call.to_number || 'Agent'}</span>
                </div>
                {d?.agents?.name && (
                  <div className="flex justify-between">
                    <span className="text-white/50">Agent</span>
                    <span className="text-white">{d.agents.name}</span>
                  </div>
                )}
                {d?.billed_minutes != null && (
                  <div className="flex justify-between">
                    <span className="text-white/50">Billed Minutes</span>
                    <span className="text-white">{d.billed_minutes}</span>
                  </div>
                )}
                {d?.interruptions_count != null && d.interruptions_count > 0 && (
                  <div className="flex justify-between">
                    <span className="text-white/50">Interruptions</span>
                    <span className="text-white">{d.interruptions_count}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Cost Breakdown */}
            <div className="bg-white/[0.03] border border-white/5 rounded-xl overflow-hidden">
              <button
                onClick={() => setShowCostBreakdown(!showCostBreakdown)}
                className="w-full flex items-center justify-between p-5 hover:bg-white/[0.02] transition-colors"
              >
                <div className="flex items-center gap-2">
                  <DollarSign size={16} className="text-green-400" />
                  <h3 className="text-sm font-medium text-white/60 uppercase tracking-wider">Cost Breakdown</h3>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-white font-medium">${userCost.toFixed(2)}</span>
                  {showCostBreakdown ? <ChevronUp size={16} className="text-white/40" /> : <ChevronDown size={16} className="text-white/40" />}
                </div>
              </button>
              <AnimatePresence>
                {showCostBreakdown && d && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="px-5 pb-5 space-y-3 text-sm border-t border-white/5 pt-4">
                      <div className="flex justify-between items-center">
                        <span className="text-white/50">Billed Minutes</span>
                        <span className="text-white font-mono">{d.billed_minutes || Math.ceil((d.duration_seconds || 0) / 60)}</span>
                      </div>
                      {d.billed_minutes > 0 && d.cost_user_cents > 0 && (
                        <div className="flex justify-between items-center">
                          <span className="text-white/50">Rate</span>
                          <span className="text-white font-mono">${(d.cost_user_cents / d.billed_minutes / 100).toFixed(2)}/min</span>
                        </div>
                      )}
                      <div className="border-t border-white/5 pt-3 flex justify-between items-center">
                        <span className="text-white font-medium">Total Cost</span>
                        <span className="text-white font-bold">${(d.cost_user_cents / 100).toFixed(2)}</span>
                      </div>

                      {/* Usage Details */}
                      <div className="border-t border-white/5 pt-3 mt-3">
                        <p className="text-xs text-white/30 mb-3">Usage Details</p>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="bg-white/[0.02] rounded-lg p-3">
                            <p className="text-xs text-white/40">LLM Tokens</p>
                            <p className="text-sm text-white font-mono">
                              {((d.llm_prompt_tokens || 0) + (d.llm_completion_tokens || 0)).toLocaleString()}
                            </p>
                            <p className="text-xs text-white/30">
                              {d.llm_prompt_tokens?.toLocaleString()} in / {d.llm_completion_tokens?.toLocaleString()} out
                            </p>
                          </div>
                          <div className="bg-white/[0.02] rounded-lg p-3">
                            <p className="text-xs text-white/40">TTS Characters</p>
                            <p className="text-sm text-white font-mono">{(d.tts_characters || 0).toLocaleString()}</p>
                          </div>
                        </div>
                      </div>

                      {/* Providers used */}
                      <div className="border-t border-white/5 pt-3 mt-3">
                        <p className="text-xs text-white/30 mb-3">Providers</p>
                        <div className="flex flex-wrap gap-2">
                          {d.stt_provider && (
                            <span className="px-2.5 py-1 bg-blue-500/10 border border-blue-500/20 rounded-lg text-xs text-blue-400">
                              STT: {d.stt_provider}
                            </span>
                          )}
                          {d.llm_provider && (
                            <span className="px-2.5 py-1 bg-purple-500/10 border border-purple-500/20 rounded-lg text-xs text-purple-400">
                              LLM: {d.llm_provider}
                            </span>
                          )}
                          {d.tts_provider && (
                            <span className="px-2.5 py-1 bg-green-500/10 border border-green-500/20 rounded-lg text-xs text-green-400">
                              TTS: {d.tts_provider}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Recording */}
            {call.recording_url && (
              <div className="bg-white/[0.03] border border-white/5 rounded-xl p-5">
                <h3 className="text-sm font-medium text-white/60 uppercase tracking-wider mb-3">Recording</h3>
                <div className="flex items-center gap-3">
                  <button
                    onClick={togglePlayback}
                    className="w-10 h-10 rounded-full bg-purple-500/20 border border-purple-500/30 flex items-center justify-center hover:bg-purple-500/30 transition-colors"
                  >
                    {isPlaying ? <Pause size={18} className="text-purple-400" /> : <Play size={18} className="text-purple-400 ml-0.5" />}
                  </button>
                  <div className="flex-1">
                    <p className="text-sm text-white">Call Recording</p>
                    <p className="text-xs text-white/40">{formatDuration(call.duration_seconds)}</p>
                  </div>
                </div>
              </div>
            )}

            {/* Transcript */}
            <div className="bg-white/[0.03] border border-white/5 rounded-xl p-5">
              <div className="flex items-center gap-2 mb-4">
                <MessageSquare size={16} className="text-purple-400" />
                <h3 className="text-sm font-medium text-white/60 uppercase tracking-wider">Transcript</h3>
                {transcript.length > 0 && (
                  <span className="text-xs text-white/30 ml-auto">{transcript.length} messages</span>
                )}
              </div>

              {isLoadingTranscript ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-5 h-5 text-purple-500 animate-spin" />
                </div>
              ) : transcript.length === 0 ? (
                <div className="text-center py-8">
                  <MessageSquare size={32} className="mx-auto text-white/10 mb-3" />
                  <p className="text-sm text-white/30">No transcript available</p>
                  <p className="text-xs text-white/20 mt-1">Transcripts are saved for new calls</p>
                </div>
              ) : (
                <div className="space-y-3 max-h-[500px] overflow-y-auto pr-2">
                  {transcript.map((entry, i) => (
                    <div key={i} className={`flex gap-3 ${entry.role === 'user' ? '' : 'flex-row-reverse'}`}>
                      <div className={`w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center ${
                        entry.role === 'user'
                          ? 'bg-blue-500/20 border border-blue-500/30'
                          : entry.role === 'tool'
                          ? 'bg-orange-500/20 border border-orange-500/30'
                          : 'bg-purple-500/20 border border-purple-500/30'
                      }`}>
                        {entry.role === 'user' ? (
                          <User size={14} className="text-blue-400" />
                        ) : entry.role === 'tool' ? (
                          <Cpu size={14} className="text-orange-400" />
                        ) : (
                          <Bot size={14} className="text-purple-400" />
                        )}
                      </div>
                      <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 ${
                        entry.role === 'user'
                          ? 'bg-blue-500/10 border border-blue-500/20'
                          : entry.role === 'tool'
                          ? 'bg-orange-500/10 border border-orange-500/20'
                          : 'bg-purple-500/10 border border-purple-500/20'
                      }`}>
                        <p className="text-sm text-white/90 leading-relaxed">{entry.content}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
