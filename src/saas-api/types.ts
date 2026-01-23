/**
 * SaaS API Types
 * 
 * Core type definitions for the multi-tenant SaaS API layer.
 * These types mirror the Supabase schema but are used in the API layer
 * to ensure type safety without direct DB coupling.
 */

// ===========================================
// ENUMS (must match Supabase schema exactly)
// ===========================================

export type SubscriptionStatus = 
  | 'trialing' 
  | 'active' 
  | 'past_due' 
  | 'canceled' 
  | 'paused' 
  | 'incomplete';

export type PlanTier = 
  | 'free' 
  | 'starter' 
  | 'growth' 
  | 'scale' 
  | 'enterprise';

export type BillingInterval = 'monthly' | 'yearly';

export type CallDirection = 'inbound' | 'outbound' | 'web';

export type CallStatus = 
  | 'queued' 
  | 'ringing' 
  | 'in_progress' 
  | 'completed' 
  | 'failed' 
  | 'busy' 
  | 'no_answer' 
  | 'canceled';

export type ProviderType = 'stt' | 'tts' | 'llm' | 'telephony';

export type UsageType = 
  | 'call_minutes' 
  | 'stt_minutes' 
  | 'tts_minutes' 
  | 'llm_tokens' 
  | 'storage_gb';

export type OrgRole = 'owner' | 'admin' | 'member' | 'viewer';

export type AgentStatus = 'draft' | 'active' | 'paused' | 'archived';

// ===========================================
// CORE ENTITIES
// ===========================================

export interface Organization {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  billing_email: string | null;
  billing_address: Record<string, unknown>;
  tax_id: string | null;
  currency: string;
  stripe_customer_id: string | null;
  razorpay_customer_id: string | null;
  cashfree_customer_id: string | null;
  settings: Record<string, unknown>;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface User {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  phone: string | null;
  timezone: string;
  locale: string;
  email_verified: boolean;
  last_sign_in_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface OrganizationMember {
  id: string;
  organization_id: string;
  user_id: string;
  role: OrgRole;
  permissions: Record<string, unknown>;
  invited_by: string | null;
  invited_at: string;
  accepted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PlanFeatures {
  analytics: boolean;
  webhooks: boolean;
  api_access: boolean;
  voice_cloning: boolean;
  priority_support: boolean;
  custom_integrations: boolean;
  sla: boolean;
}

export interface AllowedProviders {
  stt: string[];
  tts: string[];
  llm: string[];
}

export interface Plan {
  id: string;
  name: string;
  slug: string;
  tier: PlanTier;
  price_monthly_cents: number;
  price_yearly_cents: number;
  included_minutes: number;
  included_agents: number; // -1 means unlimited
  max_concurrent_calls: number;
  overage_rate_cents: number;
  features: PlanFeatures;
  allowed_providers: AllowedProviders;
  history_retention_days: number;
  description: string | null;
  is_active: boolean;
  is_public: boolean;
  sort_order: number;
  stripe_price_id_monthly: string | null;
  stripe_price_id_yearly: string | null;
  cashfree_plan_id_monthly: string | null;
  cashfree_plan_id_yearly: string | null;
  created_at: string;
  updated_at: string;
}

export interface Subscription {
  id: string;
  organization_id: string;
  plan_id: string;
  status: SubscriptionStatus;
  billing_interval: BillingInterval;
  current_period_start: string;
  current_period_end: string;
  trial_start: string | null;
  trial_end: string | null;
  cancel_at_period_end: boolean;
  canceled_at: string | null;
  cancellation_reason: string | null;
  stripe_subscription_id: string | null;
  razorpay_subscription_id: string | null;
  cashfree_subscription_id: string | null;
  custom_minutes_limit: number | null;
  custom_price_cents: number | null;
  custom_overage_rate_cents: number | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface Agent {
  id: string;
  organization_id: string;
  name: string;
  slug: string;
  description: string | null;
  status: AgentStatus;
  system_prompt: string | null;
  stt_provider: string;
  stt_config: Record<string, unknown>;
  tts_provider: string;
  tts_config: Record<string, unknown>;
  llm_provider: string;
  llm_config: Record<string, unknown>;
  voice_id: string | null;
  language: string;
  first_message: string | null;
  end_call_phrases: string[];
  interruption_sensitivity: number;
  silence_timeout_ms: number;
  max_call_duration_seconds: number;
  tools_config: Record<string, unknown>[];
  version: number;
  published_version: number | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

export interface Call {
  id: string;
  organization_id: string;
  agent_id: string | null;
  external_call_id: string | null;
  session_id: string | null;
  direction: CallDirection;
  from_number: string | null;
  to_number: string | null;
  started_at: string;
  answered_at: string | null;
  ended_at: string | null;
  duration_seconds: number;
  billed_minutes: number;
  status: CallStatus;
  end_reason: string | null;
  error_message: string | null;
  stt_provider: string | null;
  tts_provider: string | null;
  llm_provider: string | null;
  cost_telephony_cents: number;
  cost_stt_cents: number;
  cost_tts_cents: number;
  cost_llm_cents: number;
  cost_total_cents: number;
  llm_prompt_tokens: number;
  llm_completion_tokens: number;
  tts_characters: number;
  latency_first_response_ms: number | null;
  latency_avg_response_ms: number | null;
  interruptions_count: number;
  recording_url: string | null;
  recording_duration_seconds: number | null;
  metadata: Record<string, unknown>;
  tags: string[];
  created_at: string;
  updated_at: string;
}

export interface UsageRecord {
  id: string;
  organization_id: string;
  subscription_id: string | null;
  period_start: string;
  period_end: string;
  usage_type: UsageType;
  quantity: number;
  unit: string;
  unit_cost_cents: number | null;
  total_cost_cents: number;
  call_id: string | null;
  provider_slug: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface UsageDailySummary {
  id: string;
  organization_id: string;
  date: string;
  total_calls: number;
  total_minutes: number;
  total_cost_cents: number;
  inbound_calls: number;
  outbound_calls: number;
  web_calls: number;
  cost_by_provider: Record<string, number>;
  avg_latency_ms: number | null;
  avg_duration_seconds: number | null;
  created_at: string;
  updated_at: string;
}

// ===========================================
// API CONTEXT TYPES
// ===========================================

/**
 * Authenticated user context attached to every request.
 * Contains the verified user and their organization memberships.
 */
export interface AuthContext {
  user: User;
  memberships: OrganizationMember[];
}

/**
 * Organization context for requests that operate on a specific org.
 * Includes the resolved org, user's role, and subscription.
 */
export interface OrgContext extends AuthContext {
  organization: Organization;
  membership: OrganizationMember;
  subscription: Subscription | null;
  plan: Plan | null;
}

/**
 * Effective plan limits after applying custom overrides.
 * This is the source of truth for enforcement.
 */
export interface EffectivePlanLimits {
  // From plan or custom override
  included_minutes: number;
  max_concurrent_calls: number;
  included_agents: number;
  overage_rate_cents: number;
  history_retention_days: number;
  
  // Features
  features: PlanFeatures;
  allowed_providers: AllowedProviders;
  
  // Billing period
  period_start: Date;
  period_end: Date;
  
  // Metadata
  plan_name: string;
  plan_tier: PlanTier;
  is_custom: boolean;
}

/**
 * Current usage snapshot for an organization.
 */
export interface UsageSnapshot {
  used_minutes: number;
  remaining_minutes: number;
  overage_minutes: number;
  total_calls: number;
  active_calls: number;
  total_cost_cents: number;
  period_start: Date;
  period_end: Date;
}

/**
 * Result of a concurrency check.
 */
export interface ConcurrencyCheckResult {
  allowed: boolean;
  current_active: number;
  max_allowed: number;
  reason?: string;
}

// ===========================================
// API ERROR TYPES
// ===========================================

export type SaaSErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'PLAN_LIMIT_EXCEEDED'
  | 'CONCURRENCY_LIMIT'
  | 'USAGE_LIMIT_EXCEEDED'
  | 'SUBSCRIPTION_INACTIVE'
  | 'PROVIDER_NOT_ALLOWED'
  | 'AGENT_LIMIT_EXCEEDED'
  | 'EXTERNAL_API_ERROR'
  | 'INTERNAL_ERROR'
  | 'PLIVO_APP_EXISTS'
  | 'PLIVO_APP_CREATE_FAILED';

export class SaaSError extends Error {
  constructor(
    public code: SaaSErrorCode,
    message: string,
    public statusCode: number = 400,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'SaaSError';
  }

  static unauthorized(message = 'Authentication required'): SaaSError {
    return new SaaSError('UNAUTHORIZED', message, 401);
  }

  static forbidden(message = 'Access denied'): SaaSError {
    return new SaaSError('FORBIDDEN', message, 403);
  }

  static notFound(resource: string): SaaSError {
    return new SaaSError('NOT_FOUND', `${resource} not found`, 404);
  }

  static validation(message: string, details?: Record<string, unknown>): SaaSError {
    return new SaaSError('VALIDATION_ERROR', message, 400, details);
  }

  static planLimit(limit: string, current: number, max: number): SaaSError {
    return new SaaSError(
      'PLAN_LIMIT_EXCEEDED',
      `${limit} limit exceeded: ${current}/${max}`,
      402,
      { limit, current, max }
    );
  }

  static concurrencyLimit(current: number, max: number): SaaSError {
    return new SaaSError(
      'CONCURRENCY_LIMIT',
      `Concurrent call limit exceeded: ${current}/${max}`,
      429,
      { current, max }
    );
  }

  static subscriptionInactive(status: SubscriptionStatus): SaaSError {
    return new SaaSError(
      'SUBSCRIPTION_INACTIVE',
      `Subscription is ${status}`,
      402,
      { status }
    );
  }

  static providerNotAllowed(provider: string, type: ProviderType): SaaSError {
    return new SaaSError(
      'PROVIDER_NOT_ALLOWED',
      `Provider ${provider} not allowed for ${type} on your plan`,
      403,
      { provider, type }
    );
  }

  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        details: this.details
      }
    };
  }
}

// ===========================================
// REQUEST/RESPONSE TYPES
// ===========================================

export interface CreateAgentRequest {
  name: string;
  slug?: string;
  description?: string;
  system_prompt?: string;
  stt_provider?: string;
  stt_config?: Record<string, unknown>;
  tts_provider?: string;
  tts_config?: Record<string, unknown>;
  llm_provider?: string;
  llm_config?: Record<string, unknown>;
  voice_id?: string;
  language?: string;
  first_message?: string;
  end_call_phrases?: string[];
  tools_config?: Record<string, unknown>[];
}

export interface UpdateAgentRequest extends Partial<CreateAgentRequest> {
  status?: AgentStatus;
}

export interface StartCallRequest {
  agent_id: string;
  direction: CallDirection;
  from_number?: string;
  to_number?: string;
  metadata?: Record<string, unknown>;
}

export interface EndCallRequest {
  duration_seconds: number;
  end_reason?: string;
  llm_prompt_tokens?: number;
  llm_completion_tokens?: number;
  tts_characters?: number;
  latency_first_response_ms?: number;
  latency_avg_response_ms?: number;
  interruptions_count?: number;
  recording_url?: string;
}

export interface UsageQueryParams {
  start_date?: string;
  end_date?: string;
  group_by?: 'day' | 'week' | 'month';
}

export interface PaginationParams {
  page?: number;
  limit?: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    total_pages: number;
  };
}
