/**
 * Agents Module
 * 
 * CRUD operations for voice agents with plan enforcement.
 * 
 * ENFORCEMENT POINTS:
 * 1. Agent count limit per plan
 * 2. Provider selection must match plan allowlist
 * 3. Only owners/admins can create/update agents
 * 4. Agents are scoped to organizations (RLS enforced)
 */

import { supabaseAdmin } from './db';
import {
  OrgContext,
  Agent,
  CreateAgentRequest,
  UpdateAgentRequest,
  AgentStatus,
  SaaSError,
  PaginatedResponse,
  PaginationParams
} from './types';
import { 
  getEffectivePlanLimits, 
  validateProviderSelection,
  canAddAgent 
} from './plans';
import { createLogger } from '../utils/logger';

const logger = createLogger('saas-agents');

/**
 * Generate a URL-safe slug from a name.
 */
function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 50);
}

/**
 * Ensure slug is unique within the organization.
 */
async function ensureUniqueSlug(
  orgId: string,
  baseSlug: string,
  excludeId?: string
): Promise<string> {
  let slug = baseSlug;
  let counter = 1;

  while (true) {
    const query = supabaseAdmin
      .from('agents')
      .select('id')
      .eq('organization_id', orgId)
      .eq('slug', slug);

    if (excludeId) {
      query.neq('id', excludeId);
    }

    const { data } = await query.single();

    if (!data) {
      return slug;
    }

    slug = `${baseSlug}-${counter}`;
    counter++;

    if (counter > 100) {
      throw new SaaSError('INTERNAL_ERROR', 'Could not generate unique slug', 500);
    }
  }
}

/**
 * Validate agent providers against plan.
 */
function validateAgentProviders(
  orgContext: OrgContext,
  sttProvider?: string,
  ttsProvider?: string,
  llmProvider?: string
): void {
  const limits = getEffectivePlanLimits(orgContext);

  if (sttProvider) {
    validateProviderSelection(limits, 'stt', sttProvider);
  }
  if (ttsProvider) {
    validateProviderSelection(limits, 'tts', ttsProvider);
  }
  if (llmProvider) {
    validateProviderSelection(limits, 'llm', llmProvider);
  }
}

/**
 * Create a new agent.
 * 
 * Enforces:
 * - Agent count limit
 * - Provider allowlist
 */
export async function createAgent(
  orgContext: OrgContext,
  request: CreateAgentRequest
): Promise<Agent> {
  const orgId = orgContext.organization.id;

  // Check agent limit
  const agentCheck = await canAddAgent(orgContext);
  if (!agentCheck.allowed) {
    throw SaaSError.planLimit('agents', agentCheck.current!, agentCheck.max!);
  }

  // Validate providers
  validateAgentProviders(
    orgContext,
    request.stt_provider,
    request.tts_provider,
    request.llm_provider
  );

  // Generate unique slug
  const baseSlug = request.slug || generateSlug(request.name);
  const slug = await ensureUniqueSlug(orgId, baseSlug);

  // Create agent
  const { data, error } = await supabaseAdmin
    .from('agents')
    .insert({
      organization_id: orgId,
      name: request.name,
      slug,
      description: request.description || null,
      status: 'draft' as AgentStatus,
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
      tools_config: request.tools_config || [],
      created_by: orgContext.user.id
    })
    .select()
    .single();

  if (error) {
    logger.error('Failed to create agent', { orgId, error: error.message });
    throw new SaaSError('INTERNAL_ERROR', 'Failed to create agent', 500);
  }

  logger.info('Agent created', { 
    orgId, 
    agentId: data.id, 
    name: request.name 
  });

  return data as Agent;
}

/**
 * Get an agent by ID.
 */
export async function getAgent(
  orgContext: OrgContext,
  agentId: string
): Promise<Agent> {
  const { data, error } = await supabaseAdmin
    .from('agents')
    .select('*')
    .eq('id', agentId)
    .eq('organization_id', orgContext.organization.id)
    .single();

  if (error || !data) {
    throw SaaSError.notFound('Agent');
  }

  return data as Agent;
}

/**
 * Get an agent by slug.
 */
export async function getAgentBySlug(
  orgContext: OrgContext,
  slug: string
): Promise<Agent> {
  const { data, error } = await supabaseAdmin
    .from('agents')
    .select('*')
    .eq('slug', slug)
    .eq('organization_id', orgContext.organization.id)
    .single();

  if (error || !data) {
    throw SaaSError.notFound('Agent');
  }

  return data as Agent;
}

/**
 * List all agents for an organization.
 */
export async function listAgents(
  orgContext: OrgContext,
  params: PaginationParams & { status?: AgentStatus } = {}
): Promise<PaginatedResponse<Agent>> {
  const { page = 1, limit = 20, status } = params;
  const offset = (page - 1) * limit;

  // Build query
  let query = supabaseAdmin
    .from('agents')
    .select('*', { count: 'exact' })
    .eq('organization_id', orgContext.organization.id)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (status) {
    query = query.eq('status', status);
  } else {
    // Exclude archived by default
    query = query.neq('status', 'archived');
  }

  const { data, error, count } = await query;

  if (error) {
    logger.error('Failed to list agents', { error: error.message });
    throw new SaaSError('INTERNAL_ERROR', 'Failed to list agents', 500);
  }

  const total = count || 0;

  return {
    data: (data || []) as Agent[],
    pagination: {
      page,
      limit,
      total,
      total_pages: Math.ceil(total / limit)
    }
  };
}

/**
 * Update an agent.
 * 
 * Enforces provider allowlist on updates.
 */
export async function updateAgent(
  orgContext: OrgContext,
  agentId: string,
  request: UpdateAgentRequest
): Promise<Agent> {
  // Verify agent exists and belongs to org
  await getAgent(orgContext, agentId);

  // Validate providers if being updated
  validateAgentProviders(
    orgContext,
    request.stt_provider,
    request.tts_provider,
    request.llm_provider
  );

  // Handle slug update
  let slug: string | undefined;
  if (request.slug) {
    slug = await ensureUniqueSlug(
      orgContext.organization.id,
      request.slug,
      agentId
    );
  }

  // Build update object
  const updateData: Record<string, unknown> = {};
  
  if (request.name !== undefined) updateData.name = request.name;
  if (slug !== undefined) updateData.slug = slug;
  if (request.description !== undefined) updateData.description = request.description;
  if (request.status !== undefined) updateData.status = request.status;
  if (request.system_prompt !== undefined) updateData.system_prompt = request.system_prompt;
  if (request.stt_provider !== undefined) updateData.stt_provider = request.stt_provider;
  if (request.stt_config !== undefined) updateData.stt_config = request.stt_config;
  if (request.tts_provider !== undefined) updateData.tts_provider = request.tts_provider;
  if (request.tts_config !== undefined) updateData.tts_config = request.tts_config;
  if (request.llm_provider !== undefined) updateData.llm_provider = request.llm_provider;
  if (request.llm_config !== undefined) updateData.llm_config = request.llm_config;
  if (request.voice_id !== undefined) updateData.voice_id = request.voice_id;
  if (request.language !== undefined) updateData.language = request.language;
  if (request.first_message !== undefined) updateData.first_message = request.first_message;
  if (request.end_call_phrases !== undefined) updateData.end_call_phrases = request.end_call_phrases;
  if (request.tools_config !== undefined) updateData.tools_config = request.tools_config;

  if (Object.keys(updateData).length === 0) {
    // No changes, return existing agent
    return getAgent(orgContext, agentId);
  }

  // Update
  const { data, error } = await supabaseAdmin
    .from('agents')
    .update(updateData)
    .eq('id', agentId)
    .eq('organization_id', orgContext.organization.id)
    .select()
    .single();

  if (error) {
    logger.error('Failed to update agent', { agentId, error: error.message });
    throw new SaaSError('INTERNAL_ERROR', 'Failed to update agent', 500);
  }

  logger.info('Agent updated', { 
    orgId: orgContext.organization.id, 
    agentId,
    changes: Object.keys(updateData)
  });

  return data as Agent;
}

/**
 * Delete (archive) an agent.
 * 
 * We don't hard-delete agents to preserve call history references.
 * Instead, we set status to 'archived'.
 */
export async function deleteAgent(
  orgContext: OrgContext,
  agentId: string
): Promise<void> {
  // Verify agent exists
  await getAgent(orgContext, agentId);

  // Archive instead of delete
  const { error } = await supabaseAdmin
    .from('agents')
    .update({ status: 'archived' as AgentStatus })
    .eq('id', agentId)
    .eq('organization_id', orgContext.organization.id);

  if (error) {
    logger.error('Failed to delete agent', { agentId, error: error.message });
    throw new SaaSError('INTERNAL_ERROR', 'Failed to delete agent', 500);
  }

  logger.info('Agent archived', { 
    orgId: orgContext.organization.id, 
    agentId 
  });
}

/**
 * Publish an agent (set status to active).
 */
export async function publishAgent(
  orgContext: OrgContext,
  agentId: string
): Promise<Agent> {
  const agent = await getAgent(orgContext, agentId);

  // Validate agent has required fields
  if (!agent.system_prompt) {
    throw SaaSError.validation('Agent must have a system prompt to be published');
  }

  // Update status and increment version
  const { data, error } = await supabaseAdmin
    .from('agents')
    .update({
      status: 'active' as AgentStatus,
      published_version: agent.version,
      version: agent.version + 1
    })
    .eq('id', agentId)
    .eq('organization_id', orgContext.organization.id)
    .select()
    .single();

  if (error) {
    logger.error('Failed to publish agent', { agentId, error: error.message });
    throw new SaaSError('INTERNAL_ERROR', 'Failed to publish agent', 500);
  }

  // Create version snapshot
  await supabaseAdmin
    .from('agent_versions')
    .insert({
      agent_id: agentId,
      version: agent.version,
      config_snapshot: {
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
        tools_config: agent.tools_config
      },
      published_at: new Date().toISOString(),
      published_by: orgContext.user.id
    });

  logger.info('Agent published', { 
    orgId: orgContext.organization.id, 
    agentId,
    version: agent.version
  });

  return data as Agent;
}

/**
 * Pause an agent (prevent new calls).
 */
export async function pauseAgent(
  orgContext: OrgContext,
  agentId: string
): Promise<Agent> {
  return updateAgent(orgContext, agentId, { status: 'paused' });
}

/**
 * Get agent statistics.
 */
export async function getAgentStats(
  orgContext: OrgContext,
  agentId: string
): Promise<{
  total_calls: number;
  total_minutes: number;
  avg_duration_seconds: number;
  avg_latency_ms: number | null;
}> {
  // Verify agent belongs to org
  await getAgent(orgContext, agentId);

  const { data, error } = await supabaseAdmin
    .from('calls')
    .select('duration_seconds, latency_first_response_ms')
    .eq('agent_id', agentId)
    .eq('status', 'completed');

  if (error) {
    logger.error('Failed to get agent stats', { agentId, error: error.message });
    throw new SaaSError('INTERNAL_ERROR', 'Failed to get agent stats', 500);
  }

  const calls = data || [];
  const totalCalls = calls.length;
  const totalSeconds = calls.reduce((sum, c) => sum + (c.duration_seconds || 0), 0);
  const totalMinutes = Math.ceil(totalSeconds / 60);
  const avgDuration = totalCalls > 0 ? totalSeconds / totalCalls : 0;

  const latencies = calls
    .filter(c => c.latency_first_response_ms !== null)
    .map(c => c.latency_first_response_ms as number);
  const avgLatency = latencies.length > 0
    ? latencies.reduce((sum, l) => sum + l, 0) / latencies.length
    : null;

  return {
    total_calls: totalCalls,
    total_minutes: totalMinutes,
    avg_duration_seconds: Math.round(avgDuration),
    avg_latency_ms: avgLatency ? Math.round(avgLatency) : null
  };
}
