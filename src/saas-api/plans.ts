/**
 * Plans Module
 * 
 * Handles plan limits resolution and enforcement.
 * 
 * KEY CONCEPT: Effective Limits
 * 
 * Subscriptions can have custom overrides (for enterprise deals).
 * This module resolves the "effective" limits by:
 * 1. Starting with the base plan limits
 * 2. Applying any custom overrides from the subscription
 * 
 * The result is a single source of truth for what the org can do.
 */

import { supabaseAdmin } from './db';
import {
  OrgContext,
  Plan,
  Subscription,
  EffectivePlanLimits,
  PlanFeatures,
  AllowedProviders,
  PlanTier,
  SaaSError
} from './types';
import { createLogger } from '../utils/logger';

const logger = createLogger('saas-plans');

/**
 * Default features for orgs without a plan (should never happen).
 */
const DEFAULT_FEATURES: PlanFeatures = {
  analytics: false,
  webhooks: false,
  api_access: false,
  voice_cloning: false,
  priority_support: false,
  custom_integrations: false,
  sla: false
};

/**
 * Default allowed providers for free tier.
 */
const DEFAULT_PROVIDERS: AllowedProviders = {
  stt: ['sarvam'],
  tts: ['sarvam'],
  llm: ['gemini-flash']
};

/**
 * Get effective plan limits for an organization.
 * 
 * This is THE source of truth for what an org can do.
 * All enforcement should use these limits, not raw plan data.
 * 
 * @param orgContext - Organization context with plan and subscription
 * @returns Effective limits after applying custom overrides
 */
export function getEffectivePlanLimits(orgContext: OrgContext): EffectivePlanLimits {
  const { plan, subscription } = orgContext;

  // If no plan, use minimal defaults (shouldn't happen in practice)
  if (!plan) {
    logger.warn('No plan found for org', { orgId: orgContext.organization.id });
    return {
      included_minutes: 0,
      max_concurrent_calls: 1,
      included_agents: 1,
      overage_rate_cents: 20,
      history_retention_days: 7,
      features: DEFAULT_FEATURES,
      allowed_providers: DEFAULT_PROVIDERS,
      period_start: new Date(),
      period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
      plan_name: 'Free',
      plan_tier: 'free',
      is_custom: false
    };
  }

  // Start with plan defaults
  let includedMinutes = plan.included_minutes;
  let overageRateCents = plan.overage_rate_cents;
  let periodStart = new Date();
  let periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  let isCustom = false;

  // Apply subscription overrides if they exist
  if (subscription) {
    periodStart = new Date(subscription.current_period_start);
    periodEnd = new Date(subscription.current_period_end);

    // Custom overrides for enterprise deals
    if (subscription.custom_minutes_limit !== null) {
      includedMinutes = subscription.custom_minutes_limit;
      isCustom = true;
    }
    if (subscription.custom_overage_rate_cents !== null) {
      overageRateCents = subscription.custom_overage_rate_cents;
      isCustom = true;
    }
  }

  return {
    included_minutes: includedMinutes,
    max_concurrent_calls: plan.max_concurrent_calls,
    included_agents: plan.included_agents,
    overage_rate_cents: overageRateCents,
    history_retention_days: plan.history_retention_days,
    features: plan.features as PlanFeatures,
    allowed_providers: plan.allowed_providers as AllowedProviders,
    period_start: periodStart,
    period_end: periodEnd,
    plan_name: plan.name,
    plan_tier: plan.tier,
    is_custom: isCustom
  };
}

/**
 * Check if a provider is allowed for the organization's plan.
 * 
 * @param limits - Effective plan limits
 * @param providerType - Type of provider (stt, tts, llm)
 * @param providerSlug - Slug of the specific provider
 * @returns true if allowed, false otherwise
 */
export function isProviderAllowed(
  limits: EffectivePlanLimits,
  providerType: 'stt' | 'tts' | 'llm',
  providerSlug: string
): boolean {
  const allowedList = limits.allowed_providers[providerType];
  
  // If no restrictions, allow all
  if (!allowedList || allowedList.length === 0) {
    return true;
  }

  return allowedList.includes(providerSlug);
}

/**
 * Validate provider selection against plan.
 * Throws if provider is not allowed.
 */
export function validateProviderSelection(
  limits: EffectivePlanLimits,
  providerType: 'stt' | 'tts' | 'llm',
  providerSlug: string
): void {
  if (!isProviderAllowed(limits, providerType, providerSlug)) {
    throw SaaSError.providerNotAllowed(providerSlug, providerType);
  }
}

/**
 * Check if a feature is enabled for the plan.
 */
export function isFeatureEnabled(
  limits: EffectivePlanLimits,
  feature: keyof PlanFeatures
): boolean {
  return limits.features[feature] === true;
}

/**
 * Validate feature access.
 * Throws if feature is not enabled.
 */
export function requireFeature(
  limits: EffectivePlanLimits,
  feature: keyof PlanFeatures,
  featureName: string
): void {
  if (!isFeatureEnabled(limits, feature)) {
    throw new SaaSError(
      'PLAN_LIMIT_EXCEEDED',
      `${featureName} is not available on your plan`,
      402,
      { feature, plan: limits.plan_name }
    );
  }
}

/**
 * Get all available plans (for pricing page).
 */
export async function getAvailablePlans(): Promise<Plan[]> {
  const { data, error } = await supabaseAdmin
    .from('plans')
    .select('*')
    .eq('is_active', true)
    .eq('is_public', true)
    .order('sort_order', { ascending: true });

  if (error) {
    logger.error('Failed to fetch plans', { error: error.message });
    throw new SaaSError('INTERNAL_ERROR', 'Failed to fetch plans', 500);
  }

  return (data || []) as Plan[];
}

/**
 * Get a specific plan by slug.
 */
export async function getPlanBySlug(slug: string): Promise<Plan | null> {
  const { data, error } = await supabaseAdmin
    .from('plans')
    .select('*')
    .eq('slug', slug)
    .single();

  if (error) {
    return null;
  }

  return data as Plan;
}

/**
 * Get a specific plan by ID.
 */
export async function getPlanById(id: string): Promise<Plan | null> {
  const { data, error } = await supabaseAdmin
    .from('plans')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    return null;
  }

  return data as Plan;
}

/**
 * Check if org can add more agents.
 * Returns { allowed: true } or { allowed: false, reason: string }
 */
export async function canAddAgent(
  orgContext: OrgContext
): Promise<{ allowed: boolean; reason?: string; current?: number; max?: number }> {
  const limits = getEffectivePlanLimits(orgContext);

  // -1 means unlimited
  if (limits.included_agents === -1) {
    return { allowed: true };
  }

  // Count current agents
  const { count, error } = await supabaseAdmin
    .from('agents')
    .select('*', { count: 'exact', head: true })
    .eq('organization_id', orgContext.organization.id)
    .neq('status', 'archived');

  if (error) {
    logger.error('Failed to count agents', { error: error.message });
    throw new SaaSError('INTERNAL_ERROR', 'Failed to check agent limit', 500);
  }

  const currentCount = count || 0;

  if (currentCount >= limits.included_agents) {
    return {
      allowed: false,
      reason: `Agent limit reached (${currentCount}/${limits.included_agents})`,
      current: currentCount,
      max: limits.included_agents
    };
  }

  return {
    allowed: true,
    current: currentCount,
    max: limits.included_agents
  };
}

/**
 * Calculate price for a plan with optional billing interval.
 * Returns price in cents.
 */
export function calculatePlanPrice(
  plan: Plan,
  interval: 'monthly' | 'yearly' = 'monthly'
): number {
  if (interval === 'yearly') {
    return plan.price_yearly_cents;
  }
  return plan.price_monthly_cents;
}

/**
 * Calculate overage cost for additional minutes.
 */
export function calculateOverageCost(
  limits: EffectivePlanLimits,
  overageMinutes: number
): number {
  if (overageMinutes <= 0) return 0;
  return overageMinutes * limits.overage_rate_cents;
}

/**
 * Get plan comparison data for pricing page.
 */
export async function getPlanComparison(): Promise<{
  plans: Plan[];
  features: Array<{
    name: string;
    key: keyof PlanFeatures;
    description: string;
  }>;
}> {
  const plans = await getAvailablePlans();

  const features = [
    { name: 'Analytics Dashboard', key: 'analytics' as const, description: 'Detailed call analytics and insights' },
    { name: 'Webhooks', key: 'webhooks' as const, description: 'Real-time event notifications' },
    { name: 'API Access', key: 'api_access' as const, description: 'Programmatic API access' },
    { name: 'Voice Cloning', key: 'voice_cloning' as const, description: 'Custom AI voice models' },
    { name: 'Priority Support', key: 'priority_support' as const, description: 'Dedicated support channel' },
    { name: 'Custom Integrations', key: 'custom_integrations' as const, description: 'Custom CRM/tool integrations' },
    { name: 'SLA', key: 'sla' as const, description: 'Guaranteed uptime and response times' }
  ];

  return { plans, features };
}
