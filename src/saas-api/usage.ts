/**
 * Usage Module
 * 
 * Read-only usage data and aggregations.
 * 
 * IMPORTANT: This module is READ-ONLY.
 * Usage records are created by the calls module and are IMMUTABLE.
 * 
 * Use cases:
 * - Dashboard usage display
 * - Billing previews
 * - Analytics and reporting
 */

import { supabaseAdmin } from './db';
import {
  OrgContext,
  UsageSnapshot,
  UsageDailySummary,
  UsageRecord,
  SaaSError,
  PaginatedResponse,
  PaginationParams
} from './types';
import { getEffectivePlanLimits } from './plans';
import { getCurrentUsage, getDailyUsage, calculateBillingPreview } from './billing';
import { createLogger } from '../utils/logger';

const logger = createLogger('saas-usage');

/**
 * Get usage overview for dashboard.
 */
export async function getUsageOverview(
  orgContext: OrgContext
): Promise<{
  current_period: UsageSnapshot;
  limits: {
    included_minutes: number;
    max_concurrent_calls: number;
    overage_rate_cents: number;
  };
  billing_preview: {
    base_cost_cents: number;
    overage_cost_cents: number;
    total_cost_cents: number;
  };
  usage_percent: number;
}> {
  const limits = getEffectivePlanLimits(orgContext);
  const currentUsage = await getCurrentUsage(orgContext);
  const preview = await calculateBillingPreview(orgContext);

  const usagePercent = limits.included_minutes > 0
    ? Math.round((currentUsage.used_minutes / limits.included_minutes) * 100)
    : 0;

  return {
    current_period: currentUsage,
    limits: {
      included_minutes: limits.included_minutes,
      max_concurrent_calls: limits.max_concurrent_calls,
      overage_rate_cents: limits.overage_rate_cents
    },
    billing_preview: {
      base_cost_cents: preview.base_cost_cents,
      overage_cost_cents: preview.overage_cost_cents,
      total_cost_cents: preview.total_cost_cents
    },
    usage_percent: Math.min(usagePercent, 100) // Cap at 100 for display
  };
}

/**
 * Get daily usage breakdown for charts.
 */
export async function getDailyUsageBreakdown(
  orgContext: OrgContext,
  days: number = 30
): Promise<{
  daily: UsageDailySummary[];
  totals: {
    calls: number;
    minutes: number;
    cost_cents: number;
  };
}> {
  const endDate = new Date();
  const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const daily = await getDailyUsage(
    orgContext.organization.id,
    startDate,
    endDate
  );

  // Calculate totals
  const totals = daily.reduce(
    (acc, day) => ({
      calls: acc.calls + (day.total_calls || 0),
      minutes: acc.minutes + (day.total_minutes || 0),
      cost_cents: acc.cost_cents + (day.total_cost_cents || 0)
    }),
    { calls: 0, minutes: 0, cost_cents: 0 }
  );

  return { daily, totals };
}

/**
 * Get usage by provider for cost analysis.
 */
export async function getUsageByProvider(
  orgContext: OrgContext,
  startDate: Date,
  endDate: Date
): Promise<{
  stt: Record<string, { minutes: number; cost_cents: number }>;
  tts: Record<string, { minutes: number; cost_cents: number }>;
  llm: Record<string, { minutes: number; cost_cents: number }>;
  telephony: { minutes: number; cost_cents: number };
}> {
  const { data, error } = await supabaseAdmin
    .from('calls')
    .select('stt_provider, tts_provider, llm_provider, duration_seconds, cost_stt_cents, cost_tts_cents, cost_llm_cents, cost_telephony_cents')
    .eq('organization_id', orgContext.organization.id)
    .eq('status', 'completed')
    .gte('started_at', startDate.toISOString())
    .lte('started_at', endDate.toISOString());

  if (error) {
    logger.error('Failed to get usage by provider', { error: error.message });
    throw new SaaSError('INTERNAL_ERROR', 'Failed to get usage data', 500);
  }

  const result = {
    stt: {} as Record<string, { minutes: number; cost_cents: number }>,
    tts: {} as Record<string, { minutes: number; cost_cents: number }>,
    llm: {} as Record<string, { minutes: number; cost_cents: number }>,
    telephony: { minutes: 0, cost_cents: 0 }
  };

  for (const call of (data || [])) {
    const minutes = Math.ceil((call.duration_seconds || 0) / 60);

    // STT
    if (call.stt_provider) {
      if (!result.stt[call.stt_provider]) {
        result.stt[call.stt_provider] = { minutes: 0, cost_cents: 0 };
      }
      result.stt[call.stt_provider].minutes += minutes;
      result.stt[call.stt_provider].cost_cents += call.cost_stt_cents || 0;
    }

    // TTS
    if (call.tts_provider) {
      if (!result.tts[call.tts_provider]) {
        result.tts[call.tts_provider] = { minutes: 0, cost_cents: 0 };
      }
      result.tts[call.tts_provider].minutes += minutes;
      result.tts[call.tts_provider].cost_cents += call.cost_tts_cents || 0;
    }

    // LLM
    if (call.llm_provider) {
      if (!result.llm[call.llm_provider]) {
        result.llm[call.llm_provider] = { minutes: 0, cost_cents: 0 };
      }
      result.llm[call.llm_provider].minutes += minutes;
      result.llm[call.llm_provider].cost_cents += call.cost_llm_cents || 0;
    }

    // Telephony
    result.telephony.minutes += minutes;
    result.telephony.cost_cents += call.cost_telephony_cents || 0;
  }

  return result;
}

/**
 * Get usage records (detailed audit trail).
 */
export async function getUsageRecords(
  orgContext: OrgContext,
  params: PaginationParams & {
    start_date?: string;
    end_date?: string;
    usage_type?: string;
  } = {}
): Promise<PaginatedResponse<UsageRecord>> {
  const { page = 1, limit = 50, start_date, end_date, usage_type } = params;
  const offset = (page - 1) * limit;

  let query = supabaseAdmin
    .from('usage_records')
    .select('*', { count: 'exact' })
    .eq('organization_id', orgContext.organization.id)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (start_date) {
    query = query.gte('created_at', start_date);
  }
  if (end_date) {
    query = query.lte('created_at', end_date);
  }
  if (usage_type) {
    query = query.eq('usage_type', usage_type);
  }

  const { data, error, count } = await query;

  if (error) {
    logger.error('Failed to get usage records', { error: error.message });
    throw new SaaSError('INTERNAL_ERROR', 'Failed to get usage records', 500);
  }

  return {
    data: (data || []) as UsageRecord[],
    pagination: {
      page,
      limit,
      total: count || 0,
      total_pages: Math.ceil((count || 0) / limit)
    }
  };
}

/**
 * Get usage trends over time.
 */
export async function getUsageTrends(
  orgContext: OrgContext,
  period: 'week' | 'month' | 'quarter' = 'month'
): Promise<{
  current: { calls: number; minutes: number; cost_cents: number };
  previous: { calls: number; minutes: number; cost_cents: number };
  change: { calls_percent: number; minutes_percent: number; cost_percent: number };
}> {
  const now = new Date();
  let periodDays: number;

  switch (period) {
    case 'week':
      periodDays = 7;
      break;
    case 'quarter':
      periodDays = 90;
      break;
    default:
      periodDays = 30;
  }

  const currentStart = new Date(now.getTime() - periodDays * 24 * 60 * 60 * 1000);
  const previousStart = new Date(currentStart.getTime() - periodDays * 24 * 60 * 60 * 1000);

  // Get current period
  const { data: currentData } = await supabaseAdmin
    .from('calls')
    .select('billed_minutes, cost_total_cents')
    .eq('organization_id', orgContext.organization.id)
    .eq('status', 'completed')
    .gte('started_at', currentStart.toISOString())
    .lte('started_at', now.toISOString());

  // Get previous period
  const { data: previousData } = await supabaseAdmin
    .from('calls')
    .select('billed_minutes, cost_total_cents')
    .eq('organization_id', orgContext.organization.id)
    .eq('status', 'completed')
    .gte('started_at', previousStart.toISOString())
    .lt('started_at', currentStart.toISOString());

  const current = {
    calls: (currentData || []).length,
    minutes: (currentData || []).reduce((sum: number, c: { billed_minutes: number }) => sum + (c.billed_minutes || 0), 0),
    cost_cents: (currentData || []).reduce((sum: number, c: { cost_total_cents: number }) => sum + (c.cost_total_cents || 0), 0)
  };

  const previous = {
    calls: (previousData || []).length,
    minutes: (previousData || []).reduce((sum: number, c: { billed_minutes: number }) => sum + (c.billed_minutes || 0), 0),
    cost_cents: (previousData || []).reduce((sum: number, c: { cost_total_cents: number }) => sum + (c.cost_total_cents || 0), 0)
  };

  // Calculate percent change
  const calcChange = (curr: number, prev: number): number => {
    if (prev === 0) return curr > 0 ? 100 : 0;
    return Math.round(((curr - prev) / prev) * 100);
  };

  return {
    current,
    previous,
    change: {
      calls_percent: calcChange(current.calls, previous.calls),
      minutes_percent: calcChange(current.minutes, previous.minutes),
      cost_percent: calcChange(current.cost_cents, previous.cost_cents)
    }
  };
}

/**
 * Export usage data as CSV-ready format.
 */
export async function exportUsageData(
  orgContext: OrgContext,
  startDate: Date,
  endDate: Date
): Promise<Array<{
  date: string;
  call_id: string;
  agent_name: string;
  direction: string;
  duration_seconds: number;
  billed_minutes: number;
  cost_cents: number;
  stt_provider: string;
  tts_provider: string;
  llm_provider: string;
}>> {
  const { data, error } = await supabaseAdmin
    .from('calls')
    .select(`
      id,
      started_at,
      direction,
      duration_seconds,
      billed_minutes,
      cost_total_cents,
      stt_provider,
      tts_provider,
      llm_provider,
      agents (name)
    `)
    .eq('organization_id', orgContext.organization.id)
    .eq('status', 'completed')
    .gte('started_at', startDate.toISOString())
    .lte('started_at', endDate.toISOString())
    .order('started_at', { ascending: true });

  if (error) {
    logger.error('Failed to export usage data', { error: error.message });
    throw new SaaSError('INTERNAL_ERROR', 'Failed to export usage data', 500);
  }

  return (data || []).map((call: Record<string, unknown>) => ({
    date: new Date(call.started_at as string).toISOString().split('T')[0],
    call_id: call.id as string,
    agent_name: (call.agents as { name: string }[] | null)?.[0]?.name || 'Unknown',
    direction: call.direction as string,
    duration_seconds: call.duration_seconds as number || 0,
    billed_minutes: call.billed_minutes as number || 0,
    cost_cents: call.cost_total_cents as number || 0,
    stt_provider: call.stt_provider as string || '',
    tts_provider: call.tts_provider as string || '',
    llm_provider: call.llm_provider as string || ''
  }));
}

/**
 * Get top agents by usage.
 */
export async function getTopAgentsByUsage(
  orgContext: OrgContext,
  limit: number = 5
): Promise<Array<{
  agent_id: string;
  agent_name: string;
  total_calls: number;
  total_minutes: number;
  total_cost_cents: number;
}>> {
  const { data, error } = await supabaseAdmin
    .from('calls')
    .select('agent_id, billed_minutes, cost_total_cents, agents (name)')
    .eq('organization_id', orgContext.organization.id)
    .eq('status', 'completed')
    .not('agent_id', 'is', null);

  if (error) {
    logger.error('Failed to get top agents', { error: error.message });
    throw new SaaSError('INTERNAL_ERROR', 'Failed to get usage data', 500);
  }

  // Aggregate by agent
  const agentStats: Record<string, {
    agent_id: string;
    agent_name: string;
    total_calls: number;
    total_minutes: number;
    total_cost_cents: number;
  }> = {};

  for (const call of (data || [])) {
    const agentId = call.agent_id as string;
    if (!agentStats[agentId]) {
      agentStats[agentId] = {
        agent_id: agentId,
        agent_name: (call.agents as { name: string }[] | null)?.[0]?.name || 'Unknown',
        total_calls: 0,
        total_minutes: 0,
        total_cost_cents: 0
      };
    }
    agentStats[agentId].total_calls++;
    agentStats[agentId].total_minutes += (call.billed_minutes as number) || 0;
    agentStats[agentId].total_cost_cents += (call.cost_total_cents as number) || 0;
  }

  return Object.values(agentStats)
    .sort((a, b) => b.total_minutes - a.total_minutes)
    .slice(0, limit);
}
