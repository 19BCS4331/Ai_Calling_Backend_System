/**
 * Calls Module
 * 
 * Handles call lifecycle management with proper enforcement.
 * 
 * CALL LIFECYCLE:
 * 1. START: Validate concurrency + usage limits → Create call record
 * 2. IN PROGRESS: Call is active, tracked in concurrency count
 * 3. END: Finalize call, calculate costs, write usage record
 * 
 * IMPORTANT:
 * - Usage records are IMMUTABLE once created
 * - Costs are calculated in the API, not DB triggers
 * - All validations happen BEFORE the call starts
 */

import { supabaseAdmin } from './db';
import {
  OrgContext,
  Call,
  StartCallRequest,
  EndCallRequest,
  CallDirection,
  CallStatus,
  SaaSError,
  PaginatedResponse,
  PaginationParams
} from './types';
import { validateConcurrency } from './concurrency';
import { canUseMinutes, calculateCallCost } from './billing';
import { getAgent } from './agents';
import { createLogger } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';

const logger = createLogger('saas-calls');

/**
 * Start a new call.
 * 
 * This function:
 * 1. Validates the agent exists and is active
 * 2. Checks concurrency limits
 * 3. Checks usage/minute limits
 * 4. Creates the call record with status='in_progress'
 * 
 * Returns the call record which includes the call ID for tracking.
 */
export async function startCall(
  orgContext: OrgContext,
  request: StartCallRequest
): Promise<Call> {
  const orgId = orgContext.organization.id;

  // Step 1: Validate agent
  const agent = await getAgent(orgContext, request.agent_id);
  
  if (agent.status !== 'active') {
    throw SaaSError.validation(
      `Agent is not active (status: ${agent.status})`,
      { agent_id: request.agent_id, status: agent.status }
    );
  }

  // Step 2: Check concurrency limit (atomic)
  // This MUST happen before creating the call record
  await validateConcurrency(orgContext);

  // Step 3: Check if org can use more minutes
  const usageCheck = await canUseMinutes(orgContext);
  if (!usageCheck.allowed) {
    throw new SaaSError(
      'USAGE_LIMIT_EXCEEDED',
      usageCheck.reason || 'Usage limit exceeded',
      402
    );
  }

  // Step 4: Create call record
  const callId = uuidv4();
  const sessionId = `session_${callId}`;

  const { data, error } = await supabaseAdmin
    .from('calls')
    .insert({
      id: callId,
      organization_id: orgId,
      agent_id: agent.id,
      session_id: sessionId,
      direction: request.direction,
      from_number: request.from_number || null,
      to_number: request.to_number || null,
      started_at: new Date().toISOString(),
      status: 'in_progress' as CallStatus,
      stt_provider: agent.stt_provider,
      tts_provider: agent.tts_provider,
      llm_provider: agent.llm_provider,
      metadata: request.metadata || {}
    })
    .select()
    .single();

  if (error) {
    logger.error('Failed to create call record', { 
      orgId, 
      agentId: agent.id, 
      error: error.message 
    });
    throw new SaaSError('INTERNAL_ERROR', 'Failed to start call', 500);
  }

  logger.info('Call started', {
    orgId,
    callId: data.id,
    agentId: agent.id,
    direction: request.direction
  });

  return data as Call;
}

/**
 * End a call and finalize billing.
 * 
 * This function:
 * 1. Updates the call record with final metrics
 * 2. Calculates costs based on actual usage
 * 3. Creates immutable usage record
 * 
 * IMPORTANT: This must be called for EVERY call, even failed ones.
 * Otherwise concurrency counts will be incorrect.
 */
export async function endCall(
  orgContext: OrgContext,
  callId: string,
  request: EndCallRequest
): Promise<Call> {
  const orgId = orgContext.organization.id;

  // Fetch existing call
  const { data: existingCall, error: fetchError } = await supabaseAdmin
    .from('calls')
    .select('*')
    .eq('id', callId)
    .eq('organization_id', orgId)
    .single();

  if (fetchError || !existingCall) {
    throw SaaSError.notFound('Call');
  }

  // Prevent ending already-ended calls
  if (existingCall.status !== 'in_progress' && existingCall.status !== 'ringing') {
    throw SaaSError.validation(
      `Call is already ended (status: ${existingCall.status})`,
      { call_id: callId, status: existingCall.status }
    );
  }

  // Calculate costs
  const costs = await calculateCallCost(
    request.duration_seconds,
    existingCall.stt_provider,
    existingCall.tts_provider,
    existingCall.llm_provider,
    {
      prompt: request.llm_prompt_tokens || 0,
      completion: request.llm_completion_tokens || 0
    }
  );

  // Update call record
  const { data: updatedCall, error: updateError } = await supabaseAdmin
    .from('calls')
    .update({
      status: 'completed' as CallStatus,
      ended_at: new Date().toISOString(),
      end_reason: request.end_reason || 'normal',
      duration_seconds: request.duration_seconds,
      billed_minutes: costs.billed_minutes,
      llm_prompt_tokens: request.llm_prompt_tokens || 0,
      llm_completion_tokens: request.llm_completion_tokens || 0,
      latency_first_response_ms: request.latency_first_response_ms || null,
      latency_avg_response_ms: request.latency_avg_response_ms || null,
      interruptions_count: request.interruptions_count || 0,
      recording_url: request.recording_url || null,
      cost_telephony_cents: costs.cost_telephony_cents,
      cost_stt_cents: costs.cost_stt_cents,
      cost_tts_cents: costs.cost_tts_cents,
      cost_llm_cents: costs.cost_llm_cents,
      cost_total_cents: costs.cost_total_cents
    })
    .eq('id', callId)
    .eq('organization_id', orgId)
    .select()
    .single();

  if (updateError) {
    logger.error('Failed to end call', { callId, error: updateError.message });
    throw new SaaSError('INTERNAL_ERROR', 'Failed to end call', 500);
  }

  // Create usage record (IMMUTABLE - never update these)
  const { error: usageError } = await supabaseAdmin
    .from('usage_records')
    .insert({
      organization_id: orgId,
      subscription_id: orgContext.subscription?.id || null,
      period_start: orgContext.subscription?.current_period_start || new Date().toISOString(),
      period_end: orgContext.subscription?.current_period_end || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      usage_type: 'call_minutes',
      quantity: costs.billed_minutes,
      unit: 'minutes',
      unit_cost_cents: costs.cost_total_cents / costs.billed_minutes || 0,
      total_cost_cents: costs.cost_total_cents,
      call_id: callId,
      provider_slug: existingCall.tts_provider, // Primary cost driver
      metadata: {
        stt_provider: existingCall.stt_provider,
        tts_provider: existingCall.tts_provider,
        llm_provider: existingCall.llm_provider,
        duration_seconds: request.duration_seconds
      }
    });

  if (usageError) {
    // Log but don't fail - call is still ended
    logger.error('Failed to create usage record', { 
      callId, 
      error: usageError.message 
    });
  }

  logger.info('Call ended', {
    orgId,
    callId,
    duration: request.duration_seconds,
    billedMinutes: costs.billed_minutes,
    totalCostCents: costs.cost_total_cents
  });

  return updatedCall as Call;
}

/**
 * Mark a call as failed.
 * 
 * Use this when a call fails to connect or errors during processing.
 * Still records minimal metrics for debugging.
 */
export async function failCall(
  orgContext: OrgContext,
  callId: string,
  errorMessage: string,
  durationSeconds: number = 0
): Promise<Call> {
  const orgId = orgContext.organization.id;

  const { data, error } = await supabaseAdmin
    .from('calls')
    .update({
      status: 'failed' as CallStatus,
      ended_at: new Date().toISOString(),
      end_reason: 'error',
      error_message: errorMessage,
      duration_seconds: durationSeconds,
      billed_minutes: durationSeconds > 0 ? Math.ceil(durationSeconds / 60) : 0
    })
    .eq('id', callId)
    .eq('organization_id', orgId)
    .select()
    .single();

  if (error) {
    logger.error('Failed to mark call as failed', { callId, error: error.message });
    throw new SaaSError('INTERNAL_ERROR', 'Failed to update call', 500);
  }

  logger.warn('Call failed', {
    orgId,
    callId,
    errorMessage
  });

  return data as Call;
}

/**
 * Get a call by ID.
 */
export async function getCall(
  orgContext: OrgContext,
  callId: string
): Promise<Call> {
  const { data, error } = await supabaseAdmin
    .from('calls')
    .select('*')
    .eq('id', callId)
    .eq('organization_id', orgContext.organization.id)
    .single();

  if (error || !data) {
    throw SaaSError.notFound('Call');
  }

  return data as Call;
}

/**
 * List calls for an organization.
 */
export async function listCalls(
  orgContext: OrgContext,
  params: PaginationParams & {
    status?: CallStatus;
    direction?: CallDirection;
    agent_id?: string;
    start_date?: string;
    end_date?: string;
  } = {}
): Promise<PaginatedResponse<Call>> {
  const { 
    page = 1, 
    limit = 20, 
    status, 
    direction, 
    agent_id,
    start_date,
    end_date
  } = params;
  const offset = (page - 1) * limit;

  let query = supabaseAdmin
    .from('calls')
    .select('*', { count: 'exact' })
    .eq('organization_id', orgContext.organization.id)
    .order('started_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (status) {
    query = query.eq('status', status);
  }
  if (direction) {
    query = query.eq('direction', direction);
  }
  if (agent_id) {
    query = query.eq('agent_id', agent_id);
  }
  if (start_date) {
    query = query.gte('started_at', start_date);
  }
  if (end_date) {
    query = query.lte('started_at', end_date);
  }

  const { data, error, count } = await query;

  if (error) {
    logger.error('Failed to list calls', { error: error.message });
    throw new SaaSError('INTERNAL_ERROR', 'Failed to list calls', 500);
  }

  const total = count || 0;

  return {
    data: (data || []) as Call[],
    pagination: {
      page,
      limit,
      total,
      total_pages: Math.ceil(total / limit)
    }
  };
}

/**
 * Get call transcript.
 */
export async function getCallTranscript(
  orgContext: OrgContext,
  callId: string
): Promise<Array<{
  role: string;
  content: string;
  timestamp: string;
}>> {
  // Verify call belongs to org
  await getCall(orgContext, callId);

  const { data, error } = await supabaseAdmin
    .from('transcripts')
    .select('role, content, started_at')
    .eq('call_id', callId)
    .order('sequence', { ascending: true });

  if (error) {
    logger.error('Failed to get transcript', { callId, error: error.message });
    throw new SaaSError('INTERNAL_ERROR', 'Failed to get transcript', 500);
  }

  return (data || []).map(t => ({
    role: t.role,
    content: t.content,
    timestamp: t.started_at
  }));
}

/**
 * Add transcript segment to a call.
 * Called during the call to record conversation.
 */
export async function addTranscriptSegment(
  callId: string,
  segment: {
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string;
    sequence: number;
    confidence?: number;
    language_detected?: string;
    tokens_used?: number;
    tool_calls?: Record<string, unknown>[];
  }
): Promise<void> {
  const { error } = await supabaseAdmin
    .from('transcripts')
    .insert({
      call_id: callId,
      sequence: segment.sequence,
      role: segment.role,
      content: segment.content,
      started_at: new Date().toISOString(),
      confidence: segment.confidence || null,
      language_detected: segment.language_detected || null,
      tokens_used: segment.tokens_used || null,
      tool_calls: segment.tool_calls || null,
      is_final: true
    });

  if (error) {
    logger.error('Failed to add transcript segment', { 
      callId, 
      sequence: segment.sequence,
      error: error.message 
    });
    // Don't throw - transcript failure shouldn't stop the call
  }
}

/**
 * Get active calls for an organization.
 * Real-time view of in-progress calls.
 */
export async function getActiveCalls(
  orgContext: OrgContext
): Promise<Call[]> {
  const { data, error } = await supabaseAdmin
    .from('calls')
    .select('*')
    .eq('organization_id', orgContext.organization.id)
    .eq('status', 'in_progress')
    .order('started_at', { ascending: false });

  if (error) {
    logger.error('Failed to get active calls', { error: error.message });
    throw new SaaSError('INTERNAL_ERROR', 'Failed to get active calls', 500);
  }

  return (data || []) as Call[];
}

/**
 * Get call summary stats for a time period.
 */
export async function getCallStats(
  orgContext: OrgContext,
  startDate: Date,
  endDate: Date
): Promise<{
  total_calls: number;
  completed_calls: number;
  failed_calls: number;
  total_minutes: number;
  total_cost_cents: number;
  avg_duration_seconds: number;
  avg_latency_ms: number | null;
  by_direction: Record<CallDirection, number>;
}> {
  const { data, error } = await supabaseAdmin
    .from('calls')
    .select('status, direction, duration_seconds, billed_minutes, cost_total_cents, latency_first_response_ms')
    .eq('organization_id', orgContext.organization.id)
    .gte('started_at', startDate.toISOString())
    .lte('started_at', endDate.toISOString());

  if (error) {
    logger.error('Failed to get call stats', { error: error.message });
    throw new SaaSError('INTERNAL_ERROR', 'Failed to get call stats', 500);
  }

  const calls = data || [];
  const completed = calls.filter(c => c.status === 'completed');
  const failed = calls.filter(c => c.status === 'failed');

  const totalMinutes = completed.reduce((sum: number, c) => sum + (c.billed_minutes || 0), 0);
  const totalCost = completed.reduce((sum: number, c) => sum + (c.cost_total_cents || 0), 0);
  const totalDuration = completed.reduce((sum: number, c) => sum + (c.duration_seconds || 0), 0);

  const latencies = completed
    .filter(c => c.latency_first_response_ms !== null)
    .map(c => c.latency_first_response_ms as number);
  const avgLatency = latencies.length > 0
    ? latencies.reduce((sum, l) => sum + l, 0) / latencies.length
    : null;

  const byDirection: Record<CallDirection, number> = {
    inbound: 0,
    outbound: 0,
    web: 0
  };
  for (const call of calls) {
    byDirection[call.direction as CallDirection]++;
  }

  return {
    total_calls: calls.length,
    completed_calls: completed.length,
    failed_calls: failed.length,
    total_minutes: totalMinutes,
    total_cost_cents: totalCost,
    avg_duration_seconds: completed.length > 0 ? Math.round(totalDuration / completed.length) : 0,
    avg_latency_ms: avgLatency ? Math.round(avgLatency) : null,
    by_direction: byDirection
  };
}
