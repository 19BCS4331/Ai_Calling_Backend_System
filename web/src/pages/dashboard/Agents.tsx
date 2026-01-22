import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Bot, Plus, Search, Filter, Play, Pause, Archive, Edit, BarChart3 } from 'lucide-react';
import { useAgents } from '../../hooks/useAgents';
import { useAlert } from '../../hooks/useAlert';
import type { AgentStatus } from '../../lib/supabase-types';

export function Agents() {
  const navigate = useNavigate();
  const { showError } = useAlert();
  const [statusFilter, setStatusFilter] = useState<AgentStatus | undefined>();
  const [searchQuery, setSearchQuery] = useState('');
  const { agents, isLoading, publishAgent, pauseAgent, deleteAgent, updateAgent } = useAgents(statusFilter);

  const filteredAgents = agents.filter(agent =>
    agent.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    agent.description?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const getStatusColor = (status: AgentStatus) => {
    switch (status) {
      case 'active':
        return 'bg-green-500/10 text-green-400 border-green-500/20';
      case 'draft':
        return 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20';
      case 'paused':
        return 'bg-orange-500/10 text-orange-400 border-orange-500/20';
      case 'archived':
        return 'bg-gray-500/10 text-gray-400 border-gray-500/20';
      default:
        return 'bg-white/5 text-white/50 border-white/10';
    }
  };

  const handlePublish = async (agentId: string) => {
    const summary = prompt('Enter a change summary (optional):');
    try {
      await publishAgent(agentId, summary || undefined);
    } catch (error) {
      console.error('Failed to publish agent:', error);
      showError('Failed to publish agent: ' + (error instanceof Error ? error.message : 'Unknown error'));
    }
  };

  const handlePause = async (agentId: string) => {
    try {
      await pauseAgent(agentId);
    } catch (error) {
      console.error('Failed to pause agent:', error);
    }
  };

  const handleResume = async (agentId: string) => {
    try {
      await updateAgent(agentId, { status: 'active' });
    } catch (error) {
      console.error('Failed to resume agent:', error);
    }
  };

  const handleArchive = async (agentId: string) => {
    if (confirm('Are you sure you want to archive this agent?')) {
      try {
        await deleteAgent(agentId);
      } catch (error) {
        console.error('Failed to archive agent:', error);
      }
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white mb-1">Voice Agents</h1>
          <p className="text-white/50">Manage your AI voice agents</p>
        </div>
        <button
          onClick={() => navigate('/dashboard/agents/new')}
          className="px-4 py-2.5 bg-gradient-to-r from-purple-600 to-purple-500 rounded-xl font-medium text-white hover:from-purple-500 hover:to-purple-400 transition-all duration-300 shadow-lg shadow-purple-500/25 flex items-center gap-2"
        >
          <Plus size={18} />
          Create Agent
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        {/* Search */}
        <div className="flex-1 relative">
          <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search agents..."
            className="w-full pl-11 pr-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/30 focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/20 transition-all"
          />
        </div>

        {/* Status Filter */}
        <div className="relative">
          <Filter size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30" />
          <select
            value={statusFilter || ''}
            onChange={(e) => setStatusFilter(e.target.value as AgentStatus || undefined)}
            className="pl-11 pr-10 py-3 bg-white/5 border border-white/10 rounded-xl text-white focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/20 transition-all appearance-none cursor-pointer"
          >
            <option value="">All Status</option>
            <option value="draft">Draft</option>
            <option value="active">Active</option>
            <option value="paused">Paused</option>
            <option value="archived">Archived</option>
          </select>
        </div>
      </div>

      {/* Agents Grid */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="w-8 h-8 border-2 border-purple-500/30 border-t-purple-500 rounded-full animate-spin" />
        </div>
      ) : filteredAgents.length === 0 ? (
        <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-12 text-center">
          <Bot size={48} className="mx-auto text-white/20 mb-4" />
          <h3 className="text-lg font-semibold text-white mb-2">No agents found</h3>
          <p className="text-white/50 mb-6">
            {searchQuery || statusFilter
              ? 'Try adjusting your filters'
              : 'Create your first AI voice agent to get started'}
          </p>
          {!searchQuery && !statusFilter && (
            <button
              onClick={() => navigate('/dashboard/agents/new')}
              className="px-6 py-3 bg-gradient-to-r from-purple-600 to-purple-500 rounded-xl font-medium text-white hover:from-purple-500 hover:to-purple-400 transition-all duration-300 shadow-lg shadow-purple-500/25 inline-flex items-center gap-2"
            >
              <Plus size={18} />
              Create Agent
            </button>
          )}
        </div>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredAgents.map((agent) => (
            <motion.div
              key={agent.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white/[0.02] border border-white/5 rounded-2xl p-6 hover:bg-white/[0.04] transition-all group"
            >
              {/* Header */}
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
                    <Bot size={20} className="text-white" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-white">{agent.name}</h3>
                    <p className="text-xs text-white/40">{agent.slug}</p>
                  </div>
                </div>
                <span className={`px-2 py-1 rounded-lg text-xs font-medium border ${getStatusColor(agent.status)}`}>
                  {agent.status}
                </span>
              </div>

              {/* Description */}
              {agent.description && (
                <p className="text-sm text-white/60 mb-4 line-clamp-2">{agent.description}</p>
              )}

              {/* Config Info */}
              <div className="grid grid-cols-2 gap-2 mb-4 text-xs">
                <div className="bg-white/5 rounded-lg p-2">
                  <p className="text-white/40 mb-0.5">Language</p>
                  <p className="text-white font-medium">{agent.language}</p>
                </div>
                <div className="bg-white/5 rounded-lg p-2">
                  <p className="text-white/40 mb-0.5">Version</p>
                  <p className="text-white font-medium">
                    v{agent.published_version || agent.version}
                    {agent.status === 'draft' && ' (draft)'}
                  </p>
                </div>
              </div>

              {/* Providers */}
              <div className="flex flex-wrap gap-1 mb-4">
                <span className="px-2 py-1 bg-blue-500/10 text-blue-400 rounded text-xs">
                  {agent.llm_provider}
                </span>
                <span className="px-2 py-1 bg-green-500/10 text-green-400 rounded text-xs">
                  {agent.tts_provider}
                </span>
                <span className="px-2 py-1 bg-orange-500/10 text-orange-400 rounded text-xs">
                  {agent.stt_provider}
                </span>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 pt-4 border-t border-white/5">
                <button
                  onClick={() => navigate(`/dashboard/agents/${agent.id}`)}
                  className="flex-1 px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm font-medium text-white hover:bg-white/10 transition-all flex items-center justify-center gap-2"
                >
                  <Edit size={14} />
                  Edit
                </button>

                {agent.status === 'draft' && (
                  <button
                    onClick={() => handlePublish(agent.id)}
                    className="px-3 py-2 bg-green-500/10 border border-green-500/20 rounded-lg text-sm font-medium text-green-400 hover:bg-green-500/20 transition-all"
                    title="Publish"
                  >
                    <Play size={14} />
                  </button>
                )}

                {agent.status === 'active' && (
                  <button
                    onClick={() => handlePause(agent.id)}
                    className="px-3 py-2 bg-orange-500/10 border border-orange-500/20 rounded-lg text-sm font-medium text-orange-400 hover:bg-orange-500/20 transition-all"
                    title="Pause"
                  >
                    <Pause size={14} />
                  </button>
                )}

                {agent.status === 'paused' && (
                  <button
                    onClick={() => handleResume(agent.id)}
                    className="px-3 py-2 bg-green-500/10 border border-green-500/20 rounded-lg text-sm font-medium text-green-400 hover:bg-green-500/20 transition-all"
                    title="Resume"
                  >
                    <Play size={14} />
                  </button>
                )}

                <button
                  onClick={() => navigate(`/dashboard/agents/${agent.id}/stats`)}
                  className="px-3 py-2 bg-purple-500/10 border border-purple-500/20 rounded-lg text-sm font-medium text-purple-400 hover:bg-purple-500/20 transition-all"
                  title="Stats"
                >
                  <BarChart3 size={14} />
                </button>

                <button
                  onClick={() => handleArchive(agent.id)}
                  className="px-3 py-2 bg-red-500/10 border border-red-500/20 rounded-lg text-sm font-medium text-red-400 hover:bg-red-500/20 transition-all"
                  title="Archive"
                >
                  <Archive size={14} />
                </button>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
