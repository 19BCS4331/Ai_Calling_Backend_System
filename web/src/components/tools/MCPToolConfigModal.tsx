import { useState, useEffect } from 'react';
import { X, Check, Settings2, Eye, EyeOff } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface MCPFunction {
  name: string;
  description?: string;
  enabled: boolean;
  customName?: string;
  customDescription?: string;
}

interface MCPToolConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  toolId: string;
  toolName: string;
  agentId: string;
  onSave: (configs: any[]) => Promise<void>;
}

export function MCPToolConfigModal({
  isOpen,
  onClose,
  toolId,
  toolName,
  agentId: _agentId,
  onSave
}: MCPToolConfigModalProps) {
  const [functions, setFunctions] = useState<MCPFunction[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      loadFunctions();
    }
  }, [isOpen, toolId]);

  const loadFunctions = async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      // Load existing configurations from backend
      const { data: { session } } = await import('../../lib/supabase').then(m => m.supabase.auth.getSession());
      if (!session) {
        throw new Error('Not authenticated');
      }

      const response = await fetch(
        `${import.meta.env.VITE_SAAS_API_URL || 'http://localhost:3001'}/api/v1/orgs/${(await import('../../store/organization').then(m => m.useOrganizationStore.getState())).currentOrganization?.id}/tools/${toolId}/discover-functions`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`
          },
          body: JSON.stringify({ agentId: _agentId })
        }
      );

      if (!response.ok) {
        throw new Error('Failed to load functions');
      }

      const data = await response.json();
      const loadedFunctions: MCPFunction[] = data.functions.map((fn: any) => ({
        name: fn.mcp_function_name || fn.name,
        description: fn.description,
        enabled: fn.enabled !== undefined ? fn.enabled : true,
        customName: fn.custom_name || undefined,
        customDescription: fn.custom_description || undefined
      }));
      
      setFunctions(loadedFunctions);
    } catch (err) {
      console.error('Failed to load functions:', err);
      setError(err instanceof Error ? err.message : 'Failed to load functions');
    } finally {
      setIsLoading(false);
    }
  };

  const toggleFunction = (index: number) => {
    setFunctions(prev => prev.map((fn, i) => 
      i === index ? { ...fn, enabled: !fn.enabled } : fn
    ));
  };

  const updateCustomName = (index: number, customName: string) => {
    setFunctions(prev => prev.map((fn, i) => 
      i === index ? { ...fn, customName: customName || undefined } : fn
    ));
  };

  // Unused for now, but kept for future enhancement
  // const updateCustomDescription = (index: number, customDescription: string) => {
  //   setFunctions(prev => prev.map((fn, i) => 
  //     i === index ? { ...fn, customDescription: customDescription || undefined } : fn
  //   ));
  // };

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);

    try {
      const configs = functions.map((fn, index) => ({
        tool_id: toolId,
        mcp_function_name: fn.name,
        enabled: fn.enabled,
        custom_name: fn.customName || null,
        custom_description: fn.customDescription || null,
        display_order: index
      }));

      console.log('Saving MCP tool configs:', configs);
      await onSave(configs);
      console.log('MCP tool configs saved successfully');
      onClose();
    } catch (err) {
      console.error('Failed to save MCP tool configs:', err);
      setError(err instanceof Error ? err.message : 'Failed to save configurations');
    } finally {
      setIsSaving(false);
    }
  };

  const enabledCount = functions.filter(f => f.enabled).length;

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className="bg-[#0A0A0A] border border-white/10 rounded-xl shadow-2xl max-w-3xl w-full max-h-[80vh] overflow-hidden flex flex-col"
        >
          {/* Header */}
          <div className="p-6 border-b border-white/10">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Settings2 className="text-purple-400" size={20} />
                  <h2 className="text-xl font-semibold text-white">Configure MCP Tool</h2>
                </div>
                <p className="text-sm text-white/60">{toolName}</p>
                <p className="text-xs text-white/40 mt-1">
                  {enabledCount} of {functions.length} functions enabled
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="text-white/60 hover:text-white transition-colors"
              >
                <X size={20} />
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6">
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-500"></div>
              </div>
            ) : error ? (
              <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 text-red-400 text-sm">
                {error}
              </div>
            ) : (
              <div className="space-y-3">
                {functions.map((fn, index) => (
                  <div
                    key={fn.name}
                    className={`border rounded-lg p-4 transition-all ${
                      fn.enabled
                        ? 'bg-white/5 border-white/10'
                        : 'bg-white/[0.02] border-white/5 opacity-60'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      {/* Enable/Disable Toggle */}
                      <button
                        type="button"
                        onClick={() => toggleFunction(index)}
                        className="mt-1 flex-shrink-0"
                      >
                        {fn.enabled ? (
                          <Eye className="text-purple-400" size={18} />
                        ) : (
                          <EyeOff className="text-white/30" size={18} />
                        )}
                      </button>

                      <div className="flex-1 space-y-3">
                        {/* Original Name */}
                        <div>
                          <label className="text-xs text-white/40 mb-1 block">
                            Original Name
                          </label>
                          <div className="text-sm text-white/60 font-mono">
                            {fn.name}
                          </div>
                        </div>

                        {/* Custom Name */}
                        <div>
                          <label className="text-xs text-white/40 mb-1 block">
                            Custom Name (optional)
                          </label>
                          <input
                            type="text"
                            value={fn.customName || ''}
                            onChange={(e) => updateCustomName(index, e.target.value)}
                            placeholder={fn.name.replace(/2$/, '')}
                            disabled={!fn.enabled}
                            className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-purple-500/50 disabled:opacity-50 disabled:cursor-not-allowed"
                          />
                          <p className="text-xs text-white/30 mt-1">
                            This name will be used in the agent's prompt
                          </p>
                        </div>

                        {/* Description */}
                        {fn.description && (
                          <div>
                            <label className="text-xs text-white/40 mb-1 block">
                              Description
                            </label>
                            <p className="text-sm text-white/60">
                              {fn.description}
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="p-6 border-t border-white/10 flex items-center justify-between">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-white/60 hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving || isLoading}
              className="px-6 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {isSaving ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                  Saving...
                </>
              ) : (
                <>
                  <Check size={16} />
                  Save Configuration
                </>
              )}
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
