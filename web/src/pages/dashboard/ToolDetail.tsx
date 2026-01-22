import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader, Trash2 } from 'lucide-react';
import { ToolForm } from '../../components/tools/ToolForm';
import { useTools, useToolById } from '../../hooks/useTools';
import { useConfirm } from '../../hooks/useAlert';
import type { UpdateToolRequest } from '../../lib/supabase-types';

export function ToolDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { tool, isLoading: isFetching, error: fetchError } = useToolById(id);
  const { updateTool, deleteTool } = useTools();
  const { showConfirm } = useConfirm();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (data: UpdateToolRequest) => {
    if (!id) return;

    try {
      setIsLoading(true);
      setError(null);
      await updateTool(id, data);
      navigate('/dashboard/tools');
    } catch (err) {
      console.error('Failed to update tool:', err);
      setError(err instanceof Error ? err.message : 'Failed to update tool');
      setIsLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!id) return;
    
    showConfirm({
      title: 'Delete Tool',
      message: 'Are you sure you want to delete this tool? This will also remove it from all agents.',
      variant: 'danger',
      confirmText: 'Delete',
      onConfirm: async () => {
        try {
          setIsLoading(true);
          await deleteTool(id);
          navigate('/dashboard/tools');
        } catch (err) {
          console.error('Failed to delete tool:', err);
          setError(err instanceof Error ? err.message : 'Failed to delete tool');
          setIsLoading(false);
        }
      }
    });
  };

  const handleCancel = () => {
    navigate('/dashboard/tools');
  };

  if (isFetching) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <Loader size={32} className="text-purple-500 animate-spin mx-auto mb-4" />
          <p className="text-white/50">Loading tool...</p>
        </div>
      </div>
    );
  }

  if (fetchError || !tool) {
    return (
      <div className="space-y-6">
        <button
          onClick={handleCancel}
          className="flex items-center gap-2 text-white/60 hover:text-white transition-colors"
        >
          <ArrowLeft size={18} />
          Back to Tools
        </button>

        <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-8 text-center">
          <h3 className="text-lg font-semibold text-red-400 mb-2">Error Loading Tool</h3>
          <p className="text-red-400/80">{fetchError || 'Tool not found'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={handleCancel}
            className="p-2 rounded-lg hover:bg-white/10 text-white/60 hover:text-white transition-all"
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-white">{tool.name}</h1>
            <p className="text-white/50">Configure your tool settings</p>
          </div>
        </div>

        <button
          onClick={handleDelete}
          disabled={isLoading}
          className="px-4 py-2 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 hover:bg-red-500/20 transition-colors flex items-center gap-2 disabled:opacity-50"
        >
          <Trash2 size={16} />
          Delete
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4">
          <p className="text-red-400">{error}</p>
        </div>
      )}

      {/* Form */}
      <ToolForm
        tool={tool}
        onSubmit={handleSubmit}
        onCancel={handleCancel}
        isLoading={isLoading}
      />
    </div>
  );
}
