import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { ToolForm } from '../../components/tools/ToolForm';
import { useTools } from '../../hooks/useTools';
import type { CreateToolRequest } from '../../lib/supabase-types';

export function ToolNew() {
  const navigate = useNavigate();
  const { createTool } = useTools();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (data: CreateToolRequest) => {
    try {
      setIsLoading(true);
      setError(null);
      await createTool(data);
      navigate('/dashboard/tools');
    } catch (err) {
      console.error('Failed to create tool:', err);
      setError(err instanceof Error ? err.message : 'Failed to create tool');
      setIsLoading(false);
    }
  };

  const handleCancel = () => {
    navigate('/dashboard/tools');
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button
          onClick={handleCancel}
          className="p-2 rounded-lg hover:bg-white/10 text-white/60 hover:text-white transition-all"
        >
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-white">Create Tool</h1>
          <p className="text-white/50">Add a new tool for your voice agents</p>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4">
          <p className="text-red-400">{error}</p>
        </div>
      )}

      {/* Form */}
      <ToolForm
        onSubmit={handleSubmit}
        onCancel={handleCancel}
        isLoading={isLoading}
      />
    </div>
  );
}
