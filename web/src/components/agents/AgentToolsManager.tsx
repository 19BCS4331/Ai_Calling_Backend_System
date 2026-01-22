import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Plus, 
  Trash2, 
  GripVertical, 
  Server, 
  Zap,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  ToggleLeft,
  ToggleRight,
  Settings,
  Globe2
} from 'lucide-react';
import { useTools, useAgentTools } from '../../hooks/useTools';
import { MCPToolConfigModal } from '../tools/MCPToolConfigModal';
import { useOrganizationStore } from '../../store/organization';
import { useAlert, useConfirm } from '../../hooks/useAlert';
import type { Tool, AgentToolWithDetails, ToolType } from '../../lib/supabase-types';

interface AgentToolsManagerProps {
  agentId: string;
}

export function AgentToolsManager({ agentId }: AgentToolsManagerProps) {
  const { currentOrganization } = useOrganizationStore();
  const { showError } = useAlert();
  const { showConfirm } = useConfirm();
  const { tools: availableTools, isLoading: toolsLoading } = useTools();
  const { 
    agentTools, 
    isLoading: agentToolsLoading,
    addToolToAgent,
    removeToolFromAgent,
    toggleToolEnabled
  } = useAgentTools(agentId);

  const [showAddTool, setShowAddTool] = useState(false);
  const [expandedTool, setExpandedTool] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [isRemoving, setIsRemoving] = useState<string | null>(null);
  const [configuringTool, setConfiguringTool] = useState<AgentToolWithDetails | null>(null);

  // Filter out tools that are already added
  const unassignedTools = availableTools.filter(
    tool => !agentTools.some(at => at.tool_id === tool.id)
  );

  const getTypeIcon = (type: ToolType) => {
    switch (type) {
      case 'api_request':
        return <Globe2 size={16} className="text-blue-400" />;
      case 'mcp':
        return <Server size={16} className="text-purple-400" />;
      case 'builtin':
        return <Zap size={16} className="text-yellow-400" />;
      default:
        return null;
    }
  };

  const getTypeColor = (type: ToolType) => {
    switch (type) {
      case 'api_request':
        return 'bg-blue-500/10 text-blue-400 border-blue-500/20';
      case 'mcp':
        return 'bg-purple-500/10 text-purple-400 border-purple-500/20';
      case 'builtin':
        return 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20';
      default:
        return 'bg-white/5 text-white/50 border-white/10';
    }
  };

  const handleAddTool = async (tool: Tool) => {
    try {
      setIsAdding(true);
      await addToolToAgent({
        agent_id: agentId,
        tool_id: tool.id,
        is_enabled: true
      });
      setShowAddTool(false);
    } catch (error) {
      console.error('Failed to add tool:', error);
      showError('Failed to add tool: ' + (error instanceof Error ? error.message : 'Unknown error'));
    } finally {
      setIsAdding(false);
    }
  };

  const handleRemoveTool = async (agentToolId: string) => {
    showConfirm({
      title: 'Remove Tool',
      message: 'Are you sure you want to remove this tool from the agent?',
      variant: 'warning',
      confirmText: 'Remove',
      onConfirm: async () => {
        try {
          setIsRemoving(agentToolId);
          await removeToolFromAgent(agentToolId);
        } catch (error) {
          console.error('Failed to remove tool:', error);
          showError('Failed to remove tool: ' + (error instanceof Error ? error.message : 'Unknown error'));
        } finally {
          setIsRemoving(null);
        }
      }
    });
  };

  const handleToggleEnabled = async (agentTool: AgentToolWithDetails) => {
    try {
      await toggleToolEnabled(agentTool.id, !agentTool.is_enabled);
    } catch (error) {
      console.error('Failed to toggle tool:', error);
    }
  };

  const handleSaveToolConfig = async (configs: any[]) => {
    if (!configuringTool || !currentOrganization) {
      console.error('Missing configuringTool or currentOrganization');
      return;
    }

    try {
      const url = `${import.meta.env.VITE_SAAS_API_URL || 'http://localhost:3001'}/api/v1/orgs/${currentOrganization.id}/agents/${agentId}/tool-configs`;
      console.log('Saving to URL:', url);
      console.log('Configs payload:', configs);

      const { data: { session } } = await import('../../lib/supabase').then(m => m.supabase.auth.getSession());
      if (!session) {
        throw new Error('Not authenticated');
      }

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ configs })
      });

      const responseData = await response.json();
      console.log('Response:', response.status, responseData);

      if (!response.ok) {
        throw new Error(responseData.message || 'Failed to save tool configuration');
      }

      // Refresh agent tools
      window.location.reload();
    } catch (error) {
      console.error('Failed to save tool config:', error);
      showError('Failed to save configuration: ' + (error instanceof Error ? error.message : 'Unknown error'));
      throw error;
    }
  };

  const isLoading = toolsLoading || agentToolsLoading;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="animate-spin rounded-full h-6 w-6 border-t-2 border-b-2 border-purple-500"></div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-white">Agent Tools</h3>
          <p className="text-sm text-white/50">
            {agentTools.length} tool{agentTools.length !== 1 ? 's' : ''} configured
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowAddTool(!showAddTool)}
          disabled={unassignedTools.length === 0}
          className="px-3 py-2 bg-purple-600 hover:bg-purple-500 rounded-lg text-white text-sm font-medium transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Plus size={16} />
          Add Tool
        </button>
      </div>

      {/* Add Tool Dropdown */}
      <AnimatePresence>
        {showAddTool && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-3">
              <h4 className="text-sm font-medium text-white/70">Select a tool to add</h4>
              
              {unassignedTools.length === 0 ? (
                <p className="text-sm text-white/40 text-center py-4">
                  All available tools have been added to this agent
                </p>
              ) : (
                <div className="grid gap-2 max-h-60 overflow-y-auto">
                  {unassignedTools.map((tool) => (
                    <button
                      type="button"
                      key={tool.id}
                      onClick={() => handleAddTool(tool)}
                      disabled={isAdding}
                      className="flex items-center gap-3 p-3 bg-white/5 hover:bg-white/10 rounded-lg text-left transition-colors disabled:opacity-50"
                    >
                      <div className={`p-2 rounded-lg ${getTypeColor(tool.type)}`}>
                        {getTypeIcon(tool.type)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <h5 className="font-medium text-white truncate">{tool.name}</h5>
                        {tool.description && (
                          <p className="text-xs text-white/50 truncate">{tool.description}</p>
                        )}
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded-full border ${getTypeColor(tool.type)}`}>
                        {tool.type}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddTool(false)}
                  className="text-sm text-white/60 hover:text-white transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* MCP Tool Configuration Modal */}
      {configuringTool && (
        <MCPToolConfigModal
          isOpen={true}
          onClose={() => setConfiguringTool(null)}
          toolId={configuringTool.tool_id}
          toolName={configuringTool.tool.name}
          agentId={agentId}
          onSave={handleSaveToolConfig}
        />
      )}

      {/* Assigned Tools List */}
      {agentTools.length === 0 ? (
        <div className="bg-white/5 border border-white/10 rounded-xl p-8 text-center">
          <Settings size={32} className="text-white/20 mx-auto mb-3" />
          <h4 className="font-medium text-white mb-1">No tools configured</h4>
          <p className="text-sm text-white/50 mb-4">
            Add tools to extend your agent's capabilities
          </p>
          <button
            type="button"
            onClick={() => setShowAddTool(true)}
            disabled={unassignedTools.length === 0}
            className="text-sm text-purple-400 hover:text-purple-300 transition-colors disabled:opacity-50"
          >
            {unassignedTools.length > 0 ? 'Add your first tool →' : 'Create tools first →'}
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {agentTools.map((agentTool, index) => (
            <motion.div
              key={agentTool.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
              className={`bg-white/5 border rounded-xl overflow-hidden transition-colors ${
                agentTool.is_enabled ? 'border-white/10' : 'border-white/5 opacity-60'
              }`}
            >
              {/* Tool Header */}
              <div className="flex items-center gap-3 p-4">
                {/* Drag Handle */}
                <div className="text-white/20 cursor-grab">
                  <GripVertical size={16} />
                </div>

                {/* Type Icon */}
                <div className={`p-2 rounded-lg ${getTypeColor(agentTool.tool.type)}`}>
                  {getTypeIcon(agentTool.tool.type)}
                </div>

                {/* Tool Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h4 className="font-medium text-white truncate">{agentTool.tool.name}</h4>
                    <span className={`text-xs px-2 py-0.5 rounded-full border ${getTypeColor(agentTool.tool.type)}`}>
                      {agentTool.tool.type}
                    </span>
                  </div>
                  {agentTool.tool.description && (
                    <p className="text-xs text-white/50 truncate mt-0.5">{agentTool.tool.description}</p>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2">
                  {/* Configure MCP Tool */}
                  {agentTool.tool.type === 'mcp' && (
                    <button
                      type="button"
                      onClick={() => setConfiguringTool(agentTool)}
                      className="p-1.5 rounded-lg hover:bg-white/10 transition-colors text-purple-400 hover:text-purple-300"
                      title="Configure MCP functions"
                    >
                      <Settings size={18} />
                    </button>
                  )}

                  {/* Toggle Enabled */}
                  <button
                    type="button"
                    onClick={() => handleToggleEnabled(agentTool)}
                    className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"
                    title={agentTool.is_enabled ? 'Disable tool' : 'Enable tool'}
                  >
                    {agentTool.is_enabled ? (
                      <ToggleRight size={20} className="text-green-400" />
                    ) : (
                      <ToggleLeft size={20} className="text-white/40" />
                    )}
                  </button>

                  {/* Expand/Collapse */}
                  <button
                    type="button"
                    onClick={() => setExpandedTool(expandedTool === agentTool.id ? null : agentTool.id)}
                    className="p-1.5 rounded-lg hover:bg-white/10 text-white/40 hover:text-white transition-colors"
                  >
                    {expandedTool === agentTool.id ? (
                      <ChevronUp size={16} />
                    ) : (
                      <ChevronDown size={16} />
                    )}
                  </button>

                  {/* Remove */}
                  <button
                    type="button"
                    onClick={() => handleRemoveTool(agentTool.id)}
                    disabled={isRemoving === agentTool.id}
                    className="p-1.5 rounded-lg hover:bg-red-500/10 text-white/40 hover:text-red-400 transition-colors disabled:opacity-50"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>

              {/* Expanded Details */}
              <AnimatePresence>
                {expandedTool === agentTool.id && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="px-4 pb-4 pt-2 border-t border-white/5 space-y-3">
                      {/* Tool URL */}
                      {(agentTool.tool.function_server_url || agentTool.tool.mcp_server_url) && (
                        <div className="flex items-center gap-2 text-xs text-white/40 bg-white/5 rounded-lg px-3 py-2">
                          <ExternalLink size={12} />
                          <span className="truncate">
                            {agentTool.tool.function_server_url || agentTool.tool.mcp_server_url}
                          </span>
                        </div>
                      )}

                      {/* Tool Status */}
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-white/50">Status</span>
                        <span className={`${
                          agentTool.tool.status === 'active' 
                            ? 'text-green-400' 
                            : agentTool.tool.status === 'error' 
                            ? 'text-red-400' 
                            : 'text-white/50'
                        }`}>
                          {agentTool.tool.status}
                        </span>
                      </div>

                      {/* Last Validated */}
                      {agentTool.tool.last_validated_at && (
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-white/50">Last Validated</span>
                          <span className="text-white/70">
                            {new Date(agentTool.tool.last_validated_at).toLocaleDateString()}
                          </span>
                        </div>
                      )}

                      {/* Validation Error */}
                      {agentTool.tool.validation_error && (
                        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3">
                          <p className="text-xs text-red-400">{agentTool.tool.validation_error}</p>
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          ))}
        </div>
      )}

      {/* Help Text */}
      <p className="text-xs text-white/40 text-center">
        Tools allow your agent to perform actions like booking appointments, looking up data, or connecting to external services.
      </p>
    </div>
  );
}
