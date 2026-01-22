import { useState } from 'react';
import { useAlert } from '../../hooks/useAlert';
import { motion } from 'framer-motion';
import { 
  Save, 
  Globe, 
  Server, 
  Zap, 
  Settings,
  MessageSquare,
  Clock
} from 'lucide-react';
import { CustomDropdown } from '../ui/CustomDropdown';
import type { DropdownOption } from '../ui/CustomDropdown';
import { KeyValueEditor, recordToKeyValuePairs, keyValuePairsToRecord } from './KeyValueEditor';
import { AuthConfigEditor } from './AuthConfigEditor';
import { BodyParameterBuilder, parametersToJsonSchema, jsonSchemaToParameters } from './BodyParameterBuilder';
import { BuiltinToolSelector, BuiltinToolConfig } from './BuiltinToolSelector';
import type { 
  Tool, 
  CreateToolRequest, 
  ToolType, 
  McpTransport, 
  AuthType,
  KeyValuePair,
  BodyParameter
} from '../../lib/supabase-types';

interface ToolFormProps {
  tool?: Tool;
  onSubmit: (data: CreateToolRequest) => Promise<void>;
  onCancel: () => void;
  isLoading?: boolean;
}

// Map old 'function' type to 'api_request' for display
const normalizeToolType = (type: ToolType): ToolType => {
  return type === 'function' ? 'api_request' : type;
};

export function ToolForm({ tool, onSubmit, onCancel, isLoading }: ToolFormProps) {
  const { showError } = useAlert();
  const [formData, setFormData] = useState<CreateToolRequest>({
    name: tool?.name || '',
    slug: tool?.slug || '',
    description: tool?.description || '',
    type: normalizeToolType(tool?.type || 'api_request'),
    
    // API Request config
    function_server_url: tool?.function_server_url || '',
    function_method: tool?.function_method || 'POST',
    function_timeout_ms: tool?.function_timeout_ms || 30000,
    function_headers: tool?.function_headers || {},
    function_parameters: tool?.function_parameters || { type: 'object', properties: {} },
    function_auth_type: (tool?.function_auth_type as AuthType) || 'none',
    function_auth_config: tool?.function_auth_config || {},
    function_body_type: tool?.function_body_type || 'json',
    
    // MCP config
    mcp_server_url: tool?.mcp_server_url || '',
    mcp_transport: tool?.mcp_transport || 'sse',
    mcp_timeout_ms: tool?.mcp_timeout_ms || 30000,
    mcp_auth_type: (tool?.mcp_auth_type as AuthType) || 'none',
    mcp_auth_config: tool?.mcp_auth_config || {},
    
    // Builtin config
    builtin_type: tool?.builtin_type || undefined,
    builtin_config: tool?.builtin_config || {},
    builtin_custom_name: tool?.builtin_custom_name || '',
    builtin_custom_description: tool?.builtin_custom_description || '',
    
    // Messages
    messages: tool?.messages || {
      request_start: '',
      request_complete: '',
      request_failed: '',
      request_delayed: ''
    },
    
    // Advanced
    async_mode: tool?.async_mode || false,
    retry_config: tool?.retry_config || { max_retries: 3, retry_delay_ms: 1000 }
  });

  const [activeTab, setActiveTab] = useState<'basic' | 'config' | 'messages' | 'advanced'>('basic');
  
  // Header key-value pairs state
  const [headers, setHeaders] = useState<KeyValuePair[]>(
    recordToKeyValuePairs(tool?.function_headers || {})
  );
  
  // Body parameters state
  const [bodyParameters, setBodyParameters] = useState<BodyParameter[]>(
    jsonSchemaToParameters(tool?.function_parameters || {})
  );
  const [showRawJson, setShowRawJson] = useState(false);
  const [rawParametersJson, setRawParametersJson] = useState(
    JSON.stringify(tool?.function_parameters || { type: 'object', properties: {} }, null, 2)
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      // Convert visual builders to JSON format
      const headersRecord = keyValuePairsToRecord(headers);
      const parametersSchema = showRawJson 
        ? JSON.parse(rawParametersJson)
        : parametersToJsonSchema(bodyParameters);
      
      await onSubmit({
        ...formData,
        function_headers: headersRecord,
        function_parameters: parametersSchema
      });
    } catch (err) {
      showError('Invalid configuration. Please check your input.');
    }
  };

  const updateField = <K extends keyof CreateToolRequest>(field: K, value: CreateToolRequest[K]) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const updateMessages = (field: string, value: string) => {
    setFormData(prev => ({
      ...prev,
      messages: {
        ...prev.messages,
        [field]: value || null
      }
    }));
  };

  const tabs = [
    { id: 'basic' as const, label: 'Basic Info', icon: Globe },
    { id: 'config' as const, label: 'Configuration', icon: Settings },
    { id: 'messages' as const, label: 'Messages', icon: MessageSquare },
    { id: 'advanced' as const, label: 'Advanced', icon: Clock },
  ];

  const toolTypeOptions: DropdownOption<ToolType>[] = [
    {
      value: 'api_request',
      label: 'API Request',
      description: 'Make HTTP requests to external APIs',
      icon: <Globe size={20} className="text-blue-400" />
    },
    {
      value: 'mcp',
      label: 'MCP Server',
      description: 'Connect to Model Context Protocol servers',
      icon: <Server size={20} className="text-purple-400" />
    },
    {
      value: 'builtin',
      label: 'Built-in Tool',
      description: 'Use pre-built tools like end call, transfer, etc.',
      icon: <Zap size={20} className="text-yellow-400" />
    }
  ];

  const httpMethodOptions: DropdownOption<string>[] = [
    { value: 'POST', label: 'POST' },
    { value: 'GET', label: 'GET' },
    { value: 'PUT', label: 'PUT' },
    { value: 'PATCH', label: 'PATCH' },
    { value: 'DELETE', label: 'DELETE' }
  ];

  const mcpTransportOptions: DropdownOption<McpTransport>[] = [
    { value: 'sse', label: 'SSE (Server-Sent Events)', description: 'Recommended for most use cases' },
    { value: 'websocket', label: 'WebSocket', description: 'For bidirectional communication' },
    { value: 'stdio', label: 'Standard I/O', description: 'For local processes' }
  ];

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Tabs */}
      <div className="flex gap-2 p-1 bg-white/5 rounded-xl">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-medium transition-all ${
                activeTab === tab.id
                  ? 'bg-purple-600 text-white'
                  : 'text-white/60 hover:text-white hover:bg-white/5'
              }`}
            >
              <Icon size={16} />
              <span className="hidden sm:inline">{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      <motion.div
        key={activeTab}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white/5 border border-white/10 rounded-2xl p-6"
      >
        {activeTab === 'basic' && (
          <div className="space-y-6">
            {/* Tool Type Selection */}
            {!tool && (
              <div>
                <label className="block text-sm font-medium text-white/70 mb-3">Tool Type</label>
                <div className="grid gap-3 sm:grid-cols-3">
                  {toolTypeOptions.map((type) => (
                    <button
                      key={type.value}
                      type="button"
                      onClick={() => updateField('type', type.value)}
                      className={`p-4 rounded-xl border text-left transition-all ${
                        formData.type === type.value || (formData.type === 'function' && type.value === 'api_request')
                          ? 'border-purple-500 bg-purple-500/10'
                          : 'border-white/10 bg-white/5 hover:border-white/20'
                      }`}
                    >
                      <div className="flex items-center gap-3 mb-2">
                        {type.icon}
                        <span className="font-medium text-white">{type.label}</span>
                      </div>
                      <p className="text-xs text-white/50">{type.description}</p>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Name - only for non-builtin */}
            {formData.type !== 'builtin' && (
              <div>
                <label className="block text-sm font-medium text-white/70 mb-2">
                  Tool Name <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => updateField('name', e.target.value)}
                  placeholder="e.g., Weather Lookup, Book Appointment"
                  required
                  className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/30 focus:outline-none focus:border-purple-500/50"
                />
              </div>
            )}

            {/* Description - only for non-builtin */}
            {formData.type !== 'builtin' && (
              <div>
                <label className="block text-sm font-medium text-white/70 mb-2">Description</label>
                <textarea
                  value={formData.description || ''}
                  onChange={(e) => updateField('description', e.target.value)}
                  placeholder="Describe what this tool does..."
                  rows={3}
                  className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/30 focus:outline-none focus:border-purple-500/50 resize-none"
                />
                <p className="text-xs text-white/40 mt-1">
                  This description helps the AI understand when to use this tool
                </p>
              </div>
            )}

            {/* Builtin Tool Selector */}
            {formData.type === 'builtin' && (
              <BuiltinToolSelector
                selectedType={formData.builtin_type || null}
                onSelect={(type) => {
                  updateField('builtin_type', type);
                  // Auto-fill name from builtin tool - import at top instead of require
                  import('./BuiltinToolSelector').then(({ BUILTIN_TOOLS }) => {
                    const builtinDef = BUILTIN_TOOLS.find((t) => t.type === type);
                    if (builtinDef && !formData.name) {
                      updateField('name', builtinDef.name);
                    }
                  });
                }}
              />
            )}
          </div>
        )}

        {activeTab === 'config' && (
          <div className="space-y-6">
            {/* API Request Configuration */}
            {(formData.type === 'api_request' || formData.type === 'function') && (
              <>
                {/* Endpoint URL */}
                <div>
                  <label className="block text-sm font-medium text-white/70 mb-2">
                    Endpoint URL <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="url"
                    value={formData.function_server_url || ''}
                    onChange={(e) => updateField('function_server_url', e.target.value)}
                    placeholder="https://api.example.com/endpoint"
                    required
                    className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/30 focus:outline-none focus:border-purple-500/50"
                  />
                </div>

                {/* HTTP Method & Timeout Row */}
                <div className="grid grid-cols-2 gap-4">
                  <CustomDropdown
                    options={httpMethodOptions}
                    value={formData.function_method || 'POST'}
                    onChange={(val) => updateField('function_method', val)}
                    label="HTTP Method"
                  />
                  <div>
                    <label className="block text-sm font-medium text-white/70 mb-2">
                      Timeout (ms)
                    </label>
                    <input
                      type="number"
                      value={formData.function_timeout_ms || 30000}
                      onChange={(e) => updateField('function_timeout_ms', parseInt(e.target.value))}
                      min={1000}
                      max={120000}
                      className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white focus:outline-none focus:border-purple-500/50"
                    />
                  </div>
                </div>

                {/* Authentication */}
                <div className="border-t border-white/10 pt-6">
                  <AuthConfigEditor
                    authType={formData.function_auth_type || 'none'}
                    authConfig={formData.function_auth_config || {}}
                    onAuthTypeChange={(type) => updateField('function_auth_type', type)}
                    onAuthConfigChange={(config) => updateField('function_auth_config', config)}
                  />
                </div>

                {/* Headers */}
                <div className="border-t border-white/10 pt-6">
                  <KeyValueEditor
                    items={headers}
                    onChange={setHeaders}
                    label="Custom Headers"
                    keyPlaceholder="Header name"
                    valuePlaceholder="Header value"
                    description="Add custom HTTP headers to include with each request"
                  />
                </div>

                {/* Body Parameters */}
                <div className="border-t border-white/10 pt-6">
                  <BodyParameterBuilder
                    parameters={bodyParameters}
                    onChange={setBodyParameters}
                    showRawJson={showRawJson}
                    onToggleRawJson={() => setShowRawJson(!showRawJson)}
                    rawJson={rawParametersJson}
                    onRawJsonChange={setRawParametersJson}
                  />
                </div>
              </>
            )}

            {/* MCP Configuration */}
            {formData.type === 'mcp' && (
              <>
                {/* MCP Server URL */}
                <div>
                  <label className="block text-sm font-medium text-white/70 mb-2">
                    MCP Server URL <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="url"
                    value={formData.mcp_server_url || ''}
                    onChange={(e) => updateField('mcp_server_url', e.target.value)}
                    placeholder="https://your-mcp-server.com/sse"
                    required
                    className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/30 focus:outline-none focus:border-purple-500/50"
                  />
                </div>

                {/* Transport & Timeout */}
                <div className="grid grid-cols-2 gap-4">
                  <CustomDropdown
                    options={mcpTransportOptions}
                    value={formData.mcp_transport || 'sse'}
                    onChange={(val) => updateField('mcp_transport', val)}
                    label="Transport"
                  />
                  <div>
                    <label className="block text-sm font-medium text-white/70 mb-2">
                      Timeout (ms)
                    </label>
                    <input
                      type="number"
                      value={formData.mcp_timeout_ms || 30000}
                      onChange={(e) => updateField('mcp_timeout_ms', parseInt(e.target.value))}
                      min={1000}
                      max={120000}
                      className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white focus:outline-none focus:border-purple-500/50"
                    />
                  </div>
                </div>

                {/* MCP Authentication */}
                <div className="border-t border-white/10 pt-6">
                  <AuthConfigEditor
                    authType={formData.mcp_auth_type || 'none'}
                    authConfig={formData.mcp_auth_config || {}}
                    onAuthTypeChange={(type) => updateField('mcp_auth_type', type)}
                    onAuthConfigChange={(config) => updateField('mcp_auth_config', config)}
                  />
                </div>
              </>
            )}

            {/* Builtin Tool Configuration */}
            {formData.type === 'builtin' && formData.builtin_type && (
              <BuiltinToolConfig
                toolType={formData.builtin_type}
                config={formData.builtin_config || {}}
                onChange={(config) => updateField('builtin_config', config)}
                customName={formData.builtin_custom_name}
                customDescription={formData.builtin_custom_description}
                onCustomNameChange={(name) => {
                  updateField('builtin_custom_name', name);
                  updateField('name', name || formData.builtin_type || '');
                }}
                onCustomDescriptionChange={(desc) => updateField('builtin_custom_description', desc)}
              />
            )}

            {formData.type === 'builtin' && !formData.builtin_type && (
              <div className="text-center py-8">
                <Zap size={48} className="text-yellow-400 mx-auto mb-4 opacity-50" />
                <p className="text-white/50">
                  Please select a built-in tool from the Basic Info tab first
                </p>
              </div>
            )}
          </div>
        )}

        {activeTab === 'messages' && (
          <div className="space-y-6">
            <p className="text-sm text-white/50 mb-4">
              Configure messages the assistant will speak during tool execution
            </p>

            <div>
              <label className="block text-sm font-medium text-white/70 mb-2">
                Request Start Message
              </label>
              <input
                type="text"
                value={formData.messages?.request_start || ''}
                onChange={(e) => updateMessages('request_start', e.target.value)}
                placeholder="e.g., Let me check that for you..."
                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/30 focus:outline-none focus:border-purple-500/50"
              />
              <p className="text-xs text-white/40 mt-1">
                Spoken when the tool starts executing
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-white/70 mb-2">
                Request Complete Message
              </label>
              <input
                type="text"
                value={formData.messages?.request_complete || ''}
                onChange={(e) => updateMessages('request_complete', e.target.value)}
                placeholder="e.g., I've got the information..."
                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/30 focus:outline-none focus:border-purple-500/50"
              />
              <p className="text-xs text-white/40 mt-1">
                Spoken when the tool completes successfully
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-white/70 mb-2">
                Request Failed Message
              </label>
              <input
                type="text"
                value={formData.messages?.request_failed || ''}
                onChange={(e) => updateMessages('request_failed', e.target.value)}
                placeholder="e.g., I couldn't complete that request..."
                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/30 focus:outline-none focus:border-purple-500/50"
              />
              <p className="text-xs text-white/40 mt-1">
                Spoken when the tool fails
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-white/70 mb-2">
                Request Delayed Message
              </label>
              <input
                type="text"
                value={formData.messages?.request_delayed || ''}
                onChange={(e) => updateMessages('request_delayed', e.target.value)}
                placeholder="e.g., This is taking a moment..."
                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/30 focus:outline-none focus:border-purple-500/50"
              />
              <p className="text-xs text-white/40 mt-1">
                Spoken when the tool takes longer than expected
              </p>
            </div>
          </div>
        )}

        {activeTab === 'advanced' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between p-4 bg-white/5 rounded-xl">
              <div>
                <h4 className="font-medium text-white">Async Mode</h4>
                <p className="text-sm text-white/50">
                  Run the tool asynchronously without waiting for results
                </p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData.async_mode || false}
                  onChange={(e) => updateField('async_mode', e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-600"></div>
              </label>
            </div>

            <div>
              <label className="block text-sm font-medium text-white/70 mb-2">
                Max Retries
              </label>
              <input
                type="number"
                value={formData.retry_config?.max_retries || 3}
                onChange={(e) => updateField('retry_config', {
                  max_retries: parseInt(e.target.value),
                  retry_delay_ms: formData.retry_config?.retry_delay_ms || 1000
                })}
                min={0}
                max={10}
                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white focus:outline-none focus:border-purple-500/50"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-white/70 mb-2">
                Retry Delay (ms)
              </label>
              <input
                type="number"
                value={formData.retry_config?.retry_delay_ms || 1000}
                onChange={(e) => updateField('retry_config', {
                  max_retries: formData.retry_config?.max_retries || 3,
                  retry_delay_ms: parseInt(e.target.value)
                })}
                min={100}
                max={30000}
                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white focus:outline-none focus:border-purple-500/50"
              />
            </div>
          </div>
        )}
      </motion.div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-3 pt-4 border-t border-white/10">
        <button
          type="button"
          onClick={onCancel}
          disabled={isLoading}
          className="px-6 py-2.5 rounded-xl font-medium text-white/60 hover:text-white hover:bg-white/5 transition-all disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isLoading || !formData.name}
          className="px-6 py-2.5 bg-gradient-to-r from-purple-600 to-purple-500 rounded-xl font-medium text-white hover:from-purple-500 hover:to-purple-400 transition-all shadow-lg shadow-purple-500/25 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
        >
          {isLoading ? (
            <>
              <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-white"></div>
              Saving...
            </>
          ) : (
            <>
              <Save size={16} />
              {tool ? 'Save Changes' : 'Create Tool'}
            </>
          )}
        </button>
      </div>
    </form>
  );
}
