import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useOrganizationStore } from '../store/organization';
import type { 
  Tool, 
  ToolStatus, 
  ToolType,
  CreateToolRequest, 
  UpdateToolRequest,
  AgentTool,
  AgentToolWithDetails,
  CreateAgentToolRequest,
  UpdateAgentToolRequest
} from '../lib/supabase-types';

// ============================================
// useTools Hook - Organization-level tool management
// ============================================

export function useTools(typeFilter?: ToolType, statusFilter?: ToolStatus) {
  const [tools, setTools] = useState<Tool[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { currentOrganization } = useOrganizationStore();

  const fetchTools = useCallback(async () => {
    if (!currentOrganization) {
      setTools([]);
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      setError(null);

      let query = supabase
        .from('tools')
        .select('*')
        .eq('organization_id', currentOrganization.id)
        .order('created_at', { ascending: false });

      if (typeFilter) {
        query = query.eq('type', typeFilter);
      }

      if (statusFilter) {
        query = query.eq('status', statusFilter);
      }

      const { data, error: fetchError } = await query;

      if (fetchError) throw fetchError;

      setTools((data || []) as Tool[]);
    } catch (err) {
      console.error('Failed to fetch tools:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch tools');
    } finally {
      setIsLoading(false);
    }
  }, [currentOrganization?.id, typeFilter, statusFilter]);

  useEffect(() => {
    fetchTools();
  }, [fetchTools]);

  const createTool = async (request: CreateToolRequest): Promise<Tool> => {
    if (!currentOrganization) {
      throw new Error('No organization selected');
    }

    // Generate unique slug
    let slug = request.slug || request.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    let counter = 1;
    let uniqueSlug = slug;

    while (true) {
      const { data: existing } = await supabase
        .from('tools')
        .select('id')
        .eq('organization_id', currentOrganization.id)
        .eq('slug', uniqueSlug)
        .maybeSingle();

      if (!existing) break;

      uniqueSlug = `${slug}-${counter}`;
      counter++;

      if (counter > 100) {
        throw new Error('Could not generate unique slug');
      }
    }

    const { data, error } = await supabase
      .from('tools')
      .insert({
        organization_id: currentOrganization.id,
        name: request.name,
        slug: uniqueSlug,
        description: request.description || null,
        type: request.type,
        status: 'active',
        
        // Function config
        function_server_url: request.function_server_url || null,
        function_method: request.function_method || 'POST',
        function_timeout_ms: request.function_timeout_ms || 30000,
        function_headers: request.function_headers || {},
        function_parameters: request.function_parameters || { type: 'object', properties: {} },
        
        // MCP config
        mcp_server_url: request.mcp_server_url || null,
        mcp_transport: request.mcp_transport || 'sse',
        mcp_timeout_ms: request.mcp_timeout_ms || 30000,
        mcp_auth_type: request.mcp_auth_type || null,
        mcp_auth_config: request.mcp_auth_config || {},
        mcp_settings: request.mcp_settings || {},
        
        // Builtin config
        builtin_type: request.builtin_type || null,
        builtin_config: request.builtin_config || {},
        
        // Messages
        messages: request.messages || {
          request_start: null,
          request_complete: null,
          request_failed: null,
          request_delayed: null
        },
        
        // Advanced
        async_mode: request.async_mode || false,
        retry_config: request.retry_config || { max_retries: 3, retry_delay_ms: 1000 },
      })
      .select()
      .single();

    if (error) throw error;

    // Refresh list
    await fetchTools();

    return data as Tool;
  };

  const updateTool = async (id: string, request: UpdateToolRequest): Promise<Tool> => {
    const updateData: Record<string, any> = {};

    // Only include fields that are provided
    if (request.name !== undefined) updateData.name = request.name;
    if (request.description !== undefined) updateData.description = request.description;
    if (request.status !== undefined) updateData.status = request.status;
    
    // Function config
    if (request.function_server_url !== undefined) updateData.function_server_url = request.function_server_url;
    if (request.function_method !== undefined) updateData.function_method = request.function_method;
    if (request.function_timeout_ms !== undefined) updateData.function_timeout_ms = request.function_timeout_ms;
    if (request.function_headers !== undefined) updateData.function_headers = request.function_headers;
    if (request.function_parameters !== undefined) updateData.function_parameters = request.function_parameters;
    
    // MCP config
    if (request.mcp_server_url !== undefined) updateData.mcp_server_url = request.mcp_server_url;
    if (request.mcp_transport !== undefined) updateData.mcp_transport = request.mcp_transport;
    if (request.mcp_timeout_ms !== undefined) updateData.mcp_timeout_ms = request.mcp_timeout_ms;
    if (request.mcp_auth_type !== undefined) updateData.mcp_auth_type = request.mcp_auth_type;
    if (request.mcp_auth_config !== undefined) updateData.mcp_auth_config = request.mcp_auth_config;
    if (request.mcp_settings !== undefined) updateData.mcp_settings = request.mcp_settings;
    
    // Builtin config
    if (request.builtin_type !== undefined) updateData.builtin_type = request.builtin_type;
    if (request.builtin_config !== undefined) updateData.builtin_config = request.builtin_config;
    
    // Messages
    if (request.messages !== undefined) updateData.messages = request.messages;
    
    // Advanced
    if (request.async_mode !== undefined) updateData.async_mode = request.async_mode;
    if (request.retry_config !== undefined) updateData.retry_config = request.retry_config;

    const { data, error } = await supabase
      .from('tools')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    // Refresh list
    await fetchTools();

    return data as Tool;
  };

  const deleteTool = async (id: string): Promise<void> => {
    const { error } = await supabase
      .from('tools')
      .delete()
      .eq('id', id);

    if (error) throw error;

    // Refresh list
    await fetchTools();
  };

  const validateTool = async (id: string): Promise<{ valid: boolean; error?: string }> => {
    // Get the tool
    const { data: tool, error: fetchError } = await supabase
      .from('tools')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError) throw fetchError;

    try {
      // Validate based on tool type
      if (tool.type === 'function' && tool.function_server_url) {
        // Try a HEAD request to check if server is reachable
        const response = await fetch(tool.function_server_url, {
          method: 'HEAD',
          signal: AbortSignal.timeout(5000)
        });

        if (!response.ok) {
          throw new Error(`Server returned ${response.status}`);
        }
      } else if (tool.type === 'mcp' && tool.mcp_server_url) {
        // For MCP, just check if URL is reachable
        const response = await fetch(tool.mcp_server_url, {
          method: 'GET',
          signal: AbortSignal.timeout(5000)
        });

        // MCP servers might return various status codes, just check connection
        if (response.status >= 500) {
          throw new Error(`Server error: ${response.status}`);
        }
      }

      // Update validation status
      await supabase
        .from('tools')
        .update({
          last_validated_at: new Date().toISOString(),
          validation_error: null,
          status: 'active'
        })
        .eq('id', id);

      await fetchTools();
      return { valid: true };

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Validation failed';

      // Update validation status with error
      await supabase
        .from('tools')
        .update({
          last_validated_at: new Date().toISOString(),
          validation_error: errorMessage,
          status: 'error'
        })
        .eq('id', id);

      await fetchTools();
      return { valid: false, error: errorMessage };
    }
  };

  return {
    tools,
    isLoading,
    error,
    fetchTools,
    createTool,
    updateTool,
    deleteTool,
    validateTool
  };
}

// ============================================
// useAgentTools Hook - Agent-specific tool management
// ============================================

export function useAgentTools(agentId: string | undefined) {
  const [agentTools, setAgentTools] = useState<AgentToolWithDetails[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAgentTools = useCallback(async () => {
    if (!agentId) {
      setAgentTools([]);
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      setError(null);

      const { data, error: fetchError } = await supabase
        .from('agent_tools')
        .select(`
          *,
          tool:tools(*)
        `)
        .eq('agent_id', agentId)
        .order('sort_order', { ascending: true });

      if (fetchError) throw fetchError;

      // Transform to flat structure
      const transformed = (data || []).map((at: any) => ({
        ...at,
        tool: at.tool
      })) as AgentToolWithDetails[];

      setAgentTools(transformed);
    } catch (err) {
      console.error('Failed to fetch agent tools:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch agent tools');
    } finally {
      setIsLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    fetchAgentTools();
  }, [fetchAgentTools]);

  const addToolToAgent = async (request: CreateAgentToolRequest): Promise<AgentTool> => {
    // Get current max sort_order
    const maxOrder = agentTools.reduce((max, at) => Math.max(max, at.sort_order), -1);

    const { data, error } = await supabase
      .from('agent_tools')
      .insert({
        agent_id: request.agent_id,
        tool_id: request.tool_id,
        config_overrides: request.config_overrides || {},
        messages_overrides: request.messages_overrides || {},
        sort_order: request.sort_order ?? maxOrder + 1,
        is_enabled: request.is_enabled ?? true
      })
      .select()
      .single();

    if (error) throw error;

    await fetchAgentTools();
    return data as AgentTool;
  };

  const updateAgentTool = async (id: string, request: UpdateAgentToolRequest): Promise<AgentTool> => {
    const updateData: Record<string, any> = {};

    if (request.config_overrides !== undefined) updateData.config_overrides = request.config_overrides;
    if (request.messages_overrides !== undefined) updateData.messages_overrides = request.messages_overrides;
    if (request.sort_order !== undefined) updateData.sort_order = request.sort_order;
    if (request.is_enabled !== undefined) updateData.is_enabled = request.is_enabled;

    const { data, error } = await supabase
      .from('agent_tools')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    await fetchAgentTools();
    return data as AgentTool;
  };

  const removeToolFromAgent = async (id: string): Promise<void> => {
    const { error } = await supabase
      .from('agent_tools')
      .delete()
      .eq('id', id);

    if (error) throw error;

    await fetchAgentTools();
  };

  const toggleToolEnabled = async (id: string, enabled: boolean): Promise<void> => {
    await updateAgentTool(id, { is_enabled: enabled });
  };

  const reorderTools = async (toolIds: string[]): Promise<void> => {
    // Update sort_order for each tool
    const updates = toolIds.map((id, index) => 
      supabase
        .from('agent_tools')
        .update({ sort_order: index })
        .eq('id', id)
    );

    await Promise.all(updates);
    await fetchAgentTools();
  };

  return {
    agentTools,
    isLoading,
    error,
    fetchAgentTools,
    addToolToAgent,
    updateAgentTool,
    removeToolFromAgent,
    toggleToolEnabled,
    reorderTools
  };
}

// ============================================
// useToolById Hook - Single tool management
// ============================================

export function useToolById(toolId: string | undefined) {
  const [tool, setTool] = useState<Tool | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTool = useCallback(async () => {
    if (!toolId) {
      setTool(null);
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      setError(null);

      const { data, error: fetchError } = await supabase
        .from('tools')
        .select('*')
        .eq('id', toolId)
        .single();

      if (fetchError) throw fetchError;

      setTool(data as Tool);
    } catch (err) {
      console.error('Failed to fetch tool:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch tool');
    } finally {
      setIsLoading(false);
    }
  }, [toolId]);

  useEffect(() => {
    fetchTool();
  }, [fetchTool]);

  return {
    tool,
    isLoading,
    error,
    refetch: fetchTool
  };
}
