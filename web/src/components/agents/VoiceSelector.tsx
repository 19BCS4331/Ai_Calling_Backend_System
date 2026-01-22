import { useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, Loader, Volume2, Edit3, Search, X } from 'lucide-react';
import { supabase } from '../../lib/supabase';

// Cache configuration
const CACHE_KEY = 'cartesia_voices_cache';
const CACHE_DURATION = 1000 * 60 * 60; // 1 hour

// Sarvam TTS speakers (static list)
const SARVAM_SPEAKERS: Voice[] = [
  { id: 'anushka', name: 'Anushka', description: 'Female voice', language: 'hi-IN' },
  { id: 'manisha', name: 'Manisha', description: 'Female voice', language: 'hi-IN' },
  { id: 'vidya', name: 'Vidya', description: 'Female voice', language: 'hi-IN' },
  { id: 'arya', name: 'Arya', description: 'Female voice', language: 'hi-IN' },
  { id: 'abhilash', name: 'Abhilash', description: 'Male voice', language: 'hi-IN' },
  { id: 'karun', name: 'Karun', description: 'Male voice', language: 'hi-IN' },
  { id: 'hitesh', name: 'Hitesh', description: 'Male voice', language: 'hi-IN' },
];

interface Voice {
  id: string;
  name: string;
  description?: string;
  language?: string;
  is_public?: boolean;
}

interface VoiceCache {
  voices: Voice[];
  timestamp: number;
}

interface VoiceSelectorProps {
  provider: string;
  selectedVoiceId: string;
  onVoiceChange: (voiceId: string) => void;
}

function getCachedVoices(): Voice[] | null {
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (!cached) return null;
    
    const { voices, timestamp }: VoiceCache = JSON.parse(cached);
    if (Date.now() - timestamp > CACHE_DURATION) {
      localStorage.removeItem(CACHE_KEY);
      return null;
    }
    return voices;
  } catch {
    return null;
  }
}

function setCachedVoices(voices: Voice[]): void {
  try {
    const cache: VoiceCache = { voices, timestamp: Date.now() };
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Ignore storage errors
  }
}

export function VoiceSelector({ provider, selectedVoiceId, onVoiceChange }: VoiceSelectorProps) {
  const [voices, setVoices] = useState<Voice[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [manualMode, setManualMode] = useState(false);
  const [manualVoiceId, setManualVoiceId] = useState(selectedVoiceId);
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (manualMode) return;
    
    if (provider === 'sarvam') {
      // Load Sarvam speakers (static list)
      setVoices(SARVAM_SPEAKERS);
      setIsLoading(false);
      setError(null);
    } else if (provider === 'cartesia') {
      // Try to load from cache first
      const cached = getCachedVoices();
      if (cached && cached.length > 0) {
        setVoices(cached);
      } else {
        fetchCartesiaVoices();
      }
    } else {
      // Other providers - clear voices
      setVoices([]);
    }
  }, [provider, manualMode]);

  useEffect(() => {
    setManualVoiceId(selectedVoiceId);
  }, [selectedVoiceId]);

  // Focus search input when dropdown opens
  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      setTimeout(() => searchInputRef.current?.focus(), 100);
    }
    if (!isOpen) {
      setSearchQuery('');
    }
  }, [isOpen]);

  const fetchCartesiaVoices = async () => {
    setIsLoading(true);
    setError(null);

    try {
      // Get Supabase session for authentication
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        throw new Error('Not authenticated');
      }

      const apiUrl = import.meta.env.VITE_SAAS_API_URL || 'http://localhost:3001';
      const response = await fetch(`${apiUrl}/api/v1/providers/cartesia/voices`, {
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error?.message || errorData.message || `Failed to fetch voices: ${response.status}`);
      }

      const data = await response.json();
      const fetchedVoices = data.voices || [];
      setVoices(fetchedVoices);
      setCachedVoices(fetchedVoices);
    } catch (err) {
      console.error('Failed to fetch Cartesia voices:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch voices');
      setVoices([]);
    } finally {
      setIsLoading(false);
    }
  };

  const selectedVoice = voices.find(v => v.id === selectedVoiceId);

  // Filter voices based on search query
  const filteredVoices = useMemo(() => {
    if (!searchQuery.trim()) return voices;
    const query = searchQuery.toLowerCase();
    return voices.filter(voice => 
      voice.name.toLowerCase().includes(query) ||
      voice.description?.toLowerCase().includes(query) ||
      voice.language?.toLowerCase().includes(query)
    );
  }, [voices, searchQuery]);

  const handleManualSubmit = () => {
    if (manualVoiceId.trim()) {
      onVoiceChange(manualVoiceId.trim());
      setManualMode(false);
    }
  };

  // For providers without dropdown support or when manual mode is enabled
  const hasDropdownSupport = provider === 'cartesia' || provider === 'sarvam';
  
  if (!hasDropdownSupport || manualMode) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <label className="block text-sm text-white/60">Voice ID</label>
          {hasDropdownSupport && (
            <button
              type="button"
              onClick={() => setManualMode(false)}
              className="text-xs text-purple-400 hover:text-purple-300 transition-colors"
            >
              ← Back to voice list
            </button>
          )}
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={manualVoiceId}
            onChange={(e) => setManualVoiceId(e.target.value)}
            placeholder="Enter voice ID manually"
            className="flex-1 px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/30 focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/20 transition-all"
          />
          {manualVoiceId !== selectedVoiceId && (
            <button
              type="button"
              onClick={handleManualSubmit}
              className="px-4 py-3 bg-purple-600 hover:bg-purple-500 rounded-xl text-white font-medium transition-colors"
            >
              Apply
            </button>
          )}
        </div>
        <p className="text-xs text-white/40">
          {hasDropdownSupport
            ? `Enter a ${provider === 'cartesia' ? 'Cartesia voice ID' : 'Sarvam speaker name'} manually`
            : 'Enter the voice ID for your TTS provider'}
        </p>
      </div>
    );
  }

  // Voice selector with dropdown (Cartesia or Sarvam)
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="block text-sm text-white/60">Voice</label>
        <button
          type="button"
          onClick={() => setManualMode(true)}
          className="text-xs text-purple-400 hover:text-purple-300 transition-colors flex items-center gap-1"
        >
          <Edit3 size={12} />
          Enter manually
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-8 bg-white/5 rounded-xl border border-white/10">
          <Loader size={20} className="text-purple-400 animate-spin" />
          <span className="ml-2 text-sm text-white/50">Loading voices...</span>
        </div>
      ) : error ? (
        <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl">
          <p className="text-red-400 text-sm">{error}</p>
          <button
            type="button"
            onClick={() => setManualMode(true)}
            className="mt-2 text-xs text-purple-400 hover:text-purple-300 transition-colors"
          >
            Enter voice ID manually instead
          </button>
        </div>
      ) : (
        <div className="relative">
          <button
            type="button"
            onClick={() => setIsOpen(!isOpen)}
            className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-left flex items-center justify-between hover:bg-white/10 transition-all focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/20"
          >
            <div className="flex items-center gap-2">
              <Volume2 size={16} className="text-purple-400" />
              <div>
                <p className="text-white font-medium">
                  {selectedVoice?.name || 'Select a voice'}
                </p>
                {selectedVoice?.description && (
                  <p className="text-xs text-white/40 mt-0.5">{selectedVoice.description}</p>
                )}
              </div>
            </div>
            <ChevronDown
              size={18}
              className={`text-white/40 transition-transform ${isOpen ? 'rotate-180' : ''}`}
            />
          </button>

          <AnimatePresence>
            {isOpen && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="absolute z-10 w-full mt-2 bg-[#0A0A0A] border border-white/10 rounded-xl shadow-2xl overflow-hidden"
              >
                {/* Search Input */}
                <div className="p-2 border-b border-white/10 sticky top-0 bg-[#0A0A0A]">
                  <div className="relative">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
                    <input
                      ref={searchInputRef}
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search voices..."
                      className="w-full pl-9 pr-8 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder-white/40 focus:outline-none focus:border-purple-500/50"
                    />
                    {searchQuery && (
                      <button
                        type="button"
                        onClick={() => setSearchQuery('')}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/60"
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>
                </div>

                {/* Voice List */}
                <div className="max-h-64 overflow-y-auto">
                {filteredVoices.length === 0 ? (
                  <div className="p-4 text-center text-white/50 text-sm">
                    {searchQuery ? 'No voices match your search' : 'No voices available'}
                  </div>
                ) : (
                  filteredVoices.map((voice) => (
                    <button
                      key={voice.id}
                      type="button"
                      onClick={() => {
                        onVoiceChange(voice.id);
                        setIsOpen(false);
                      }}
                      className={`w-full px-4 py-3 text-left hover:bg-white/5 transition-colors border-b border-white/5 last:border-b-0 ${
                        voice.id === selectedVoiceId ? 'bg-purple-500/10' : ''
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-white font-medium truncate">{voice.name}</p>
                          {voice.description && (
                            <p className="text-xs text-white/50 mt-0.5 line-clamp-2">
                              {voice.description}
                            </p>
                          )}
                          <div className="flex items-center gap-2 mt-1">
                            {voice.language && (
                              <span className="text-xs text-white/40 px-2 py-0.5 bg-white/5 rounded">
                                {voice.language}
                              </span>
                            )}
                            {voice.is_public && (
                              <span className="text-xs text-green-400 px-2 py-0.5 bg-green-500/10 rounded">
                                Public
                              </span>
                            )}
                          </div>
                        </div>
                        {voice.id === selectedVoiceId && (
                          <div className="w-2 h-2 rounded-full bg-purple-500 mt-1.5" />
                        )}
                      </div>
                    </button>
                  ))
                )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {selectedVoice && (
        <div className="text-xs text-white/40">
          Voice ID: <code className="text-white/60">{selectedVoice.id}</code>
        </div>
      )}
    </div>
  );
}
