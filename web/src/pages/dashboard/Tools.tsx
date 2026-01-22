import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { 
  Wrench, 
  Plus, 
  Search, 
  Filter, 
  Server, 
  Zap,
  MoreVertical,
  Edit,
  Trash2,
  CheckCircle,
  XCircle,
  AlertCircle,
  ExternalLink,
  RefreshCw,
  Globe2
} from 'lucide-react';
import { useTools } from '../../hooks/useTools';
import type { Tool, ToolType, ToolStatus } from '../../lib/supabase-types';

export function Tools() {
  const navigate = useNavigate();
  const [typeFilter, setTypeFilter] = useState<ToolType | undefined>();
  const [searchQuery, setSearchQuery] = useState('');
  const { tools, isLoading, deleteTool, validateTool } = useTools(typeFilter);
  const [isDeleting, setIsDeleting] = useState<string | null>(null);
  const [isValidating, setIsValidating] = useState<string | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  const filteredTools = tools.filter(tool =>
    tool.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    tool.description?.toLowerCase().includes(searchQuery.toLowerCase())
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
        return <Wrench size={16} className="text-white/50" />;
    }
  };

  const getTypeLabel = (type: ToolType) => {
    switch (type) {
      case 'api_request':
        return 'API Request';
      case 'mcp':
        return 'MCP Server';
      case 'builtin':
        return 'Built-in';
      default:
        return type;
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

  const getStatusIcon = (status: ToolStatus) => {
    switch (status) {
      case 'active':
        return <CheckCircle size={14} className="text-green-400" />;
      case 'inactive':
        return <XCircle size={14} className="text-gray-400" />;
      case 'error':
        return <AlertCircle size={14} className="text-red-400" />;
      default:
        return null;
    }
  };

  const getStatusColor = (status: ToolStatus) => {
    switch (status) {
      case 'active':
        return 'text-green-400';
      case 'inactive':
        return 'text-gray-400';
      case 'error':
        return 'text-red-400';
      default:
        return 'text-white/50';
    }
  };

  const handleDelete = async (toolId: string) => {
    if (!confirm('Are you sure you want to delete this tool? This will also remove it from all agents.')) {
      return;
    }

    try {
      setIsDeleting(toolId);
      await deleteTool(toolId);
    } catch (error) {
      console.error('Failed to delete tool:', error);
      alert('Failed to delete tool: ' + (error instanceof Error ? error.message : 'Unknown error'));
    } finally {
      setIsDeleting(null);
      setOpenMenuId(null);
    }
  };

  const handleValidate = async (toolId: string) => {
    try {
      setIsValidating(toolId);
      const result = await validateTool(toolId);
      if (result.valid) {
        alert('Tool validated successfully!');
      } else {
        alert('Tool validation failed: ' + result.error);
      }
    } catch (error) {
      console.error('Failed to validate tool:', error);
      alert('Failed to validate tool: ' + (error instanceof Error ? error.message : 'Unknown error'));
    } finally {
      setIsValidating(null);
    }
  };

  const getToolUrl = (tool: Tool) => {
    if (tool.type === 'api_request') return tool.function_server_url;
    if (tool.type === 'mcp') return tool.mcp_server_url;
    return null;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white mb-1">Tools</h1>
          <p className="text-white/50">Manage tools for your voice agents</p>
        </div>
        <button
          onClick={() => navigate('/dashboard/tools/new')}
          className="px-4 py-2.5 bg-gradient-to-r from-purple-600 to-purple-500 rounded-xl font-medium text-white hover:from-purple-500 hover:to-purple-400 transition-all duration-300 shadow-lg shadow-purple-500/25 flex items-center gap-2"
        >
          <Plus size={18} />
          Create Tool
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
            placeholder="Search tools..."
            className="w-full pl-11 pr-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/30 focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/20 transition-all"
          />
        </div>

        {/* Type Filter */}
        <div className="relative">
          <Filter size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30" />
          <select
            value={typeFilter || ''}
            onChange={(e) => setTypeFilter(e.target.value as ToolType | undefined || undefined)}
            className="pl-11 pr-8 py-3 bg-white/5 border border-white/10 rounded-xl text-white focus:outline-none focus:border-purple-500/50 appearance-none cursor-pointer min-w-[160px]"
          >
            <option value="">All Types</option>
            <option value="api_request">API Request</option>
            <option value="mcp">MCP Server</option>
            <option value="builtin">Built-in</option>
          </select>
        </div>
      </div>

      {/* Tools Grid */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-purple-500"></div>
        </div>
      ) : filteredTools.length === 0 ? (
        <div className="bg-white/5 border border-white/10 rounded-2xl p-12 text-center">
          <Wrench size={48} className="text-white/20 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-white mb-2">
            {searchQuery || typeFilter ? 'No tools found' : 'No tools yet'}
          </h3>
          <p className="text-white/50 mb-6">
            {searchQuery || typeFilter
              ? 'Try adjusting your search or filters'
              : 'Create your first tool to extend your agent\'s capabilities'}
          </p>
          {!searchQuery && !typeFilter && (
            <button
              onClick={() => navigate('/dashboard/tools/new')}
              className="px-4 py-2 bg-purple-600 hover:bg-purple-500 rounded-lg text-white transition-colors inline-flex items-center gap-2"
            >
              <Plus size={16} />
              Create Tool
            </button>
          )}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredTools.map((tool, index) => (
            <motion.div
              key={tool.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
              className="bg-white/5 border border-white/10 rounded-2xl p-5 hover:border-purple-500/30 transition-all group"
            >
              {/* Header */}
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${getTypeColor(tool.type)}`}>
                    {getTypeIcon(tool.type)}
                  </div>
                  <div>
                    <h3 className="font-semibold text-white group-hover:text-purple-400 transition-colors">
                      {tool.name}
                    </h3>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className={`text-xs ${getTypeColor(tool.type)} px-2 py-0.5 rounded-full border`}>
                        {getTypeLabel(tool.type)}
                      </span>
                      <span className={`flex items-center gap-1 text-xs ${getStatusColor(tool.status)}`}>
                        {getStatusIcon(tool.status)}
                        {tool.status}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Menu */}
                <div className="relative">
                  <button
                    onClick={() => setOpenMenuId(openMenuId === tool.id ? null : tool.id)}
                    className="p-1.5 rounded-lg hover:bg-white/10 text-white/40 hover:text-white transition-all"
                  >
                    <MoreVertical size={16} />
                  </button>

                  {openMenuId === tool.id && (
                    <div className="absolute right-0 top-8 bg-gray-900 border border-white/10 rounded-xl shadow-xl py-1 min-w-[140px] z-10">
                      <button
                        onClick={() => {
                          navigate(`/dashboard/tools/${tool.id}`);
                          setOpenMenuId(null);
                        }}
                        className="w-full px-3 py-2 text-left text-sm text-white hover:bg-white/5 flex items-center gap-2"
                      >
                        <Edit size={14} />
                        Edit
                      </button>
                      {(tool.type === 'api_request' || tool.type === 'mcp') && (
                        <button
                          onClick={() => {
                            handleValidate(tool.id);
                            setOpenMenuId(null);
                          }}
                          disabled={isValidating === tool.id}
                          className="w-full px-3 py-2 text-left text-sm text-white hover:bg-white/5 flex items-center gap-2 disabled:opacity-50"
                        >
                          <RefreshCw size={14} className={isValidating === tool.id ? 'animate-spin' : ''} />
                          Validate
                        </button>
                      )}
                      <button
                        onClick={() => handleDelete(tool.id)}
                        disabled={isDeleting === tool.id}
                        className="w-full px-3 py-2 text-left text-sm text-red-400 hover:bg-red-500/10 flex items-center gap-2 disabled:opacity-50"
                      >
                        <Trash2 size={14} />
                        {isDeleting === tool.id ? 'Deleting...' : 'Delete'}
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Description */}
              {tool.description && (
                <p className="text-sm text-white/50 mb-3 line-clamp-2">
                  {tool.description}
                </p>
              )}

              {/* URL */}
              {getToolUrl(tool) && (
                <div className="flex items-center gap-2 text-xs text-white/30 bg-white/5 rounded-lg px-3 py-2 mb-3">
                  <ExternalLink size={12} />
                  <span className="truncate">{getToolUrl(tool)}</span>
                </div>
              )}

              {/* Footer */}
              <div className="flex items-center justify-between pt-3 border-t border-white/5">
                <span className="text-xs text-white/30">
                  {new Date(tool.created_at).toLocaleDateString()}
                </span>
                <button
                  onClick={() => navigate(`/dashboard/tools/${tool.id}`)}
                  className="text-xs text-purple-400 hover:text-purple-300 transition-colors"
                >
                  Configure →
                </button>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Click outside to close menu */}
      {openMenuId && (
        <div
          className="fixed inset-0 z-0"
          onClick={() => setOpenMenuId(null)}
        />
      )}
    </div>
  );
}
