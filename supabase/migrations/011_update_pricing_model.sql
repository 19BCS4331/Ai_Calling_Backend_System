-- ============================================
-- UPDATE PRICING MODEL
-- Trial: $5 credit → PAYG → Subscriptions
-- ============================================

-- 1. Add credit-based columns to plans
ALTER TABLE plans 
ADD COLUMN IF NOT EXISTS included_credit_cents INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS is_credit_based BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN plans.included_credit_cents IS 'Credit amount in cents (alternative to minutes)';
COMMENT ON COLUMN plans.is_credit_based IS 'If true, use credit instead of minutes for limits';

-- 2. Add credit tracking to subscriptions
ALTER TABLE subscriptions
ADD COLUMN IF NOT EXISTS credit_balance_cents INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS credit_used_cents INTEGER DEFAULT 0;

COMMENT ON COLUMN subscriptions.credit_balance_cents IS 'Remaining credit balance in cents';
COMMENT ON COLUMN subscriptions.credit_used_cents IS 'Total credit used in cents';

-- 3. Add user-facing cost column to calls (what we charge the user)
ALTER TABLE calls
ADD COLUMN IF NOT EXISTS cost_user_cents DECIMAL(10, 4) DEFAULT 0;

COMMENT ON COLUMN calls.cost_user_cents IS 'Cost charged to user (different from internal cost)';

-- 4. Update existing plans with new pricing
-- Update or insert plans (upsert pattern)

-- Update existing 'free' plan to 'trial' or insert if doesn't exist
INSERT INTO plans (name, slug, tier, price_monthly_cents, price_yearly_cents, included_minutes, included_credit_cents, is_credit_based, included_agents, max_concurrent_calls, overage_rate_cents, history_retention_days, features, sort_order, description, is_public)
VALUES ('Trial', 'trial', 'free', 0, 0, 0, 500, TRUE, 1, 1, 12, 7, 
 '{"analytics": false, "webhooks": false, "api_access": false}'::jsonb, 0,
 '$5 free credit to get started. Auto-converts to Pay-as-you-go when exhausted.', TRUE)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  price_monthly_cents = EXCLUDED.price_monthly_cents,
  price_yearly_cents = EXCLUDED.price_yearly_cents,
  included_minutes = EXCLUDED.included_minutes,
  included_credit_cents = EXCLUDED.included_credit_cents,
  is_credit_based = EXCLUDED.is_credit_based,
  included_agents = EXCLUDED.included_agents,
  max_concurrent_calls = EXCLUDED.max_concurrent_calls,
  overage_rate_cents = EXCLUDED.overage_rate_cents,
  history_retention_days = EXCLUDED.history_retention_days,
  features = EXCLUDED.features,
  sort_order = EXCLUDED.sort_order,
  description = EXCLUDED.description,
  is_public = EXCLUDED.is_public;

-- Insert PAYG plan
INSERT INTO plans (name, slug, tier, price_monthly_cents, price_yearly_cents, included_minutes, included_credit_cents, is_credit_based, included_agents, max_concurrent_calls, overage_rate_cents, history_retention_days, features, sort_order, description, is_public)
VALUES ('Pay as you Go', 'payg', 'free', 0, 0, 0, 0, FALSE, 2, 1, 15, 7,
 '{"analytics": false, "webhooks": false, "api_access": true}'::jsonb, 1,
 'No monthly commitment. Pay only for what you use at $0.15/min.', TRUE)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  price_monthly_cents = EXCLUDED.price_monthly_cents,
  included_minutes = EXCLUDED.included_minutes,
  included_agents = EXCLUDED.included_agents,
  overage_rate_cents = EXCLUDED.overage_rate_cents,
  features = EXCLUDED.features,
  description = EXCLUDED.description;

-- Update Starter plan
INSERT INTO plans (name, slug, tier, price_monthly_cents, price_yearly_cents, included_minutes, included_credit_cents, is_credit_based, included_agents, max_concurrent_calls, overage_rate_cents, history_retention_days, features, sort_order, description, is_public)
VALUES ('Starter', 'starter', 'starter', 4900, 47000, 400, 0, FALSE, 3, 2, 14, 14,
 '{"analytics": true, "webhooks": false, "api_access": true}'::jsonb, 2,
 'Perfect for small teams. 400 minutes included at $0.1225/min effective rate.', TRUE)
ON CONFLICT (slug) DO UPDATE SET
  price_monthly_cents = EXCLUDED.price_monthly_cents,
  price_yearly_cents = EXCLUDED.price_yearly_cents,
  included_minutes = EXCLUDED.included_minutes,
  overage_rate_cents = EXCLUDED.overage_rate_cents,
  description = EXCLUDED.description;

-- Update Growth plan
INSERT INTO plans (name, slug, tier, price_monthly_cents, price_yearly_cents, included_minutes, included_credit_cents, is_credit_based, included_agents, max_concurrent_calls, overage_rate_cents, history_retention_days, features, sort_order, description, is_public)
VALUES ('Growth', 'growth', 'growth', 19900, 191000, 2000, 0, FALSE, 10, 5, 12, 30,
 '{"analytics": true, "webhooks": true, "api_access": true}'::jsonb, 3,
 'For growing businesses. 2000 minutes at $0.10/min effective rate.', TRUE)
ON CONFLICT (slug) DO UPDATE SET
  price_monthly_cents = EXCLUDED.price_monthly_cents,
  price_yearly_cents = EXCLUDED.price_yearly_cents,
  included_minutes = EXCLUDED.included_minutes,
  overage_rate_cents = EXCLUDED.overage_rate_cents,
  description = EXCLUDED.description;

-- Update Scale plan
INSERT INTO plans (name, slug, tier, price_monthly_cents, price_yearly_cents, included_minutes, included_credit_cents, is_credit_based, included_agents, max_concurrent_calls, overage_rate_cents, history_retention_days, features, sort_order, description, is_public)
VALUES ('Scale', 'scale', 'scale', 49900, 479000, 6000, 0, FALSE, -1, 20, 10, 90,
 '{"analytics": true, "webhooks": true, "api_access": true, "voice_cloning": true, "priority_support": true}'::jsonb, 4,
 'For high-volume operations. 6000 minutes at $0.083/min effective rate.', TRUE)
ON CONFLICT (slug) DO UPDATE SET
  price_monthly_cents = EXCLUDED.price_monthly_cents,
  price_yearly_cents = EXCLUDED.price_yearly_cents,
  included_minutes = EXCLUDED.included_minutes,
  overage_rate_cents = EXCLUDED.overage_rate_cents,
  description = EXCLUDED.description;

-- Update Enterprise plan
INSERT INTO plans (name, slug, tier, price_monthly_cents, price_yearly_cents, included_minutes, included_credit_cents, is_credit_based, included_agents, max_concurrent_calls, overage_rate_cents, history_retention_days, features, sort_order, description, is_public)
VALUES ('Enterprise', 'enterprise', 'enterprise', 0, 0, 0, 0, FALSE, -1, 100, 8, 365,
 '{"analytics": true, "webhooks": true, "api_access": true, "voice_cloning": true, "priority_support": true, "custom_integrations": true, "sla": true}'::jsonb, 5,
 'Custom pricing and dedicated support for large organizations.', TRUE)
ON CONFLICT (slug) DO UPDATE SET
  overage_rate_cents = EXCLUDED.overage_rate_cents,
  description = EXCLUDED.description;

-- 5. Create function to calculate user cost based on plan
CREATE OR REPLACE FUNCTION calculate_user_cost(
  p_duration_seconds INTEGER,
  p_plan_slug VARCHAR,
  p_overage_rate_cents INTEGER DEFAULT NULL
) RETURNS DECIMAL AS $$
DECLARE
  v_rate_cents DECIMAL;
BEGIN
  -- Get the rate based on plan
  IF p_overage_rate_cents IS NOT NULL THEN
    v_rate_cents := p_overage_rate_cents;
  ELSE
    SELECT overage_rate_cents INTO v_rate_cents
    FROM plans WHERE slug = p_plan_slug;
  END IF;
  
  -- Calculate cost: ceil(seconds / 60) * rate_cents
  RETURN CEIL(p_duration_seconds / 60.0) * COALESCE(v_rate_cents, 15);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION calculate_user_cost IS 'Calculate user-facing cost based on duration and plan rate';

-- 6. Create function to deduct credit from subscription
CREATE OR REPLACE FUNCTION deduct_credit(
  p_subscription_id UUID,
  p_amount_cents INTEGER
) RETURNS BOOLEAN AS $$
DECLARE
  v_balance INTEGER;
BEGIN
  -- Get current balance
  SELECT credit_balance_cents INTO v_balance
  FROM subscriptions
  WHERE id = p_subscription_id;
  
  -- Check if sufficient balance
  IF v_balance >= p_amount_cents THEN
    -- Deduct credit
    UPDATE subscriptions
    SET 
      credit_balance_cents = credit_balance_cents - p_amount_cents,
      credit_used_cents = credit_used_cents + p_amount_cents,
      updated_at = NOW()
    WHERE id = p_subscription_id;
    
    RETURN TRUE;
  ELSE
    RETURN FALSE;
  END IF;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION deduct_credit IS 'Deduct credit from subscription balance, returns success status';

-- 7. Create view for organization billing summary
CREATE OR REPLACE VIEW v_organization_billing AS
SELECT 
  o.id as organization_id,
  o.name as organization_name,
  s.id as subscription_id,
  p.name as plan_name,
  p.slug as plan_slug,
  p.tier as plan_tier,
  p.is_credit_based,
  s.status as subscription_status,
  s.credit_balance_cents,
  s.credit_used_cents,
  p.included_minutes,
  p.included_credit_cents,
  p.overage_rate_cents,
  s.current_period_start,
  s.current_period_end,
  -- Calculate usage in current period
  COALESCE(SUM(c.duration_seconds) FILTER (WHERE c.started_at >= s.current_period_start), 0) / 60 as minutes_used,
  COALESCE(SUM(c.cost_user_cents) FILTER (WHERE c.started_at >= s.current_period_start), 0) as total_charged_cents
FROM organizations o
LEFT JOIN subscriptions s ON o.id = s.organization_id AND s.status IN ('active', 'trialing')
LEFT JOIN plans p ON s.plan_id = p.id
LEFT JOIN calls c ON o.id = c.organization_id
GROUP BY o.id, o.name, s.id, p.name, p.slug, p.tier, p.is_credit_based, s.status, 
         s.credit_balance_cents, s.credit_used_cents, p.included_minutes, 
         p.included_credit_cents, p.overage_rate_cents, s.current_period_start, s.current_period_end;

COMMENT ON VIEW v_organization_billing IS 'Billing summary for each organization including usage and credits';
