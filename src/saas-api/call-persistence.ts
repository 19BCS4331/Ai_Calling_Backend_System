/**
 * Call Persistence Utility
 * 
 * Provides functions to create and end call records from the voice server
 * without requiring full OrgContext. Used by:
 * - api-server.ts for web calls
 * - telephony-manager.ts for telephony calls
 */

import { supabaseAdmin } from './db';
import { createLogger } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';

const logger = createLogger('call-persistence');

export interface CreateCallParams {
  organizationId?: string;
  agentId?: string;
  sessionId: string;
  direction: 'inbound' | 'outbound' | 'web';
  fromNumber?: string;
  toNumber?: string;
  sttProvider?: string;
  ttsProvider?: string;
  llmProvider?: string;
  metadata?: Record<string, unknown>;
}

export interface EndCallParams {
  callId: string;
  durationSeconds: number;
  endReason?: string;
  errorMessage?: string;
  llmPromptTokens?: number;
  llmCompletionTokens?: number;
  llmCachedTokens?: number;  // Cached tokens (get 75% discount)
  ttsCharacters?: number;
  latencyFirstResponseMs?: number;
  latencyAvgResponseMs?: number;
  interruptionsCount?: number;
}

interface ProviderCosts {
  stt: number;  // cents per minute
  tts: number;  // cents per 1k characters
  llm: number;  // cents per 1k tokens
}

// Default provider costs (fallback if not found in DB)
// Based on actual provider pricing as of Jan 2026
const DEFAULT_PROVIDER_COSTS: Record<string, ProviderCosts> = {
  // STT costs per minute (cents)
  sarvam: { stt: 0.90, tts: 0, llm: 0 },  // ₹45/hr = 0.9¢/min
  deepgram: { stt: 1.25, tts: 0, llm: 0 },
  google: { stt: 1.60, tts: 0, llm: 0 },
  azure: { stt: 1.40, tts: 0, llm: 0 },
  // TTS costs per 1k characters (cents)
  cartesia: { stt: 0, tts: 3.0, llm: 0 },  // $239/8M chars = 3¢/1K
  elevenlabs: { stt: 0, tts: 10.0, llm: 0 },
  // LLM costs per 1k tokens (cents)
  gemini: { stt: 0, tts: 0, llm: 0.14 },  // Normalized from gemini-flash
  'gemini-flash': { stt: 0, tts: 0, llm: 0.14 },  // $0.30 in + $2.50 out avg
  'gpt-4o-mini': { stt: 0, tts: 0, llm: 1.0 },
  'gpt-4o': { stt: 0, tts: 0, llm: 5.0 },
  'claude-sonnet': { stt: 0, tts: 0, llm: 3.0 },
  groq: { stt: 0, tts: 0, llm: 0.27 }
};

export interface CallRecord {
  id: string;
  organization_id: string | null;
  agent_id: string | null;
  session_id: string;
  direction: string;
  from_number: string | null;
  to_number: string | null;
  started_at: string;
  status: string;
}

/**
 * Create a call record in the database.
 * Used when a voice session starts.
 */
export async function createCallRecord(params: CreateCallParams): Promise<CallRecord | null> {
  const callId = uuidv4();

  try {
    const { data, error } = await supabaseAdmin
      .from('calls')
      .insert({
        id: callId,
        organization_id: params.organizationId || null,
        agent_id: params.agentId || null,
        session_id: params.sessionId,
        direction: params.direction,
        from_number: params.fromNumber || null,
        to_number: params.toNumber || null,
        started_at: new Date().toISOString(),
        status: 'in_progress',
        stt_provider: params.sttProvider || null,
        tts_provider: params.ttsProvider || null,
        llm_provider: params.llmProvider || null,
        metadata: params.metadata || {}
      })
      .select()
      .single();

    if (error) {
      logger.error('Failed to create call record', { 
        sessionId: params.sessionId,
        error: error.message 
      });
      return null;
    }

    logger.info('Call record created', {
      callId: data.id,
      sessionId: params.sessionId,
      direction: params.direction,
      organizationId: params.organizationId
    });

    return data as CallRecord;
  } catch (err) {
    logger.error('Exception creating call record', { 
      error: (err as Error).message 
    });
    return null;
  }
}

/**
 * Calculate costs for a call based on provider rates
 */
async function calculateCallCosts(
  callId: string,
  durationSeconds: number,
  llmPromptTokens: number,
  llmCompletionTokens: number,
  llmCachedTokens: number,
  ttsCharacters: number
): Promise<{ stt: number; tts: number; llm: number; total: number }> {
  try {
    // Get the call record to find provider names
    const { data: call } = await supabaseAdmin
      .from('calls')
      .select('stt_provider, tts_provider, llm_provider')
      .eq('id', callId)
      .single();

    if (!call) {
      return { stt: 0, tts: 0, llm: 0, total: 0 };
    }

    // Get provider costs from database
    const { data: providers } = await supabaseAdmin
      .from('providers')
      .select('slug, type, cost_per_minute_cents, cost_per_1k_tokens_cents, cost_per_1k_chars_cents, cost_cache_write_per_1k_tokens_cents, cost_cache_storage_per_1k_tokens_per_hour_cents')
      .in('slug', [call.stt_provider, call.tts_provider, call.llm_provider].filter(Boolean));

    // Build provider cost map by type
    const providerCostMap: Record<string, { 
      type: string; 
      perMinute?: number; 
      per1kTokens?: number; 
      per1kChars?: number;
      cacheWrite?: number;
      cacheStorage?: number;
    }> = {};
    if (providers) {
      for (const p of providers) {
        providerCostMap[p.slug] = {
          type: p.type,
          perMinute: p.cost_per_minute_cents,
          per1kTokens: p.cost_per_1k_tokens_cents,
          per1kChars: p.cost_per_1k_chars_cents,
          cacheWrite: p.cost_cache_write_per_1k_tokens_cents,
          cacheStorage: p.cost_cache_storage_per_1k_tokens_per_hour_cents
        };
      }
    }

    // Calculate STT cost (per minute) - uses cost_per_minute_cents
    const durationMinutes = durationSeconds / 60;
    const sttProvider = call.stt_provider;
    const sttDbCost = providerCostMap[sttProvider]?.perMinute;
    const sttRate = sttDbCost ?? DEFAULT_PROVIDER_COSTS[sttProvider]?.stt ?? 1.0;
    const sttCost = durationMinutes * sttRate;

    // Calculate TTS cost (per 1k characters) - uses cost_per_1k_chars_cents
    const ttsProvider = call.tts_provider;
    const ttsDbCost = providerCostMap[ttsProvider]?.per1kChars;
    const ttsRate = ttsDbCost ?? DEFAULT_PROVIDER_COSTS[ttsProvider]?.tts ?? 1.5;
    const ttsCost = (ttsCharacters / 1000) * ttsRate;

    // Calculate LLM cost (per 1k tokens) - uses cost_per_1k_tokens_cents
    // Apply 75% discount to cached tokens (Gemini explicit caching)
    const llmProvider = call.llm_provider;
    const llmDbCost = providerCostMap[llmProvider]?.per1kTokens;
    const llmRate = llmDbCost ?? DEFAULT_PROVIDER_COSTS[llmProvider]?.llm ?? 1.0;
    
    // Effective tokens: full price for non-cached, 25% price for cached (75% discount)
    const nonCachedPromptTokens = llmPromptTokens - llmCachedTokens;
    const effectivePromptTokens = nonCachedPromptTokens + (llmCachedTokens * 0.25);
    const totalTokens = effectivePromptTokens + llmCompletionTokens;
    let llmCost = (totalTokens / 1000) * llmRate;
    
    // Add cache costs if using explicit caching (from provider config)
    if (llmCachedTokens > 0) {
      const cacheWriteRate = providerCostMap[llmProvider]?.cacheWrite ?? 0.003; // Default: $0.03/1M
      const cacheStorageRate = providerCostMap[llmProvider]?.cacheStorage ?? 0.0001; // Default: $1/1M/hr
      
      const cacheCreationCost = (llmCachedTokens / 1000) * cacheWriteRate;
      const cacheStorageCost = (llmCachedTokens / 1000) * cacheStorageRate; // 1 hour TTL
      llmCost += cacheCreationCost + cacheStorageCost;
    }

    const totalCost = sttCost + ttsCost + llmCost;

    logger.debug('Call costs calculated', {
      callId,
      durationMinutes,
      ttsCharacters,
      llmTokens: { prompt: llmPromptTokens, cached: llmCachedTokens, completion: llmCompletionTokens, effective: totalTokens },
      providers: { stt: sttProvider, tts: ttsProvider, llm: llmProvider },
      rates: { stt: sttRate, tts: ttsRate, llm: llmRate },
      costs: { stt: sttCost, tts: ttsCost, llm: llmCost, total: totalCost }
    });

    return { stt: sttCost, tts: ttsCost, llm: llmCost, total: totalCost };
  } catch (err) {
    logger.error('Error calculating call costs', { callId, error: (err as Error).message });
    return { stt: 0, tts: 0, llm: 0, total: 0 };
  }
}

/**
 * Calculate user-facing cost based on organization's plan
 */
async function calculateUserCost(
  callId: string,
  durationSeconds: number
): Promise<number> {
  try {
    // Get call's organization and their subscription
    const { data: call } = await supabaseAdmin
      .from('calls')
      .select('organization_id')
      .eq('id', callId)
      .single();

    if (!call?.organization_id) {
      // No org, use PAYG rate
      const billedMinutes = Math.ceil(durationSeconds / 60);
      return billedMinutes * 15; // $0.15/min default
    }

    // Get active subscription with plan details
    const { data: subscription } = await supabaseAdmin
      .from('subscriptions')
      .select(`
        id,
        plan_id,
        plans (
          slug,
          overage_rate_cents,
          is_credit_based
        )
      `)
      .eq('organization_id', call.organization_id)
      .in('status', ['active', 'trialing'])
      .single();

    const billedMinutes = Math.ceil(durationSeconds / 60);
    const ratePerMin = (subscription?.plans as any)?.overage_rate_cents || 15;
    const userCost = billedMinutes * ratePerMin;

    // If credit-based plan, deduct from balance
    if (subscription && (subscription.plans as any)?.is_credit_based) {
      await supabaseAdmin.rpc('deduct_credit', {
        p_subscription_id: subscription.id,
        p_amount_cents: userCost
      });
    }

    return userCost;
  } catch (err) {
    logger.error('Error calculating user cost', { callId, error: (err as Error).message });
    // Fallback to PAYG rate
    const billedMinutes = Math.ceil(durationSeconds / 60);
    return billedMinutes * 15;
  }
}

/**
 * End a call record and update with final metrics.
 * Used when a voice session ends.
 */
export async function endCallRecord(params: EndCallParams): Promise<boolean> {
  try {
    // Calculate billed minutes (round up to nearest minute)
    const billedMinutes = Math.ceil(params.durationSeconds / 60);
    const finalStatus = params.errorMessage ? 'failed' : 'completed';

    // Calculate internal costs based on provider rates
    const costs = await calculateCallCosts(
      params.callId,
      params.durationSeconds,
      params.llmPromptTokens || 0,
      params.llmCompletionTokens || 0,
      params.llmCachedTokens || 0,
      params.ttsCharacters || 0
    );

    // Calculate user-facing cost based on their plan
    const userCost = await calculateUserCost(
      params.callId,
      params.durationSeconds
    );

    const { error } = await supabaseAdmin
      .from('calls')
      .update({
        status: finalStatus,
        ended_at: new Date().toISOString(),
        end_reason: params.endReason || 'normal',
        error_message: params.errorMessage || null,
        duration_seconds: params.durationSeconds,
        billed_minutes: billedMinutes,
        llm_prompt_tokens: params.llmPromptTokens || 0,
        llm_completion_tokens: params.llmCompletionTokens || 0,
        llm_cached_tokens: params.llmCachedTokens || 0,
        tts_characters: params.ttsCharacters || 0,
        latency_first_response_ms: params.latencyFirstResponseMs || null,
        latency_avg_response_ms: params.latencyAvgResponseMs || null,
        interruptions_count: params.interruptionsCount || 0,
        // Internal cost breakdown (for margin tracking)
        cost_stt_cents: costs.stt,
        cost_tts_cents: costs.tts,
        cost_llm_cents: costs.llm,
        cost_total_cents: costs.total,
        // User-facing cost (what we charge the customer)
        cost_user_cents: userCost
      })
      .eq('id', params.callId);

    if (error) {
      logger.error('Failed to end call record', { 
        callId: params.callId,
        error: error.message 
      });
      return false;
    }

    logger.info('Call record ended', {
      callId: params.callId,
      durationSeconds: params.durationSeconds,
      billedMinutes,
      status: finalStatus,
      costs: {
        internal: costs,
        user: userCost,
        margin: userCost - costs.total
      }
    });

    return true;
  } catch (err) {
    logger.error('Exception ending call record', { 
      callId: params.callId,
      error: (err as Error).message 
    });
    return false;
  }
}

/**
 * Find a call record by session ID.
 */
export async function findCallBySessionId(sessionId: string): Promise<CallRecord | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from('calls')
      .select('*')
      .eq('session_id', sessionId)
      .single();

    if (error || !data) {
      return null;
    }

    return data as CallRecord;
  } catch {
    return null;
  }
}

/**
 * Lookup organization ID from agent ID.
 * Used when we have an agent but need the org for the call record.
 */
export async function getOrgIdFromAgent(agentId: string): Promise<string | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from('agents')
      .select('organization_id')
      .eq('id', agentId)
      .single();

    if (error || !data) {
      return null;
    }

    return data.organization_id;
  } catch {
    return null;
  }
}
