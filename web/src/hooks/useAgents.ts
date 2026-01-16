import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useOrganizationStore } from '../store/organization';
import type { Agent, AgentStatus, CreateAgentRequest, UpdateAgentRequest, AgentVersion } from '../lib/supabase-types';

export function useAgents(statusFilter?: AgentStatus) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { currentOrganization } = useOrganizationStore();

  const fetchAgents = async () => {
    if (!currentOrganization) {
      setAgents([]);
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      setError(null);

      let query = supabase
        .from('agents')
        .select('*')
        .eq('organization_id', currentOrganization.id)
        .order('created_at', { ascending: false });

      if (statusFilter) {
        query = query.eq('status', statusFilter);
      } else {
        // Exclude archived by default
        query = query.neq('status', 'archived');
      }

      const { data, error: fetchError } = await query;

      if (fetchError) throw fetchError;

      setAgents(data || []);
    } catch (err) {
      console.error('Failed to fetch agents:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch agents');
    } finally {
      setIsLoading(false);
    }
  };

  const createAgent = async (request: CreateAgentRequest): Promise<Agent> => {
    if (!currentOrganization) {
      throw new Error('No organization selected');
    }

    // Generate unique slug
    let slug = request.slug || request.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    let counter = 1;
    let uniqueSlug = slug;

    // Check for existing slugs (including archived agents)
    while (true) {
      const { data: existing } = await supabase
        .from('agents')
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
      .from('agents')
      .insert({
        organization_id: currentOrganization.id,
        name: request.name,
        slug: uniqueSlug,
        description: request.description || null,
        status: 'draft',
        system_prompt: request.system_prompt || null,
        stt_provider: request.stt_provider || 'sarvam',
        stt_config: request.stt_config || {},
        tts_provider: request.tts_provider || 'cartesia',
        tts_config: request.tts_config || { language: 'en-IN' },
        llm_provider: request.llm_provider || 'gemini-flash',
        llm_config: request.llm_config || { model: 'gemini-2.5-flash', temperature: 0.7 },
        voice_id: request.voice_id || null,
        language: request.language || 'en-IN',
        first_message: request.first_message || null,
        end_call_phrases: request.end_call_phrases || ['goodbye', 'bye', 'thank you'],
        interruption_sensitivity: request.interruption_sensitivity ?? 0.5,
        silence_timeout_ms: request.silence_timeout_ms ?? 5000,
        max_call_duration_seconds: request.max_call_duration_seconds ?? 600,
        tools_config: request.tools_config || [],
        version: 1,
        metadata: {}
      })
      .select()
      .single();

    if (error) throw error;

    await fetchAgents();
    return data as Agent;
  };

  const updateAgent = async (agentId: string, request: UpdateAgentRequest, createSnapshot: boolean = false): Promise<Agent> => {
    if (!currentOrganization) {
      throw new Error('No organization selected');
    }

    // Get current agent data before update
    const agent = agents.find(a => a.id === agentId);
    
    // Calculate new version number
    const newVersion = createSnapshot && agent ? agent.version + 1 : agent?.version;
    
    // Update agent first
    const { data, error } = await supabase
      .from('agents')
      .update({
        ...request,
        version: newVersion,
        // If agent is active and we're creating a snapshot, auto-publish the new version
        published_version: createSnapshot && agent?.status === 'active' ? newVersion : undefined,
      })
      .eq('id', agentId)
      .eq('organization_id', currentOrganization.id)
      .select()
      .single();

    if (error) throw error;

    const updatedAgent = data as Agent;

    // If creating snapshot, save the NEW state after update
    if (createSnapshot && agent) {
      const { data: { user } } = await supabase.auth.getUser();
      
      const configSnapshot = {
        name: updatedAgent.name,
        slug: updatedAgent.slug,
        description: updatedAgent.description,
        system_prompt: updatedAgent.system_prompt,
        stt_provider: updatedAgent.stt_provider,
        stt_config: updatedAgent.stt_config,
        tts_provider: updatedAgent.tts_provider,
        tts_config: updatedAgent.tts_config,
        llm_provider: updatedAgent.llm_provider,
        llm_config: updatedAgent.llm_config,
        voice_id: updatedAgent.voice_id,
        language: updatedAgent.language,
        first_message: updatedAgent.first_message,
        end_call_phrases: updatedAgent.end_call_phrases,
        interruption_sensitivity: updatedAgent.interruption_sensitivity,
        silence_timeout_ms: updatedAgent.silence_timeout_ms,
        max_call_duration_seconds: updatedAgent.max_call_duration_seconds,
        tools_config: updatedAgent.tools_config,
        metadata: updatedAgent.metadata,
      };

      // Save version snapshot with the NEW configuration
      await supabase
        .from('agent_versions')
        .insert({
          agent_id: agentId,
          version: updatedAgent.version,
          config_snapshot: configSnapshot,
          change_summary: 'Configuration updated',
          published_at: updatedAgent.status === 'active' ? new Date().toISOString() : null,
          published_by: user?.id || null,
        });
    }

    await fetchAgents();
    return updatedAgent;
  };

  const deleteAgent = async (agentId: string): Promise<void> => {
    if (!currentOrganization) {
      throw new Error('No organization selected');
    }

    // Archive instead of delete
    const { error } = await supabase
      .from('agents')
      .update({ status: 'archived' as AgentStatus })
      .eq('id', agentId)
      .eq('organization_id', currentOrganization.id);

    if (error) throw error;

    await fetchAgents();
  };

  const publishAgent = async (agentId: string, changeSummary?: string): Promise<Agent> => {
    if (!currentOrganization) {
      throw new Error('No organization selected');
    }

    const agent = agents.find(a => a.id === agentId);
    if (!agent) throw new Error('Agent not found');

    // Get current user
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    // Create version snapshot
    const configSnapshot = {
      name: agent.name,
      slug: agent.slug,
      description: agent.description,
      system_prompt: agent.system_prompt,
      stt_provider: agent.stt_provider,
      stt_config: agent.stt_config,
      tts_provider: agent.tts_provider,
      tts_config: agent.tts_config,
      llm_provider: agent.llm_provider,
      llm_config: agent.llm_config,
      voice_id: agent.voice_id,
      language: agent.language,
      first_message: agent.first_message,
      end_call_phrases: agent.end_call_phrases,
      interruption_sensitivity: agent.interruption_sensitivity,
      silence_timeout_ms: agent.silence_timeout_ms,
      max_call_duration_seconds: agent.max_call_duration_seconds,
      tools_config: agent.tools_config,
      metadata: agent.metadata,
    };

    // Save version snapshot
    const { error: versionError } = await supabase
      .from('agent_versions')
      .insert({
        agent_id: agentId,
        version: agent.version,
        config_snapshot: configSnapshot,
        change_summary: changeSummary || null,
        published_at: new Date().toISOString(),
        published_by: user.id,
      });

    if (versionError) throw versionError;

    // Update agent to active and increment version
    const { data, error } = await supabase
      .from('agents')
      .update({
        status: 'active' as AgentStatus,
        published_version: agent.version,
        version: agent.version + 1
      })
      .eq('id', agentId)
      .eq('organization_id', currentOrganization.id)
      .select()
      .single();

    if (error) throw error;

    await fetchAgents();
    return data as Agent;
  };

  const pauseAgent = async (agentId: string): Promise<Agent> => {
    return updateAgent(agentId, { status: 'paused' });
  };

  const getVersionHistory = async (agentId: string): Promise<AgentVersion[]> => {
    const { data, error } = await supabase
      .from('agent_versions')
      .select('*')
      .eq('agent_id', agentId)
      .order('version', { ascending: false });

    if (error) throw error;
    return data as AgentVersion[];
  };

  const rollbackToVersion = async (agentId: string, versionNumber: number): Promise<Agent> => {
    if (!currentOrganization) {
      throw new Error('No organization selected');
    }

    // Get the version snapshot
    const { data: versionData, error: versionError } = await supabase
      .from('agent_versions')
      .select('*')
      .eq('agent_id', agentId)
      .eq('version', versionNumber)
      .single();

    if (versionError) throw versionError;

    const version = versionData as AgentVersion;
    const config = version.config_snapshot;

    // Update agent with snapshot config and set as active with this published version
    const { data, error } = await supabase
      .from('agents')
      .update({
        name: config.name,
        description: config.description,
        system_prompt: config.system_prompt,
        stt_provider: config.stt_provider,
        stt_config: config.stt_config,
        tts_provider: config.tts_provider,
        tts_config: config.tts_config,
        llm_provider: config.llm_provider,
        llm_config: config.llm_config,
        voice_id: config.voice_id,
        language: config.language,
        first_message: config.first_message,
        end_call_phrases: config.end_call_phrases,
        interruption_sensitivity: config.interruption_sensitivity,
        silence_timeout_ms: config.silence_timeout_ms,
        max_call_duration_seconds: config.max_call_duration_seconds,
        tools_config: config.tools_config,
        metadata: config.metadata,
        status: 'active' as AgentStatus, // Set to active immediately
        published_version: versionNumber, // Set this version as published
        version: versionNumber + 1, // Increment version for future edits
      })
      .eq('id', agentId)
      .eq('organization_id', currentOrganization.id)
      .select()
      .single();

    if (error) throw error;

    await fetchAgents();
    return data as Agent;
  };

  useEffect(() => {
    fetchAgents();
  }, [currentOrganization?.id, statusFilter]);

  return {
    agents,
    isLoading,
    error,
    refetch: fetchAgents,
    createAgent,
    updateAgent,
    deleteAgent,
    publishAgent,
    pauseAgent,
    getVersionHistory,
    rollbackToVersion,
  };
}
