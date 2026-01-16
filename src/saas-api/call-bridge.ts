/**
 * Call Bridge
 * 
 * Bridges the SaaS API call management with the voice pipeline.
 * This is a THIN WRAPPER - it does NOT modify the pipeline.
 * 
 * Flow:
 * 1. SaaS API validates org/plan/concurrency
 * 2. SaaS API creates call record
 * 3. This bridge generates session config for the voice pipeline
 * 4. Client connects to voice pipeline WebSocket with the config
 * 5. On call end, metrics are collected and call record is finalized
 * 
 * The voice pipeline remains completely independent and can be used
 * directly via WebSocket without going through the SaaS API.
 */

import { OrgContext, Agent, Call, SaaSError } from './types';
import { getAgent } from './agents';
import { validateConcurrency } from './concurrency';
import { canUseMinutes, calculateCallCost } from './billing';
import { getEffectivePlanLimits, validateProviderSelection } from './plans';
import { supabaseAdmin } from './db';
import { createLogger } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';

const logger = createLogger('call-bridge');

/**
 * Session configuration returned to client for connecting to voice pipeline.
 */
export interface VoiceSessionConfig {
  // Session identifiers
  session_id: string;
  call_id: string;
  
  // WebSocket connection info
  websocket_url: string;
  
  // Provider configuration (pre-validated against plan)
  stt: {
    provider: string;
    config: Record<string, unknown>;
  };
  llm: {
    provider: string;
    config: Record<string, unknown>;
  };
  tts: {
    provider: string;
    config: Record<string, unknown>;
  };
  
  // Agent configuration
  system_prompt: string;
  first_message: string | null;
  language: string;
  voice_id: string | null;
  
  // Limits
  max_duration_seconds: number;
  
  // Metadata
  organization_id: string;
  agent_id: string;
}

/**
 * Request to start a call via SaaS API.
 */
export interface StartCallBridgeRequest {
  agent_id: string;
  direction: 'inbound' | 'outbound' | 'web';
  from_number?: string;
  to_number?: string;
  metadata?: Record<string, unknown>;
  
  // Optional overrides (must be allowed by plan)
  stt_provider_override?: string;
  tts_provider_override?: string;
  llm_provider_override?: string;
}

/**
 * Result of starting a call.
 */
export interface StartCallResult {
  call: Call;
  session_config: VoiceSessionConfig;
}

/**
 * Metrics collected from the voice pipeline when call ends.
 */
export interface CallMetrics {
  duration_seconds: number;
  llm_prompt_tokens: number;
  llm_completion_tokens: number;
  tts_characters: number;
  latency_first_response_ms: number | null;
  latency_avg_response_ms: number | null;
  interruptions_count: number;
  end_reason: string;
  error_message?: string;
}

/**
 * Start a call with full SaaS validation.
 * 
 * This function:
 * 1. Validates the agent exists and is active
 * 2. Validates provider selections against plan
 * 3. Checks concurrency limits (atomic)
 * 4. Checks usage/minute limits
 * 5. Creates call record
 * 6. Returns session config for voice pipeline
 */
export async function startCallWithValidation(
  orgContext: OrgContext,
  request: StartCallBridgeRequest
): Promise<StartCallResult> {
  const orgId = orgContext.organization.id;
  const limits = getEffectivePlanLimits(orgContext);

  // Step 1: Validate agent
  const agent = await getAgent(orgContext, request.agent_id);
  
  if (agent.status !== 'active') {
    throw SaaSError.validation(
      `Agent is not active (status: ${agent.status})`,
      { agent_id: request.agent_id, status: agent.status }
    );
  }

  // Step 2: Validate provider selections
  const sttProvider = request.stt_provider_override || agent.stt_provider;
  const ttsProvider = request.tts_provider_override || agent.tts_provider;
  const llmProvider = request.llm_provider_override || agent.llm_provider;

  validateProviderSelection(limits, 'stt', sttProvider);
  validateProviderSelection(limits, 'tts', ttsProvider);
  validateProviderSelection(limits, 'llm', llmProvider);

  // Step 3: Check concurrency limit (atomic)
  await validateConcurrency(orgContext);

  // Step 4: Check usage limits
  const usageCheck = await canUseMinutes(orgContext);
  if (!usageCheck.allowed) {
    throw new SaaSError(
      'USAGE_LIMIT_EXCEEDED',
      usageCheck.reason || 'Usage limit exceeded',
      402
    );
  }

  // Step 5: Create call record
  const callId = uuidv4();
  const sessionId = `session_${callId}`;

  const { data: callData, error: callError } = await supabaseAdmin
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
      status: 'in_progress',
      stt_provider: sttProvider,
      tts_provider: ttsProvider,
      llm_provider: llmProvider,
      metadata: request.metadata || {}
    })
    .select()
    .single();

  if (callError) {
    logger.error('Failed to create call record', { 
      orgId, 
      agentId: agent.id, 
      error: callError.message 
    });
    throw new SaaSError('INTERNAL_ERROR', 'Failed to start call', 500);
  }

  // Step 6: Build session config
  const wsPort = process.env.VOICE_API_PORT || process.env.PORT || '8080';
  const wsHost = process.env.VOICE_API_HOST || 'localhost';
  const wsProtocol = process.env.NODE_ENV === 'production' ? 'wss' : 'ws';

  const sessionConfig: VoiceSessionConfig = {
    session_id: sessionId,
    call_id: callId,
    websocket_url: `${wsProtocol}://${wsHost}:${wsPort}`,
    
    stt: {
      provider: sttProvider,
      config: agent.stt_config
    },
    llm: {
      provider: llmProvider,
      config: agent.llm_config
    },
    tts: {
      provider: ttsProvider,
      config: agent.tts_config
    },
    
    system_prompt: agent.system_prompt || '',
    first_message: agent.first_message,
    language: agent.language,
    voice_id: agent.voice_id,
    
    max_duration_seconds: agent.max_call_duration_seconds,
    
    organization_id: orgId,
    agent_id: agent.id
  };

  logger.info('Call started via SaaS bridge', {
    orgId,
    callId,
    agentId: agent.id,
    direction: request.direction,
    sessionId
  });

  return {
    call: callData as Call,
    session_config: sessionConfig
  };
}

/**
 * End a call and record metrics.
 * 
 * This should be called when the voice pipeline session ends.
 * It finalizes the call record with actual metrics and costs.
 */
export async function endCallWithMetrics(
  orgContext: OrgContext,
  callId: string,
  metrics: CallMetrics
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

  // Determine final status
  const finalStatus = metrics.error_message ? 'failed' : 'completed';

  // Calculate costs
  const costs = await calculateCallCost(
    metrics.duration_seconds,
    existingCall.stt_provider,
    existingCall.tts_provider,
    existingCall.llm_provider,
    {
      prompt: metrics.llm_prompt_tokens,
      completion: metrics.llm_completion_tokens
    }
  );

  // Update call record
  const { data: updatedCall, error: updateError } = await supabaseAdmin
    .from('calls')
    .update({
      status: finalStatus,
      ended_at: new Date().toISOString(),
      end_reason: metrics.end_reason,
      error_message: metrics.error_message || null,
      duration_seconds: metrics.duration_seconds,
      billed_minutes: costs.billed_minutes,
      llm_prompt_tokens: metrics.llm_prompt_tokens,
      llm_completion_tokens: metrics.llm_completion_tokens,
      tts_characters: metrics.tts_characters,
      latency_first_response_ms: metrics.latency_first_response_ms,
      latency_avg_response_ms: metrics.latency_avg_response_ms,
      interruptions_count: metrics.interruptions_count,
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

  // Create usage record (IMMUTABLE)
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
      unit_cost_cents: costs.billed_minutes > 0 ? Math.round(costs.cost_total_cents / costs.billed_minutes) : 0,
      total_cost_cents: costs.cost_total_cents,
      call_id: callId,
      provider_slug: existingCall.tts_provider,
      metadata: {
        stt_provider: existingCall.stt_provider,
        tts_provider: existingCall.tts_provider,
        llm_provider: existingCall.llm_provider,
        duration_seconds: metrics.duration_seconds,
        end_reason: metrics.end_reason
      }
    });

  if (usageError) {
    logger.error('Failed to create usage record', { callId, error: usageError.message });
    // Don't throw - call is still ended
  }

  logger.info('Call ended via SaaS bridge', {
    orgId,
    callId,
    duration: metrics.duration_seconds,
    billedMinutes: costs.billed_minutes,
    totalCostCents: costs.cost_total_cents,
    status: finalStatus
  });

  return updatedCall as Call;
}

/**
 * Generate a WebSocket start_session message from session config.
 * 
 * This converts the SaaS session config into the format expected
 * by the voice pipeline WebSocket.
 */
export function generateWebSocketMessage(config: VoiceSessionConfig): Record<string, unknown> {
  return {
    type: 'start_session',
    sessionId: config.session_id,
    config: {
      language: config.language,
      systemPrompt: config.system_prompt,
      stt: {
        provider: config.stt.provider,
        ...config.stt.config
      },
      llm: {
        provider: config.llm.provider,
        ...config.llm.config
      },
      tts: {
        provider: config.tts.provider,
        voiceId: config.voice_id,
        ...config.tts.config
      }
    },
    metadata: {
      call_id: config.call_id,
      organization_id: config.organization_id,
      agent_id: config.agent_id
    }
  };
}

/**
 * Get the voice pipeline WebSocket URL.
 */
export function getVoicePipelineUrl(): string {
  const port = process.env.VOICE_API_PORT || process.env.PORT || '8080';
  const host = process.env.VOICE_API_HOST || 'localhost';
  const protocol = process.env.NODE_ENV === 'production' ? 'wss' : 'ws';
  return `${protocol}://${host}:${port}`;
}
