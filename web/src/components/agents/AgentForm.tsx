import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Save, X, Bot, MessageSquare, Settings, Zap, Clock, Phone, Wrench } from 'lucide-react';
import type { Agent, CreateAgentRequest } from '../../lib/supabase-types';
import { useProviders } from '../../hooks/useProviders';
import { Select } from '../ui/Select';
import { AgentToolsManager } from './AgentToolsManager';
import { VoiceSelector } from './VoiceSelector';

interface AgentFormProps {
  agent?: Agent;
  onSubmit: (data: any) => Promise<void>;
  onCancel: () => void;
  isLoading?: boolean;
}

export function AgentForm({ agent, onSubmit, onCancel, isLoading }: AgentFormProps) {
  const { getProvidersByType, isLoading: providersLoading } = useProviders();
  
  const [formData, setFormData] = useState<CreateAgentRequest>({
    name: agent?.name || '',
    slug: agent?.slug || '',
    description: agent?.description || '',
    system_prompt: agent?.system_prompt || '',
    language: agent?.language || 'en-IN',
    voice_id: agent?.voice_id || '',
    first_message: agent?.first_message || '',
    end_call_phrases: agent?.end_call_phrases || ['goodbye', 'bye', 'thank you'],
    stt_provider: agent?.stt_provider || 'sarvam',
    stt_config: agent?.stt_config || {},
    tts_provider: agent?.tts_provider || 'cartesia',
    tts_config: agent?.tts_config || { language: 'en-IN' },
    llm_provider: agent?.llm_provider || 'gemini-flash',
    llm_config: agent?.llm_config || { model: 'gemini-2.5-flash', temperature: 0.7 },
    interruption_sensitivity: agent?.interruption_sensitivity ?? 0.5,
    silence_timeout_ms: agent?.silence_timeout_ms ?? 5000,
    max_call_duration_seconds: agent?.max_call_duration_seconds ?? 600,
    tools_config: agent?.tools_config || [],
  });

  const [activeTab, setActiveTab] = useState<'basic' | 'providers' | 'behavior' | 'tools' | 'advanced'>('basic');
  const [endCallPhrase, setEndCallPhrase] = useState('');

  // Check if form has changes
  const hasChanges = useMemo(() => {
    if (!agent) return true; // New agent, always allow submit

    // Compare all fields
    return (
      formData.name !== agent.name ||
      formData.slug !== (agent.slug || '') ||
      formData.description !== (agent.description || '') ||
      formData.system_prompt !== (agent.system_prompt || '') ||
      formData.language !== agent.language ||
      formData.voice_id !== (agent.voice_id || '') ||
      formData.first_message !== (agent.first_message || '') ||
      JSON.stringify(formData.end_call_phrases) !== JSON.stringify(agent.end_call_phrases) ||
      formData.stt_provider !== agent.stt_provider ||
      JSON.stringify(formData.stt_config) !== JSON.stringify(agent.stt_config) ||
      formData.tts_provider !== agent.tts_provider ||
      JSON.stringify(formData.tts_config) !== JSON.stringify(agent.tts_config) ||
      formData.llm_provider !== agent.llm_provider ||
      JSON.stringify(formData.llm_config) !== JSON.stringify(agent.llm_config) ||
      formData.interruption_sensitivity !== agent.interruption_sensitivity ||
      formData.silence_timeout_ms !== agent.silence_timeout_ms ||
      formData.max_call_duration_seconds !== agent.max_call_duration_seconds ||
      JSON.stringify(formData.tools_config) !== JSON.stringify(agent.tools_config)
    );
  }, [formData, agent]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSubmit(formData);
  };

  const updateField = <K extends keyof CreateAgentRequest>(field: K, value: CreateAgentRequest[K]) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const addEndCallPhrase = () => {
    if (endCallPhrase.trim() && !formData.end_call_phrases?.includes(endCallPhrase.trim())) {
      updateField('end_call_phrases', [...(formData.end_call_phrases || []), endCallPhrase.trim()]);
      setEndCallPhrase('');
    }
  };

  const removeEndCallPhrase = (phrase: string) => {
    updateField('end_call_phrases', formData.end_call_phrases?.filter(p => p !== phrase) || []);
  };

  const tabs = [
    { id: 'basic' as const, label: 'Basic Info', icon: Bot },
    { id: 'providers' as const, label: 'AI Providers', icon: Zap },
    { id: 'behavior' as const, label: 'Behavior', icon: MessageSquare },
    { id: 'tools' as const, label: 'Tools', icon: Wrench, requiresAgent: true },
    { id: 'advanced' as const, label: 'Advanced', icon: Settings },
  ];

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white mb-1">
            {agent ? 'Edit Agent' : 'Create New Agent'}
          </h2>
          <p className="text-white/50">Configure your AI voice agent</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl font-medium text-white hover:bg-white/10 transition-all flex items-center gap-2"
          >
            <X size={18} />
            Cancel
          </button>
          <button
            type="submit"
            disabled={isLoading || !hasChanges}
            className="px-4 py-2.5 bg-gradient-to-r from-purple-600 to-purple-500 rounded-xl font-medium text-white hover:from-purple-500 hover:to-purple-400 transition-all duration-300 shadow-lg shadow-purple-500/25 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {isLoading ? (
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <Save size={18} />
            )}
            {agent ? 'Update Agent' : 'Create Agent'}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-white/10">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-3 font-medium transition-all flex items-center gap-2 border-b-2 ${
              activeTab === tab.id
                ? 'text-purple-400 border-purple-500'
                : 'text-white/50 border-transparent hover:text-white/70'
            }`}
          >
            <tab.icon size={18} />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Form Content */}
      <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-6">
        {/* Basic Info Tab */}
        {activeTab === 'basic' && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-5"
          >
            <div className="grid md:grid-cols-2 gap-5">
              <div>
                <label className="block text-sm text-white/60 mb-2">
                  Agent Name <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => updateField('name', e.target.value)}
                  placeholder="e.g., Customer Support Agent"
                  required
                  className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/30 focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/20 transition-all"
                />
              </div>

              <div>
                <label className="block text-sm text-white/60 mb-2">Slug (URL-friendly name)</label>
                <input
                  type="text"
                  value={formData.slug}
                  onChange={(e) => updateField('slug', e.target.value)}
                  placeholder="e.g., customer-support"
                  className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/30 focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/20 transition-all"
                />
                <p className="text-xs text-white/40 mt-1">Leave empty to auto-generate from name</p>
              </div>
            </div>

            <div>
              <label className="block text-sm text-white/60 mb-2">Description</label>
              <textarea
                value={formData.description}
                onChange={(e) => updateField('description', e.target.value)}
                placeholder="Brief description of what this agent does..."
                rows={3}
                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/30 focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/20 transition-all resize-none"
              />
            </div>

            <div>
              <label className="block text-sm text-white/60 mb-2">
                System Prompt <span className="text-red-400">*</span>
              </label>
              <textarea
                value={formData.system_prompt}
                onChange={(e) => updateField('system_prompt', e.target.value)}
                placeholder="You are a helpful AI assistant..."
                rows={8}
                required
                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/30 focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/20 transition-all resize-none font-mono text-sm"
              />
              <p className="text-xs text-white/40 mt-1">
                Define the agent's personality, role, and behavior guidelines
              </p>
            </div>

          </motion.div>
        )}

        {/* AI Providers Tab */}
        {activeTab === 'providers' && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-6"
          >
            {/* LLM Provider */}
            <div className="bg-white/5 rounded-xl p-5 space-y-4">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-8 h-8 rounded-lg bg-blue-500/20 flex items-center justify-center">
                  <Zap size={16} className="text-blue-400" />
                </div>
                <h3 className="font-semibold text-white">LLM (Language Model)</h3>
              </div>

              <div>
                <label className="block text-sm text-white/60 mb-2">Provider</label>
                <Select
                  value={formData.llm_provider || ''}
                  onChange={(value) => updateField('llm_provider', value)}
                  options={getProvidersByType('llm').map(p => ({
                    value: p.slug,
                    label: p.display_name || p.name,
                    description: p.description,
                  }))}
                  placeholder="Select LLM provider"
                  disabled={providersLoading}
                />
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-white/60 mb-2">Model</label>
                  <input
                    type="text"
                    value={(formData.llm_config as any)?.model || 'gemini-2.5-flash'}
                    onChange={(e) =>
                      updateField('llm_config', { ...formData.llm_config, model: e.target.value })
                    }
                    className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/30 focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/20 transition-all"
                  />
                </div>

                <div>
                  <label className="block text-sm text-white/60 mb-2">Temperature</label>
                  <input
                    type="number"
                    min="0"
                    max="2"
                    step="0.1"
                    value={(formData.llm_config as any)?.temperature || 0.7}
                    onChange={(e) =>
                      updateField('llm_config', {
                        ...formData.llm_config,
                        temperature: parseFloat(e.target.value),
                      })
                    }
                    className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/30 focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/20 transition-all"
                  />
                </div>
              </div>
            </div>

            {/* TTS Provider */}
            <div className="bg-white/5 rounded-xl p-5 space-y-4">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-8 h-8 rounded-lg bg-green-500/20 flex items-center justify-center">
                  <Phone size={16} className="text-green-400" />
                </div>
                <h3 className="font-semibold text-white">TTS (Text-to-Speech)</h3>
              </div>

              <div>
                <label className="block text-sm text-white/60 mb-2">Provider</label>
                <Select
                  value={formData.tts_provider || ''}
                  onChange={(value) => updateField('tts_provider', value)}
                  options={getProvidersByType('tts').map(p => ({
                    value: p.slug,
                    label: p.display_name || p.name,
                    description: p.description,
                  }))}
                  placeholder="Select TTS provider"
                  disabled={providersLoading}
                />
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-white/60 mb-2">Language</label>
                  <select
                    value={formData.language}
                    onChange={(e) => updateField('language', e.target.value)}
                    className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/20 transition-all"
                  >
                    <option value="en-IN">English (India)</option>
                    <option value="hi-IN">Hindi</option>
                    <option value="ta-IN">Tamil</option>
                    <option value="te-IN">Telugu</option>
                    <option value="bn-IN">Bengali</option>
                    <option value="mr-IN">Marathi</option>
                    <option value="gu-IN">Gujarati</option>
                    <option value="kn-IN">Kannada</option>
                    <option value="ml-IN">Malayalam</option>
                    <option value="pa-IN">Punjabi</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm text-white/60 mb-2">TTS Language Code</label>
                  <input
                    type="text"
                    value={(formData.tts_config as any)?.language || 'en-IN'}
                    onChange={(e) =>
                      updateField('tts_config', { ...formData.tts_config, language: e.target.value })
                    }
                    placeholder="e.g., en-IN, hi-IN"
                    className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/30 focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/20 transition-all"
                  />
                  <p className="text-xs text-white/40 mt-1">Provider-specific language code</p>
                </div>
              </div>

              <VoiceSelector
                provider={formData.tts_provider || 'cartesia'}
                selectedVoiceId={formData.voice_id || ''}
                onVoiceChange={(voiceId) => updateField('voice_id', voiceId)}
              />
            </div>

            {/* STT Provider */}
            <div className="bg-white/5 rounded-xl p-5 space-y-4">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-8 h-8 rounded-lg bg-orange-500/20 flex items-center justify-center">
                  <MessageSquare size={16} className="text-orange-400" />
                </div>
                <h3 className="font-semibold text-white">STT (Speech-to-Text)</h3>
              </div>

              <div>
                <label className="block text-sm text-white/60 mb-2">Provider</label>
                <Select
                  value={formData.stt_provider || ''}
                  onChange={(value) => updateField('stt_provider', value)}
                  options={getProvidersByType('stt').map(p => ({
                    value: p.slug,
                    label: p.display_name || p.name,
                    description: p.description,
                  }))}
                  placeholder="Select STT provider"
                  disabled={providersLoading}
                />
              </div>
            </div>
          </motion.div>
        )}

        {/* Behavior Tab */}
        {activeTab === 'behavior' && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-5"
          >
            <div>
              <label className="block text-sm text-white/60 mb-2">First Message</label>
              <textarea
                value={formData.first_message}
                onChange={(e) => updateField('first_message', e.target.value)}
                placeholder="Hello! How can I help you today?"
                rows={3}
                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/30 focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/20 transition-all resize-none"
              />
              <p className="text-xs text-white/40 mt-1">The agent's greeting message</p>
            </div>

            <div>
              <label className="block text-sm text-white/60 mb-2">End Call Phrases</label>
              <div className="flex gap-2 mb-2">
                <input
                  type="text"
                  value={endCallPhrase}
                  onChange={(e) => setEndCallPhrase(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), addEndCallPhrase())}
                  placeholder="Add a phrase..."
                  className="flex-1 px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/30 focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/20 transition-all"
                />
                <button
                  type="button"
                  onClick={addEndCallPhrase}
                  className="px-4 py-3 bg-purple-500/10 border border-purple-500/20 rounded-xl text-purple-400 hover:bg-purple-500/20 transition-all"
                >
                  Add
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {formData.end_call_phrases?.map((phrase) => (
                  <span
                    key={phrase}
                    className="px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-sm text-white flex items-center gap-2"
                  >
                    {phrase}
                    <button
                      type="button"
                      onClick={() => removeEndCallPhrase(phrase)}
                      className="text-white/40 hover:text-red-400 transition-colors"
                    >
                      <X size={14} />
                    </button>
                  </span>
                ))}
              </div>
              <p className="text-xs text-white/40 mt-2">
                Phrases that trigger call termination
              </p>
            </div>

            <div>
              <label className="block text-sm text-white/60 mb-2">
                Interruption Sensitivity: {formData.interruption_sensitivity}
              </label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.1"
                value={formData.interruption_sensitivity}
                onChange={(e) => updateField('interruption_sensitivity', parseFloat(e.target.value))}
                className="w-full h-2 bg-white/10 rounded-lg appearance-none cursor-pointer accent-purple-500"
              />
              <div className="flex justify-between text-xs text-white/40 mt-1">
                <span>Less sensitive</span>
                <span>More sensitive</span>
              </div>
            </div>
          </motion.div>
        )}

        {/* Tools Tab */}
        {activeTab === 'tools' && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-5"
          >
            {agent ? (
              <AgentToolsManager agentId={agent.id} />
            ) : (
              <div className="text-center py-12">
                <Wrench size={48} className="text-white/20 mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-white mb-2">Save Agent First</h3>
                <p className="text-white/50 max-w-md mx-auto">
                  You need to create and save the agent before you can configure tools.
                  Complete the basic setup first, then come back to add tools.
                </p>
              </div>
            )}
          </motion.div>
        )}

        {/* Advanced Tab */}
        {activeTab === 'advanced' && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-5"
          >
            <div className="grid md:grid-cols-2 gap-5">
              <div>
                <label className="block text-sm text-white/60 mb-2">
                  Silence Timeout (ms)
                </label>
                <input
                  type="number"
                  min="1000"
                  max="30000"
                  step="1000"
                  value={formData.silence_timeout_ms}
                  onChange={(e) => updateField('silence_timeout_ms', parseInt(e.target.value))}
                  className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/30 focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/20 transition-all"
                />
                <p className="text-xs text-white/40 mt-1">
                  Time to wait before ending call due to silence
                </p>
              </div>

              <div>
                <label className="block text-sm text-white/60 mb-2">
                  Max Call Duration (seconds)
                </label>
                <input
                  type="number"
                  min="60"
                  max="3600"
                  step="60"
                  value={formData.max_call_duration_seconds}
                  onChange={(e) => updateField('max_call_duration_seconds', parseInt(e.target.value))}
                  className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/30 focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/20 transition-all"
                />
                <p className="text-xs text-white/40 mt-1">
                  Maximum duration for a single call
                </p>
              </div>
            </div>

            <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-xl p-4">
              <div className="flex items-start gap-3">
                <Clock size={20} className="text-yellow-400 flex-shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-medium text-yellow-400 mb-1">Advanced Settings</h4>
                  <p className="text-sm text-yellow-400/80">
                    These settings control call behavior and timeouts. Adjust carefully as they
                    affect user experience and costs.
                  </p>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </div>
    </form>
  );
}
