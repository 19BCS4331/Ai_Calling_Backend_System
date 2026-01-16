-- ============================================
-- VOCAAI SAAS DATABASE SCHEMA
-- Version: 1.0.0
-- Supabase/PostgreSQL
-- ============================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================
-- ENUMS
-- ============================================

CREATE TYPE subscription_status AS ENUM (
  'trialing', 'active', 'past_due', 'canceled', 'paused', 'incomplete'
);

CREATE TYPE plan_tier AS ENUM (
  'free', 'starter', 'growth', 'scale', 'enterprise'
);

CREATE TYPE billing_interval AS ENUM (
  'monthly', 'yearly'
);

CREATE TYPE call_direction AS ENUM (
  'inbound', 'outbound', 'web'
);

CREATE TYPE call_status AS ENUM (
  'queued', 'ringing', 'in_progress', 'completed', 'failed', 'busy', 'no_answer', 'canceled'
);

CREATE TYPE provider_type AS ENUM (
  'stt', 'tts', 'llm', 'telephony'
);

CREATE TYPE usage_type AS ENUM (
  'call_minutes', 'stt_minutes', 'tts_minutes', 'llm_tokens', 'storage_gb'
);

CREATE TYPE org_role AS ENUM (
  'owner', 'admin', 'member', 'viewer'
);

CREATE TYPE agent_status AS ENUM (
  'draft', 'active', 'paused', 'archived'
);

-- ============================================
-- 1. ORGANIZATIONS (Multi-tenancy root)
-- ============================================

CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(100) UNIQUE NOT NULL,
  logo_url TEXT,
  
  -- Billing info
  billing_email VARCHAR(255),
  billing_address JSONB DEFAULT '{}',
  tax_id VARCHAR(100),
  currency VARCHAR(3) DEFAULT 'USD',
  
  -- Stripe/Razorpay
  stripe_customer_id VARCHAR(255) UNIQUE,
  razorpay_customer_id VARCHAR(255) UNIQUE,
  
  -- Settings
  settings JSONB DEFAULT '{}',
  metadata JSONB DEFAULT '{}',
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_organizations_slug ON organizations(slug);
CREATE INDEX idx_organizations_stripe ON organizations(stripe_customer_id);

-- ============================================
-- 2. USERS & ORG MEMBERSHIP
-- ============================================

CREATE TABLE users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email VARCHAR(255) UNIQUE NOT NULL,
  full_name VARCHAR(255),
  avatar_url TEXT,
  phone VARCHAR(50),
  
  -- Preferences
  timezone VARCHAR(100) DEFAULT 'UTC',
  locale VARCHAR(10) DEFAULT 'en',
  
  -- Status
  email_verified BOOLEAN DEFAULT FALSE,
  last_sign_in_at TIMESTAMPTZ,
  
  -- Metadata
  metadata JSONB DEFAULT '{}',
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE organization_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role org_role NOT NULL DEFAULT 'member',
  
  -- Permissions override
  permissions JSONB DEFAULT '{}',
  
  invited_by UUID REFERENCES users(id),
  invited_at TIMESTAMPTZ DEFAULT NOW(),
  accepted_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(organization_id, user_id)
);

CREATE INDEX idx_org_members_org ON organization_members(organization_id);
CREATE INDEX idx_org_members_user ON organization_members(user_id);

-- ============================================
-- 3. SUBSCRIPTION PLANS (Configurable)
-- ============================================

CREATE TABLE plans (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(100) NOT NULL,
  slug VARCHAR(50) UNIQUE NOT NULL,
  tier plan_tier NOT NULL,
  
  -- Pricing (in cents to avoid float issues)
  price_monthly_cents INTEGER NOT NULL DEFAULT 0,
  price_yearly_cents INTEGER NOT NULL DEFAULT 0,
  
  -- Included resources
  included_minutes INTEGER NOT NULL DEFAULT 0,
  included_agents INTEGER NOT NULL DEFAULT 1,
  max_concurrent_calls INTEGER NOT NULL DEFAULT 1,
  
  -- Overage pricing (cents per unit)
  overage_rate_cents INTEGER NOT NULL DEFAULT 20, -- per minute
  
  -- Features (flexible JSON for future additions)
  features JSONB DEFAULT '{
    "analytics": false,
    "webhooks": false,
    "api_access": false,
    "voice_cloning": false,
    "priority_support": false,
    "custom_integrations": false,
    "sla": false
  }',
  
  -- Provider restrictions
  allowed_providers JSONB DEFAULT '{
    "stt": ["sarvam", "deepgram"],
    "tts": ["sarvam", "cartesia"],
    "llm": ["gemini", "gpt-4o-mini"]
  }',
  
  -- Limits
  history_retention_days INTEGER DEFAULT 7,
  
  -- Display
  description TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  is_public BOOLEAN DEFAULT TRUE, -- Show on pricing page
  sort_order INTEGER DEFAULT 0,
  
  -- Stripe
  stripe_price_id_monthly VARCHAR(255),
  stripe_price_id_yearly VARCHAR(255),
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default plans
INSERT INTO plans (name, slug, tier, price_monthly_cents, price_yearly_cents, included_minutes, included_agents, max_concurrent_calls, overage_rate_cents, history_retention_days, features, sort_order) VALUES
('Free', 'free', 'free', 0, 0, 0, 1, 1, 20, 7, '{"analytics": false, "webhooks": false, "api_access": false}', 0),
('Starter', 'starter', 'starter', 7900, 79000, 500, 3, 2, 18, 14, '{"analytics": false, "webhooks": false, "api_access": false}', 1),
('Growth', 'growth', 'growth', 34900, 349000, 2500, 10, 5, 16, 30, '{"analytics": true, "webhooks": true, "api_access": true}', 2),
('Scale', 'scale', 'scale', 129900, 1299000, 10000, -1, 20, 14, 90, '{"analytics": true, "webhooks": true, "api_access": true, "voice_cloning": true, "priority_support": true}', 3),
('Enterprise', 'enterprise', 'enterprise', 0, 0, 0, -1, 100, 10, 365, '{"analytics": true, "webhooks": true, "api_access": true, "voice_cloning": true, "priority_support": true, "custom_integrations": true, "sla": true}', 4);

-- ============================================
-- 4. SUBSCRIPTIONS
-- ============================================

CREATE TABLE subscriptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES plans(id),
  
  status subscription_status NOT NULL DEFAULT 'incomplete',
  billing_interval billing_interval NOT NULL DEFAULT 'monthly',
  
  -- Billing cycle
  current_period_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  current_period_end TIMESTAMPTZ NOT NULL,
  
  -- Trial
  trial_start TIMESTAMPTZ,
  trial_end TIMESTAMPTZ,
  
  -- Cancellation
  cancel_at_period_end BOOLEAN DEFAULT FALSE,
  canceled_at TIMESTAMPTZ,
  cancellation_reason TEXT,
  
  -- Payment
  stripe_subscription_id VARCHAR(255) UNIQUE,
  razorpay_subscription_id VARCHAR(255) UNIQUE,
  
  -- Custom overrides (for enterprise deals)
  custom_minutes_limit INTEGER, -- NULL = use plan default
  custom_price_cents INTEGER,
  custom_overage_rate_cents INTEGER,
  
  -- Metadata
  metadata JSONB DEFAULT '{}',
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_subscriptions_org ON subscriptions(organization_id);
CREATE INDEX idx_subscriptions_status ON subscriptions(status);
CREATE INDEX idx_subscriptions_stripe ON subscriptions(stripe_subscription_id);
CREATE UNIQUE INDEX idx_subscriptions_active_org ON subscriptions(organization_id) WHERE status IN ('active', 'trialing');

-- ============================================
-- 5. PROVIDER CONFIGURATIONS
-- ============================================

CREATE TABLE providers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  type provider_type NOT NULL,
  name VARCHAR(100) NOT NULL,
  slug VARCHAR(50) NOT NULL,
  
  -- Cost tracking (cents per unit for margin calculations)
  cost_per_minute_cents DECIMAL(10, 4), -- For STT/TTS/telephony
  cost_per_1k_tokens_cents DECIMAL(10, 4), -- For LLM
  cost_per_1k_chars_cents DECIMAL(10, 4), -- For TTS character-based
  
  -- Limits
  max_concurrent INTEGER,
  rate_limit_rpm INTEGER, -- Requests per minute
  
  -- Configuration schema
  config_schema JSONB DEFAULT '{}',
  
  -- Status
  is_active BOOLEAN DEFAULT TRUE,
  is_premium BOOLEAN DEFAULT FALSE, -- Requires add-on
  premium_surcharge_cents INTEGER DEFAULT 0, -- Per minute surcharge
  
  -- Display
  display_name VARCHAR(100),
  description TEXT,
  logo_url TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(type, slug)
);

-- Insert default providers
INSERT INTO providers (type, name, slug, cost_per_minute_cents, max_concurrent, is_premium, display_name) VALUES
-- STT
('stt', 'Sarvam', 'sarvam', 0.60, 10, false, 'Sarvam AI'),
('stt', 'Deepgram', 'deepgram', 1.25, 100, false, 'Deepgram'),
('stt', 'AssemblyAI', 'assemblyai', 2.00, 50, true, 'AssemblyAI'),
-- TTS
('tts', 'Sarvam', 'sarvam', 0.50, 10, false, 'Sarvam AI'),
('tts', 'Cartesia', 'cartesia', 3.80, 2, false, 'Cartesia'),
('tts', 'ElevenLabs', 'elevenlabs', 10.00, 5, true, 'ElevenLabs'),
-- LLM
('llm', 'Gemini Flash', 'gemini-flash', 0.20, NULL, false, 'Google Gemini 2.5 Flash'),
('llm', 'GPT-4o-mini', 'gpt-4o-mini', 1.00, NULL, false, 'OpenAI GPT-4o-mini'),
('llm', 'GPT-4o', 'gpt-4o', 5.00, NULL, true, 'OpenAI GPT-4o'),
('llm', 'Claude Sonnet', 'claude-sonnet', 3.00, NULL, true, 'Anthropic Claude 3.5 Sonnet'),
-- Telephony
('telephony', 'Plivo', 'plivo', 0.90, NULL, false, 'Plivo');

-- Organization-level provider credentials
CREATE TABLE organization_provider_credentials (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider_id UUID NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  
  -- Encrypted credentials
  credentials_encrypted TEXT NOT NULL, -- Use pgcrypto or app-level encryption
  
  -- Status
  is_active BOOLEAN DEFAULT TRUE,
  last_validated_at TIMESTAMPTZ,
  validation_error TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(organization_id, provider_id)
);

-- ============================================
-- 6. AGENTS
-- ============================================

CREATE TABLE agents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(100) NOT NULL,
  description TEXT,
  
  status agent_status DEFAULT 'draft',
  
  -- System prompt
  system_prompt TEXT,
  
  -- Provider configuration
  stt_provider VARCHAR(50) DEFAULT 'sarvam',
  stt_config JSONB DEFAULT '{}',
  
  tts_provider VARCHAR(50) DEFAULT 'cartesia',
  tts_config JSONB DEFAULT '{"voice_id": null, "language": "en-IN"}',
  
  llm_provider VARCHAR(50) DEFAULT 'gemini-flash',
  llm_config JSONB DEFAULT '{"model": "gemini-2.5-flash", "temperature": 0.7}',
  
  -- Voice settings
  voice_id VARCHAR(255),
  language VARCHAR(10) DEFAULT 'en-IN',
  
  -- Behavior
  first_message TEXT,
  end_call_phrases TEXT[] DEFAULT ARRAY['goodbye', 'bye', 'thank you bye'],
  
  -- Advanced settings
  interruption_sensitivity DECIMAL(3, 2) DEFAULT 0.5,
  silence_timeout_ms INTEGER DEFAULT 5000,
  max_call_duration_seconds INTEGER DEFAULT 600,
  
  -- Tools/Functions
  tools_config JSONB DEFAULT '[]',
  
  -- Versioning
  version INTEGER DEFAULT 1,
  published_version INTEGER,
  
  -- Metadata
  metadata JSONB DEFAULT '{}',
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES users(id),
  
  UNIQUE(organization_id, slug)
);

CREATE INDEX idx_agents_org ON agents(organization_id);
CREATE INDEX idx_agents_status ON agents(status);

-- Agent versions for rollback capability
CREATE TABLE agent_versions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  
  -- Snapshot of agent config at this version
  config_snapshot JSONB NOT NULL,
  
  -- Change tracking
  change_summary TEXT,
  published_at TIMESTAMPTZ,
  published_by UUID REFERENCES users(id),
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(agent_id, version)
);

-- ============================================
-- 7. PHONE NUMBERS
-- ============================================

CREATE TABLE phone_numbers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  
  phone_number VARCHAR(20) NOT NULL UNIQUE,
  country_code VARCHAR(5) NOT NULL,
  
  -- Provider info
  telephony_provider VARCHAR(50) DEFAULT 'plivo',
  provider_number_id VARCHAR(255),
  
  -- Assignment
  agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
  
  -- Capabilities
  capabilities JSONB DEFAULT '{"voice": true, "sms": false}',
  
  -- Billing
  monthly_cost_cents INTEGER DEFAULT 30000, -- $3/month typical
  
  -- Status
  is_active BOOLEAN DEFAULT TRUE,
  provisioned_at TIMESTAMPTZ DEFAULT NOW(),
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_phone_numbers_org ON phone_numbers(organization_id);
CREATE INDEX idx_phone_numbers_agent ON phone_numbers(agent_id);

-- ============================================
-- 8. CALLS
-- ============================================

CREATE TABLE calls (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
  
  -- Call identifiers
  external_call_id VARCHAR(255), -- Plivo/Twilio call SID
  session_id VARCHAR(255),
  
  -- Direction & parties
  direction call_direction NOT NULL,
  from_number VARCHAR(50),
  to_number VARCHAR(50),
  
  -- Timing
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  answered_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  
  -- Duration (seconds)
  duration_seconds INTEGER DEFAULT 0,
  billed_minutes INTEGER DEFAULT 0, -- Rounded up for billing
  
  -- Status
  status call_status DEFAULT 'queued',
  end_reason VARCHAR(100),
  error_message TEXT,
  
  -- Providers used (for cost tracking)
  stt_provider VARCHAR(50),
  tts_provider VARCHAR(50),
  llm_provider VARCHAR(50),
  
  -- Cost breakdown (cents)
  cost_telephony_cents INTEGER DEFAULT 0,
  cost_stt_cents INTEGER DEFAULT 0,
  cost_tts_cents INTEGER DEFAULT 0,
  cost_llm_cents INTEGER DEFAULT 0,
  cost_total_cents INTEGER DEFAULT 0,
  
  -- Usage metrics
  llm_prompt_tokens INTEGER DEFAULT 0,
  llm_completion_tokens INTEGER DEFAULT 0,
  tts_characters INTEGER DEFAULT 0,
  
  -- Quality metrics
  latency_first_response_ms INTEGER,
  latency_avg_response_ms INTEGER,
  interruptions_count INTEGER DEFAULT 0,
  
  -- Recording
  recording_url TEXT,
  recording_duration_seconds INTEGER,
  
  -- Metadata
  metadata JSONB DEFAULT '{}',
  tags TEXT[] DEFAULT '{}',
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_calls_org ON calls(organization_id);
CREATE INDEX idx_calls_agent ON calls(agent_id);
CREATE INDEX idx_calls_started ON calls(started_at DESC);
CREATE INDEX idx_calls_status ON calls(status);
CREATE INDEX idx_calls_direction ON calls(direction);
CREATE INDEX idx_calls_external ON calls(external_call_id);

-- ============================================
-- 9. TRANSCRIPTS
-- ============================================

CREATE TABLE transcripts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  call_id UUID NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  
  -- Segment info
  sequence INTEGER NOT NULL,
  role VARCHAR(20) NOT NULL, -- 'user', 'assistant', 'system', 'tool'
  
  -- Content
  content TEXT NOT NULL,
  
  -- Timing
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  duration_ms INTEGER,
  
  -- STT metadata (for user messages)
  confidence DECIMAL(4, 3),
  language_detected VARCHAR(10),
  is_final BOOLEAN DEFAULT TRUE,
  
  -- LLM metadata (for assistant messages)
  tokens_used INTEGER,
  tool_calls JSONB,
  
  -- Audio reference
  audio_url TEXT,
  audio_offset_ms INTEGER,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_transcripts_call ON transcripts(call_id);
CREATE INDEX idx_transcripts_sequence ON transcripts(call_id, sequence);

-- Full transcript as materialized view for quick access
CREATE MATERIALIZED VIEW call_full_transcripts AS
SELECT 
  call_id,
  organization_id,
  jsonb_agg(
    jsonb_build_object(
      'role', t.role,
      'content', t.content,
      'timestamp', t.started_at
    ) ORDER BY t.sequence
  ) as messages,
  string_agg(
    CASE WHEN t.role = 'user' THEN t.content ELSE '' END, ' '
  ) as user_text,
  string_agg(
    CASE WHEN t.role = 'assistant' THEN t.content ELSE '' END, ' '
  ) as assistant_text
FROM transcripts t
JOIN calls c ON c.id = t.call_id
GROUP BY t.call_id, c.organization_id;

CREATE UNIQUE INDEX idx_call_full_transcripts ON call_full_transcripts(call_id);

-- ============================================
-- 10. USAGE TRACKING
-- ============================================

CREATE TABLE usage_records (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  subscription_id UUID REFERENCES subscriptions(id),
  
  -- Period
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  
  -- Usage type
  usage_type usage_type NOT NULL,
  
  -- Quantities
  quantity DECIMAL(15, 4) NOT NULL DEFAULT 0,
  unit VARCHAR(20) NOT NULL, -- 'minutes', 'tokens', 'gb', etc.
  
  -- Cost
  unit_cost_cents DECIMAL(10, 4),
  total_cost_cents INTEGER DEFAULT 0,
  
  -- Source
  call_id UUID REFERENCES calls(id) ON DELETE SET NULL,
  provider_slug VARCHAR(50),
  
  -- Metadata
  metadata JSONB DEFAULT '{}',
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_usage_org ON usage_records(organization_id);
CREATE INDEX idx_usage_period ON usage_records(period_start, period_end);
CREATE INDEX idx_usage_type ON usage_records(usage_type);
CREATE INDEX idx_usage_call ON usage_records(call_id);

-- Aggregated daily usage for fast queries
CREATE TABLE usage_daily_summary (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  
  -- Aggregates
  total_calls INTEGER DEFAULT 0,
  total_minutes DECIMAL(10, 2) DEFAULT 0,
  total_cost_cents INTEGER DEFAULT 0,
  
  -- By direction
  inbound_calls INTEGER DEFAULT 0,
  outbound_calls INTEGER DEFAULT 0,
  web_calls INTEGER DEFAULT 0,
  
  -- By provider
  cost_by_provider JSONB DEFAULT '{}',
  
  -- Quality
  avg_latency_ms INTEGER,
  avg_duration_seconds INTEGER,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(organization_id, date)
);

CREATE INDEX idx_usage_daily_org_date ON usage_daily_summary(organization_id, date DESC);

-- ============================================
-- 11. BILLING & INVOICES
-- ============================================

CREATE TABLE invoices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  subscription_id UUID REFERENCES subscriptions(id),
  
  -- Invoice details
  invoice_number VARCHAR(50) UNIQUE NOT NULL,
  
  -- Period
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  
  -- Amounts (cents)
  subtotal_cents INTEGER NOT NULL DEFAULT 0,
  tax_cents INTEGER DEFAULT 0,
  discount_cents INTEGER DEFAULT 0,
  total_cents INTEGER NOT NULL DEFAULT 0,
  
  -- Currency
  currency VARCHAR(3) DEFAULT 'USD',
  
  -- Line items
  line_items JSONB DEFAULT '[]',
  /*
  Example:
  [
    {"description": "Growth Plan - Monthly", "quantity": 1, "unit_price_cents": 34900, "total_cents": 34900},
    {"description": "Overage: 500 minutes @ $0.16", "quantity": 500, "unit_price_cents": 16, "total_cents": 8000}
  ]
  */
  
  -- Status
  status VARCHAR(20) DEFAULT 'draft', -- draft, open, paid, void, uncollectible
  due_date TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  
  -- Payment
  stripe_invoice_id VARCHAR(255) UNIQUE,
  razorpay_invoice_id VARCHAR(255) UNIQUE,
  payment_intent_id VARCHAR(255),
  
  -- PDF
  invoice_pdf_url TEXT,
  
  -- Metadata
  notes TEXT,
  metadata JSONB DEFAULT '{}',
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_invoices_org ON invoices(organization_id);
CREATE INDEX idx_invoices_status ON invoices(status);
CREATE INDEX idx_invoices_period ON invoices(period_start, period_end);

-- ============================================
-- 12. API KEYS
-- ============================================

CREATE TABLE api_keys (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  
  -- Key info
  name VARCHAR(255) NOT NULL,
  key_prefix VARCHAR(10) NOT NULL, -- First 8 chars for identification
  key_hash VARCHAR(255) NOT NULL, -- Hashed full key
  
  -- Permissions
  scopes TEXT[] DEFAULT ARRAY['calls:read', 'calls:write', 'agents:read'],
  
  -- Limits
  rate_limit_rpm INTEGER DEFAULT 60,
  
  -- Status
  is_active BOOLEAN DEFAULT TRUE,
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  
  -- Audit
  created_by UUID REFERENCES users(id),
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_api_keys_org ON api_keys(organization_id);
CREATE INDEX idx_api_keys_prefix ON api_keys(key_prefix);
CREATE INDEX idx_api_keys_hash ON api_keys(key_hash);

-- ============================================
-- 13. WEBHOOKS
-- ============================================

CREATE TABLE webhooks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  
  -- Endpoint
  url TEXT NOT NULL,
  
  -- Events to subscribe to
  events TEXT[] NOT NULL DEFAULT ARRAY['call.completed'],
  
  -- Security
  secret VARCHAR(255) NOT NULL,
  
  -- Status
  is_active BOOLEAN DEFAULT TRUE,
  
  -- Reliability tracking
  failure_count INTEGER DEFAULT 0,
  last_triggered_at TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  last_failure_at TIMESTAMPTZ,
  last_failure_reason TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_webhooks_org ON webhooks(organization_id);

-- Webhook delivery log
CREATE TABLE webhook_deliveries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  webhook_id UUID NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
  
  -- Event
  event_type VARCHAR(100) NOT NULL,
  payload JSONB NOT NULL,
  
  -- Delivery attempt
  attempt INTEGER DEFAULT 1,
  response_status INTEGER,
  response_body TEXT,
  
  -- Timing
  triggered_at TIMESTAMPTZ DEFAULT NOW(),
  delivered_at TIMESTAMPTZ,
  duration_ms INTEGER,
  
  -- Status
  success BOOLEAN DEFAULT FALSE,
  error_message TEXT
);

CREATE INDEX idx_webhook_deliveries_webhook ON webhook_deliveries(webhook_id);
CREATE INDEX idx_webhook_deliveries_triggered ON webhook_deliveries(triggered_at DESC);

-- ============================================
-- 14. AUDIT LOG
-- ============================================

CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  
  -- Action
  action VARCHAR(100) NOT NULL,
  resource_type VARCHAR(50) NOT NULL,
  resource_id UUID,
  
  -- Details
  old_values JSONB,
  new_values JSONB,
  
  -- Context
  ip_address INET,
  user_agent TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audit_org ON audit_logs(organization_id);
CREATE INDEX idx_audit_user ON audit_logs(user_id);
CREATE INDEX idx_audit_created ON audit_logs(created_at DESC);
CREATE INDEX idx_audit_resource ON audit_logs(resource_type, resource_id);

-- ============================================
-- 15. ROW LEVEL SECURITY (RLS)
-- ============================================

-- Enable RLS on all tables
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_provider_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE phone_numbers ENABLE ROW LEVEL SECURITY;
ALTER TABLE calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE transcripts ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_daily_summary ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Helper function to get user's organizations
CREATE OR REPLACE FUNCTION get_user_org_ids()
RETURNS SETOF UUID AS $$
  SELECT organization_id 
  FROM organization_members 
  WHERE user_id = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Organizations: Users can see orgs they belong to
CREATE POLICY "Users can view their organizations"
  ON organizations FOR SELECT
  USING (id IN (SELECT get_user_org_ids()));

CREATE POLICY "Owners can update their organizations"
  ON organizations FOR UPDATE
  USING (id IN (
    SELECT organization_id FROM organization_members 
    WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
  ));

-- Users: Can see themselves and org members
CREATE POLICY "Users can view themselves"
  ON users FOR SELECT
  USING (id = auth.uid());

CREATE POLICY "Users can update themselves"
  ON users FOR UPDATE
  USING (id = auth.uid());

-- Organization members
CREATE POLICY "Members can view org members"
  ON organization_members FOR SELECT
  USING (organization_id IN (SELECT get_user_org_ids()));

CREATE POLICY "Admins can manage org members"
  ON organization_members FOR ALL
  USING (organization_id IN (
    SELECT organization_id FROM organization_members 
    WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
  ));

-- Subscriptions
CREATE POLICY "Members can view subscriptions"
  ON subscriptions FOR SELECT
  USING (organization_id IN (SELECT get_user_org_ids()));

-- Agents
CREATE POLICY "Members can view agents"
  ON agents FOR SELECT
  USING (organization_id IN (SELECT get_user_org_ids()));

CREATE POLICY "Members can manage agents"
  ON agents FOR ALL
  USING (organization_id IN (
    SELECT organization_id FROM organization_members 
    WHERE user_id = auth.uid() AND role IN ('owner', 'admin', 'member')
  ));

-- Calls
CREATE POLICY "Members can view calls"
  ON calls FOR SELECT
  USING (organization_id IN (SELECT get_user_org_ids()));

-- Transcripts (via call)
CREATE POLICY "Members can view transcripts"
  ON transcripts FOR SELECT
  USING (call_id IN (
    SELECT id FROM calls WHERE organization_id IN (SELECT get_user_org_ids())
  ));

-- Usage records
CREATE POLICY "Members can view usage"
  ON usage_records FOR SELECT
  USING (organization_id IN (SELECT get_user_org_ids()));

-- Invoices
CREATE POLICY "Members can view invoices"
  ON invoices FOR SELECT
  USING (organization_id IN (SELECT get_user_org_ids()));

-- API Keys
CREATE POLICY "Admins can manage API keys"
  ON api_keys FOR ALL
  USING (organization_id IN (
    SELECT organization_id FROM organization_members 
    WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
  ));

-- Webhooks
CREATE POLICY "Admins can manage webhooks"
  ON webhooks FOR ALL
  USING (organization_id IN (
    SELECT organization_id FROM organization_members 
    WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
  ));

-- ============================================
-- 16. FUNCTIONS & TRIGGERS
-- ============================================

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to all tables with updated_at
CREATE TRIGGER update_organizations_updated_at BEFORE UPDATE ON organizations FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_organization_members_updated_at BEFORE UPDATE ON organization_members FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_subscriptions_updated_at BEFORE UPDATE ON subscriptions FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_agents_updated_at BEFORE UPDATE ON agents FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_phone_numbers_updated_at BEFORE UPDATE ON phone_numbers FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_calls_updated_at BEFORE UPDATE ON calls FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_invoices_updated_at BEFORE UPDATE ON invoices FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_api_keys_updated_at BEFORE UPDATE ON api_keys FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_webhooks_updated_at BEFORE UPDATE ON webhooks FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Calculate call cost on completion
CREATE OR REPLACE FUNCTION calculate_call_cost()
RETURNS TRIGGER AS $$
DECLARE
  telephony_rate DECIMAL(10, 4);
  stt_rate DECIMAL(10, 4);
  tts_rate DECIMAL(10, 4);
  llm_rate DECIMAL(10, 4);
BEGIN
  -- Only calculate on status change to 'completed'
  IF NEW.status = 'completed' AND OLD.status != 'completed' THEN
    -- Get provider rates
    SELECT cost_per_minute_cents INTO telephony_rate FROM providers WHERE type = 'telephony' AND slug = 'plivo';
    SELECT cost_per_minute_cents INTO stt_rate FROM providers WHERE type = 'stt' AND slug = COALESCE(NEW.stt_provider, 'sarvam');
    SELECT cost_per_minute_cents INTO tts_rate FROM providers WHERE type = 'tts' AND slug = COALESCE(NEW.tts_provider, 'cartesia');
    SELECT cost_per_1k_tokens_cents INTO llm_rate FROM providers WHERE type = 'llm' AND slug = COALESCE(NEW.llm_provider, 'gemini-flash');
    
    -- Calculate billed minutes (rounded up)
    NEW.billed_minutes := CEIL(COALESCE(NEW.duration_seconds, 0) / 60.0);
    
    -- Calculate costs
    NEW.cost_telephony_cents := NEW.billed_minutes * COALESCE(telephony_rate, 0.90);
    NEW.cost_stt_cents := CEIL((COALESCE(NEW.duration_seconds, 0) / 60.0) * COALESCE(stt_rate, 0.60));
    NEW.cost_tts_cents := CEIL((COALESCE(NEW.duration_seconds, 0) / 60.0) * COALESCE(tts_rate, 3.80));
    NEW.cost_llm_cents := CEIL((COALESCE(NEW.llm_prompt_tokens, 0) + COALESCE(NEW.llm_completion_tokens, 0)) / 1000.0 * COALESCE(llm_rate, 0.20));
    
    NEW.cost_total_cents := NEW.cost_telephony_cents + NEW.cost_stt_cents + NEW.cost_tts_cents + NEW.cost_llm_cents;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER calculate_call_cost_trigger
  BEFORE UPDATE ON calls
  FOR EACH ROW
  EXECUTE FUNCTION calculate_call_cost();

-- Update daily usage summary
CREATE OR REPLACE FUNCTION update_daily_usage()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'completed' AND OLD.status != 'completed' THEN
    INSERT INTO usage_daily_summary (organization_id, date, total_calls, total_minutes, total_cost_cents, inbound_calls, outbound_calls, web_calls)
    VALUES (
      NEW.organization_id,
      DATE(NEW.started_at),
      1,
      NEW.billed_minutes,
      NEW.cost_total_cents,
      CASE WHEN NEW.direction = 'inbound' THEN 1 ELSE 0 END,
      CASE WHEN NEW.direction = 'outbound' THEN 1 ELSE 0 END,
      CASE WHEN NEW.direction = 'web' THEN 1 ELSE 0 END
    )
    ON CONFLICT (organization_id, date) DO UPDATE SET
      total_calls = usage_daily_summary.total_calls + 1,
      total_minutes = usage_daily_summary.total_minutes + EXCLUDED.total_minutes,
      total_cost_cents = usage_daily_summary.total_cost_cents + EXCLUDED.total_cost_cents,
      inbound_calls = usage_daily_summary.inbound_calls + EXCLUDED.inbound_calls,
      outbound_calls = usage_daily_summary.outbound_calls + EXCLUDED.outbound_calls,
      web_calls = usage_daily_summary.web_calls + EXCLUDED.web_calls,
      updated_at = NOW();
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_daily_usage_trigger
  AFTER UPDATE ON calls
  FOR EACH ROW
  EXECUTE FUNCTION update_daily_usage();

-- Generate invoice number
CREATE OR REPLACE FUNCTION generate_invoice_number()
RETURNS TRIGGER AS $$
BEGIN
  NEW.invoice_number := 'INV-' || TO_CHAR(NOW(), 'YYYYMM') || '-' || LPAD(NEXTVAL('invoice_number_seq')::TEXT, 6, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE SEQUENCE IF NOT EXISTS invoice_number_seq START 1;

CREATE TRIGGER generate_invoice_number_trigger
  BEFORE INSERT ON invoices
  FOR EACH ROW
  WHEN (NEW.invoice_number IS NULL)
  EXECUTE FUNCTION generate_invoice_number();

-- ============================================
-- 17. VIEWS FOR COMMON QUERIES
-- ============================================

-- Current organization usage this billing period
CREATE OR REPLACE VIEW v_organization_current_usage AS
SELECT 
  o.id as organization_id,
  o.name as organization_name,
  s.id as subscription_id,
  p.name as plan_name,
  p.included_minutes,
  COALESCE(SUM(c.billed_minutes), 0) as used_minutes,
  GREATEST(0, COALESCE(SUM(c.billed_minutes), 0) - p.included_minutes) as overage_minutes,
  COALESCE(SUM(c.cost_total_cents), 0) as total_cost_cents,
  COUNT(c.id) as total_calls,
  s.current_period_start,
  s.current_period_end
FROM organizations o
LEFT JOIN subscriptions s ON s.organization_id = o.id AND s.status IN ('active', 'trialing')
LEFT JOIN plans p ON p.id = s.plan_id
LEFT JOIN calls c ON c.organization_id = o.id 
  AND c.status = 'completed'
  AND c.started_at >= s.current_period_start 
  AND c.started_at < s.current_period_end
GROUP BY o.id, o.name, s.id, p.name, p.included_minutes, s.current_period_start, s.current_period_end;

-- Organization concurrency check
CREATE OR REPLACE VIEW v_organization_active_calls AS
SELECT 
  organization_id,
  COUNT(*) as active_calls
FROM calls
WHERE status = 'in_progress'
GROUP BY organization_id;

-- ============================================
-- DONE
-- ============================================
