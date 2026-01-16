/**
 * Billing Module
 * 
 * Handles usage calculations, remaining minutes, and overage logic.
 * 
 * IMPORTANT: This module does NOT handle payments (Stripe/Razorpay).
 * It only provides the business logic for:
 * - Calculating remaining minutes in a billing period
 * - Determining overage eligibility
 * - Generating billing previews
 * 
 * Payment processing will be a separate module.
 * 
 * DATA INTEGRITY:
 * - Usage records are IMMUTABLE once created
 * - All calculations are based on actual usage records
 * - Billing period is defined by subscription dates
 */

import { supabaseAdmin } from './db';
import {
  OrgContext,
  EffectivePlanLimits,
  UsageSnapshot,
  UsageDailySummary,
  SaaSError
} from './types';
import { getEffectivePlanLimits } from './plans';
import { createLogger } from '../utils/logger';

const logger = createLogger('saas-billing');

/**
 * Get current usage for an organization within their billing period.
 * 
 * This is the authoritative source for:
 * - How many minutes have been used
 * - How many minutes remain
 * - Whether overage applies
 */
export async function getCurrentUsage(orgContext: OrgContext): Promise<UsageSnapshot> {
  const limits = getEffectivePlanLimits(orgContext);
  const orgId = orgContext.organization.id;

  // Get total billed minutes for current billing period
  // We use the calls table as source of truth for billing
  const { data: usageData, error: usageError } = await supabaseAdmin
    .from('calls')
    .select('billed_minutes, cost_total_cents')
    .eq('organization_id', orgId)
    .eq('status', 'completed')
    .gte('started_at', limits.period_start.toISOString())
    .lt('started_at', limits.period_end.toISOString());

  if (usageError) {
    logger.error('Failed to fetch usage', { orgId, error: usageError.message });
    throw new SaaSError('INTERNAL_ERROR', 'Failed to fetch usage data', 500);
  }

  // Calculate totals
  const totalMinutes = (usageData || []).reduce(
    (sum, call) => sum + (call.billed_minutes || 0), 
    0
  );
  const totalCostCents = (usageData || []).reduce(
    (sum, call) => sum + (call.cost_total_cents || 0), 
    0
  );
  const totalCalls = (usageData || []).length;

  // Calculate remaining and overage
  const remainingMinutes = Math.max(0, limits.included_minutes - totalMinutes);
  const overageMinutes = Math.max(0, totalMinutes - limits.included_minutes);

  // Get active call count
  const { count: activeCount, error: activeError } = await supabaseAdmin
    .from('calls')
    .select('*', { count: 'exact', head: true })
    .eq('organization_id', orgId)
    .eq('status', 'in_progress');

  if (activeError) {
    logger.error('Failed to count active calls', { orgId, error: activeError.message });
  }

  return {
    used_minutes: totalMinutes,
    remaining_minutes: remainingMinutes,
    overage_minutes: overageMinutes,
    total_calls: totalCalls,
    active_calls: activeCount || 0,
    total_cost_cents: totalCostCents,
    period_start: limits.period_start,
    period_end: limits.period_end
  };
}

/**
 * Check if organization can use more minutes.
 * 
 * This checks:
 * 1. If they have remaining included minutes
 * 2. If overage is allowed (subscription is active)
 * 
 * Returns { allowed: true } or { allowed: false, reason: string }
 */
export async function canUseMinutes(
  orgContext: OrgContext,
  requestedMinutes: number = 1
): Promise<{ allowed: boolean; reason?: string }> {
  const usage = await getCurrentUsage(orgContext);
  const limits = getEffectivePlanLimits(orgContext);

  // Check if they have remaining minutes
  if (usage.remaining_minutes >= requestedMinutes) {
    return { allowed: true };
  }

  // No remaining minutes - check if overage is allowed
  // Overage is only allowed for active subscriptions
  if (!orgContext.subscription) {
    return {
      allowed: false,
      reason: 'Free tier minutes exhausted. Please upgrade to continue.'
    };
  }

  const { status } = orgContext.subscription;
  if (status !== 'active' && status !== 'trialing') {
    return {
      allowed: false,
      reason: `Cannot use overage minutes with ${status} subscription`
    };
  }

  // Overage is allowed
  return { allowed: true };
}

/**
 * Calculate estimated bill for current period.
 * 
 * Returns:
 * - Base plan cost
 * - Overage cost
 * - Total estimated cost
 */
export async function calculateBillingPreview(
  orgContext: OrgContext
): Promise<{
  base_cost_cents: number;
  overage_minutes: number;
  overage_cost_cents: number;
  total_cost_cents: number;
  period_start: Date;
  period_end: Date;
}> {
  const usage = await getCurrentUsage(orgContext);
  const limits = getEffectivePlanLimits(orgContext);

  // Base plan cost
  let baseCostCents = 0;
  if (orgContext.subscription && orgContext.plan) {
    baseCostCents = orgContext.subscription.billing_interval === 'yearly'
      ? orgContext.plan.price_yearly_cents / 12 // Monthly equivalent
      : orgContext.plan.price_monthly_cents;

    // Apply custom price if set
    if (orgContext.subscription.custom_price_cents !== null) {
      baseCostCents = orgContext.subscription.custom_price_cents;
    }
  }

  // Overage cost
  const overageCostCents = usage.overage_minutes * limits.overage_rate_cents;

  return {
    base_cost_cents: baseCostCents,
    overage_minutes: usage.overage_minutes,
    overage_cost_cents: overageCostCents,
    total_cost_cents: baseCostCents + overageCostCents,
    period_start: limits.period_start,
    period_end: limits.period_end
  };
}

/**
 * Get daily usage breakdown for a date range.
 */
export async function getDailyUsage(
  orgId: string,
  startDate: Date,
  endDate: Date
): Promise<UsageDailySummary[]> {
  const { data, error } = await supabaseAdmin
    .from('usage_daily_summary')
    .select('*')
    .eq('organization_id', orgId)
    .gte('date', startDate.toISOString().split('T')[0])
    .lte('date', endDate.toISOString().split('T')[0])
    .order('date', { ascending: true });

  if (error) {
    logger.error('Failed to fetch daily usage', { orgId, error: error.message });
    throw new SaaSError('INTERNAL_ERROR', 'Failed to fetch usage data', 500);
  }

  return (data || []) as UsageDailySummary[];
}

/**
 * Get usage summary for the current billing period.
 */
export async function getBillingPeriodSummary(
  orgContext: OrgContext
): Promise<{
  usage: UsageSnapshot;
  daily_breakdown: UsageDailySummary[];
  limits: EffectivePlanLimits;
  billing_preview: Awaited<ReturnType<typeof calculateBillingPreview>>;
}> {
  const limits = getEffectivePlanLimits(orgContext);
  const usage = await getCurrentUsage(orgContext);
  const dailyBreakdown = await getDailyUsage(
    orgContext.organization.id,
    limits.period_start,
    limits.period_end
  );
  const billingPreview = await calculateBillingPreview(orgContext);

  return {
    usage,
    daily_breakdown: dailyBreakdown,
    limits,
    billing_preview: billingPreview
  };
}

/**
 * Check if organization is approaching usage limit.
 * Useful for sending warning notifications.
 * 
 * @param orgContext - Organization context
 * @param thresholdPercent - Warning threshold (default 80%)
 */
export async function isApproachingLimit(
  orgContext: OrgContext,
  thresholdPercent: number = 80
): Promise<{
  approaching: boolean;
  usage_percent: number;
  minutes_remaining: number;
}> {
  const usage = await getCurrentUsage(orgContext);
  const limits = getEffectivePlanLimits(orgContext);

  // If unlimited, never approaching
  if (limits.included_minutes === 0 || limits.included_minutes === -1) {
    return {
      approaching: false,
      usage_percent: 0,
      minutes_remaining: Infinity
    };
  }

  const usagePercent = (usage.used_minutes / limits.included_minutes) * 100;

  return {
    approaching: usagePercent >= thresholdPercent,
    usage_percent: Math.round(usagePercent * 100) / 100, // Round to 2 decimal places
    minutes_remaining: usage.remaining_minutes
  };
}

/**
 * Calculate cost for a specific call.
 * Used by the calls module to compute costs before writing.
 * 
 * This implements the cost calculation logic that was previously
 * in the database trigger, moved here for better control.
 */
export async function calculateCallCost(
  durationSeconds: number,
  sttProvider: string | null,
  ttsProvider: string | null,
  llmProvider: string | null,
  llmTokens: { prompt: number; completion: number }
): Promise<{
  billed_minutes: number;
  cost_telephony_cents: number;
  cost_stt_cents: number;
  cost_tts_cents: number;
  cost_llm_cents: number;
  cost_total_cents: number;
}> {
  // Get provider costs from database
  const { data: providers, error } = await supabaseAdmin
    .from('providers')
    .select('type, slug, cost_per_minute_cents, cost_per_1k_tokens_cents');

  if (error) {
    logger.error('Failed to fetch provider costs', { error: error.message });
    // Use default costs if fetch fails
  }

  // Build cost lookup
  const costLookup: Record<string, Record<string, number>> = {
    stt: {},
    tts: {},
    llm: {},
    telephony: {}
  };

  for (const provider of (providers || [])) {
    if (provider.cost_per_minute_cents) {
      costLookup[provider.type][provider.slug] = provider.cost_per_minute_cents;
    }
    if (provider.cost_per_1k_tokens_cents && provider.type === 'llm') {
      costLookup.llm[provider.slug] = provider.cost_per_1k_tokens_cents;
    }
  }

  // Default costs if not found
  const defaults = {
    telephony: 0.9, // $0.009/min
    stt: { sarvam: 0.6, deepgram: 1.25 },
    tts: { sarvam: 0.5, cartesia: 3.8 },
    llm: { 'gemini-flash': 0.2, 'gpt-4o-mini': 1.0 }
  };

  // Calculate billed minutes (rounded UP - this is critical for telephony)
  const billedMinutes = Math.ceil(durationSeconds / 60);
  const durationMinutes = durationSeconds / 60;

  // Telephony cost (always Plivo, billed per minute rounded up)
  const telephonyCost = billedMinutes * (costLookup.telephony['plivo'] || defaults.telephony);

  // STT cost (billed per actual duration)
  const sttCost = sttProvider
    ? Math.ceil(durationMinutes * (costLookup.stt[sttProvider] || defaults.stt.sarvam))
    : 0;

  // TTS cost (billed per actual duration)
  const ttsCost = ttsProvider
    ? Math.ceil(durationMinutes * (costLookup.tts[ttsProvider] || defaults.tts.cartesia))
    : 0;

  // LLM cost (billed per 1k tokens)
  const totalTokens = llmTokens.prompt + llmTokens.completion;
  const llmCost = llmProvider
    ? Math.ceil((totalTokens / 1000) * (costLookup.llm[llmProvider] || defaults.llm['gemini-flash']))
    : 0;

  const totalCost = telephonyCost + sttCost + ttsCost + llmCost;

  return {
    billed_minutes: billedMinutes,
    cost_telephony_cents: Math.round(telephonyCost),
    cost_stt_cents: Math.round(sttCost),
    cost_tts_cents: Math.round(ttsCost),
    cost_llm_cents: Math.round(llmCost),
    cost_total_cents: Math.round(totalCost)
  };
}
