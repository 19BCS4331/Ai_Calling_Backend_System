import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, Loader, History, Play, Pause, X, Phone } from 'lucide-react';
import { AgentForm } from '../../components/agents/AgentForm';
import { VersionHistory } from '../../components/agents/VersionHistory';
import { AgentTestCall } from '../../components/agents/AgentTestCall';
import { useAgents } from '../../hooks/useAgents';
import { supabase } from '../../lib/supabase';
import { useOrganizationStore } from '../../store/organization';
import type { Agent, UpdateAgentRequest } from '../../lib/supabase-types';

export function AgentDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { currentOrganization } = useOrganizationStore();
  const { updateAgent, publishAgent } = useAgents();
  const [agent, setAgent] = useState<Agent | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'edit' | 'test' | 'versions'>('edit');
  const [showPublishDialog, setShowPublishDialog] = useState(false);
  const [changeSummary, setChangeSummary] = useState('');
  const [isPublishing, setIsPublishing] = useState(false);

  useEffect(() => {
    if (id && currentOrganization) {
      fetchAgent();
    }
  }, [id, currentOrganization?.id]);

  const fetchAgent = async () => {
    if (!id || !currentOrganization) return;

    try {
      setIsLoading(true);
      setError(null);

      const { data, error: fetchError } = await supabase
        .from('agents')
        .select('*')
        .eq('id', id)
        .eq('organization_id', currentOrganization.id)
        .single();

      if (fetchError) throw fetchError;

      setAgent(data as Agent);
    } catch (err) {
      console.error('Failed to fetch agent:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch agent');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = async (data: UpdateAgentRequest) => {
    if (!id) return;

    try {
      setIsSaving(true);
      // Create snapshot when updating to track version history
      await updateAgent(id, data, true);
      // Stay on the same page after successful update
      fetchAgent();
      setIsSaving(false);
    } catch (err) {
      console.error('Failed to update agent:', err);
      setError(err instanceof Error ? err.message : 'Failed to update agent');
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    navigate('/dashboard/agents');
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <Loader size={32} className="text-purple-500 animate-spin mx-auto mb-4" />
          <p className="text-white/50">Loading agent...</p>
        </div>
      </div>
    );
  }

  if (error || !agent) {
    return (
      <div className="space-y-6">
        <button
          onClick={() => navigate('/dashboard/agents')}
          className="flex items-center gap-2 text-white/60 hover:text-white transition-colors"
        >
          <ArrowLeft size={18} />
          Back to Agents
        </button>

        <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-8 text-center">
          <h3 className="text-lg font-semibold text-red-400 mb-2">Error Loading Agent</h3>
          <p className="text-red-400/80">{error || 'Agent not found'}</p>
        </div>
      </div>
    );
  }

  const handlePublish = async () => {
    if (!id) return;

    try {
      setIsPublishing(true);
      await publishAgent(id, changeSummary || undefined);
      setShowPublishDialog(false);
      setChangeSummary('');
      await fetchAgent();
    } catch (err) {
      console.error('Failed to publish agent:', err);
      setError(err instanceof Error ? err.message : 'Failed to publish agent');
    } finally {
      setIsPublishing(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <button
          onClick={() => navigate('/dashboard/agents')}
          className="flex items-center gap-2 text-white/60 hover:text-white transition-colors"
        >
          <ArrowLeft size={18} />
          Back to Agents
        </button>

        <div className="flex items-center gap-3">
          {agent?.status === 'draft' && (
            <button
              onClick={() => setShowPublishDialog(true)}
              className="px-4 py-2.5 bg-gradient-to-r from-green-600 to-green-500 rounded-xl font-medium text-white hover:from-green-500 hover:to-green-400 transition-all duration-300 shadow-lg shadow-green-500/25 flex items-center gap-2"
            >
              <Play size={18} />
              Publish Agent
            </button>
          )}

          {agent?.status === 'paused' && (
            <button
              onClick={async () => {
                try {
                  await updateAgent(id!, { status: 'active' });
                  await fetchAgent();
                } catch (err) {
                  console.error('Failed to resume agent:', err);
                  setError(err instanceof Error ? err.message : 'Failed to resume agent');
                }
              }}
              className="px-4 py-2.5 bg-gradient-to-r from-green-600 to-green-500 rounded-xl font-medium text-white hover:from-green-500 hover:to-green-400 transition-all duration-300 shadow-lg shadow-green-500/25 flex items-center gap-2"
            >
              <Play size={18} />
              Resume Agent
            </button>
          )}

          {agent?.status === 'active' && (
            <button
              onClick={async () => {
                try {
                  await updateAgent(id!, { status: 'paused' });
                  await fetchAgent();
                } catch (err) {
                  console.error('Failed to pause agent:', err);
                  setError(err instanceof Error ? err.message : 'Failed to pause agent');
                }
              }}
              className="px-4 py-2.5 bg-orange-500 rounded-xl font-medium text-white hover:bg-orange-600 transition-all duration-300 flex items-center gap-2"
            >
              <Pause size={18} />
              Pause Agent
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-white/10">
        <button
          onClick={() => setActiveTab('edit')}
          className={`px-4 py-3 font-medium transition-all border-b-2 ${
            activeTab === 'edit'
              ? 'text-purple-400 border-purple-500'
              : 'text-white/50 border-transparent hover:text-white/70'
          }`}
        >
          Edit Configuration
        </button>
        <button
          onClick={() => setActiveTab('test')}
          className={`px-4 py-3 font-medium transition-all flex items-center gap-2 border-b-2 ${
            activeTab === 'test'
              ? 'text-purple-400 border-purple-500'
              : 'text-white/50 border-transparent hover:text-white/70'
          }`}
        >
          <Phone size={18} />
          Test Call
        </button>
        <button
          onClick={() => setActiveTab('versions')}
          className={`px-4 py-3 font-medium transition-all flex items-center gap-2 border-b-2 ${
            activeTab === 'versions'
              ? 'text-purple-400 border-purple-500'
              : 'text-white/50 border-transparent hover:text-white/70'
          }`}
        >
          <History size={18} />
          Version History
        </button>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        {activeTab === 'edit' ? (
          <AgentForm
            agent={agent}
            onSubmit={handleSubmit}
            onCancel={handleCancel}
            isLoading={isSaving}
          />
        ) : activeTab === 'test' ? (
          <AgentTestCall agent={agent} />
        ) : (
          <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-6">
            <h3 className="text-lg font-semibold text-white mb-4">Version History</h3>
            <VersionHistory
              agentId={id!}
              currentVersion={agent.version}
              publishedVersion={agent.published_version}
              onRollback={fetchAgent}
            />
          </div>
        )}
      </motion.div>

      {/* Publish Dialog */}
      {showPublishDialog && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-[#0a0a0f] border border-white/10 rounded-2xl p-6 max-w-md w-full"
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold text-white">Publish Agent</h3>
              <button
                onClick={() => setShowPublishDialog(false)}
                className="text-white/40 hover:text-white transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            <p className="text-white/60 text-sm mb-4">
              Publishing will activate this agent and create a version snapshot. You can rollback to this version later if needed.
            </p>

            <div className="mb-6">
              <label className="block text-sm text-white/60 mb-2">
                Change Summary (optional)
              </label>
              <textarea
                value={changeSummary}
                onChange={(e) => setChangeSummary(e.target.value)}
                placeholder="Describe what changed in this version..."
                rows={3}
                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/30 focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/20 transition-all resize-none"
              />
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setShowPublishDialog(false)}
                disabled={isPublishing}
                className="flex-1 px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl font-medium text-white hover:bg-white/10 transition-all disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handlePublish}
                disabled={isPublishing}
                className="flex-1 px-4 py-2.5 bg-gradient-to-r from-green-600 to-green-500 rounded-xl font-medium text-white hover:from-green-500 hover:to-green-400 transition-all duration-300 shadow-lg shadow-green-500/25 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {isPublishing ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Publishing...
                  </>
                ) : (
                  <>
                    <Play size={18} />
                    Publish
                  </>
                )}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}
