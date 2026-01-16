import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft } from 'lucide-react';
import { AgentForm } from '../../components/agents/AgentForm';
import { useAgents } from '../../hooks/useAgents';
import type { CreateAgentRequest } from '../../lib/supabase-types';

export function AgentNew() {
  const navigate = useNavigate();
  const { createAgent } = useAgents();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (data: CreateAgentRequest) => {
    try {
      setIsLoading(true);
      setError(null);
      await createAgent(data);
      navigate('/dashboard/agents');
    } catch (err) {
      console.error('Failed to create agent:', err);
      setError(err instanceof Error ? err.message : 'Failed to create agent');
      setIsLoading(false);
    }
  };

  const handleCancel = () => {
    navigate('/dashboard/agents');
  };

  return (
    <div className="space-y-6">
      <button
        onClick={() => navigate('/dashboard/agents')}
        className="flex items-center gap-2 text-white/60 hover:text-white transition-colors"
      >
        <ArrowLeft size={18} />
        Back to Agents
      </button>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4">
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <AgentForm
          onSubmit={handleSubmit}
          onCancel={handleCancel}
          isLoading={isLoading}
        />
      </motion.div>
    </div>
  );
}
