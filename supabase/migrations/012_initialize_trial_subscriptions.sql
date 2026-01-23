-- ============================================
-- INITIALIZE TRIAL SUBSCRIPTIONS
-- Auto-create trial subscription for new organizations
-- ============================================

-- Function to create trial subscription for new organization
CREATE OR REPLACE FUNCTION create_trial_subscription()
RETURNS TRIGGER AS $$
DECLARE
  v_trial_plan_id UUID;
BEGIN
  -- Get the trial plan ID
  SELECT id INTO v_trial_plan_id
  FROM plans
  WHERE slug = 'trial'
  LIMIT 1;

  -- Create trial subscription if plan exists
  IF v_trial_plan_id IS NOT NULL THEN
    INSERT INTO subscriptions (
      organization_id,
      plan_id,
      status,
      billing_interval,
      current_period_start,
      current_period_end,
      trial_start,
      trial_end,
      credit_balance_cents,
      credit_used_cents
    ) VALUES (
      NEW.id,
      v_trial_plan_id,
      'trialing',
      'monthly',
      NOW(),
      NOW() + INTERVAL '1 month',
      NOW(),
      NOW() + INTERVAL '14 days',
      500, -- $5 credit
      0
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-create trial subscription
CREATE TRIGGER create_trial_subscription_trigger
  AFTER INSERT ON organizations
  FOR EACH ROW
  EXECUTE FUNCTION create_trial_subscription();

COMMENT ON FUNCTION create_trial_subscription IS 'Automatically create trial subscription with $5 credit for new organizations';

-- Update existing organizations without subscriptions to have trial
DO $$
DECLARE
  v_trial_plan_id UUID;
  v_org RECORD;
BEGIN
  -- Get trial plan ID
  SELECT id INTO v_trial_plan_id
  FROM plans
  WHERE slug = 'trial'
  LIMIT 1;

  -- For each organization without an active subscription
  FOR v_org IN 
    SELECT o.id
    FROM organizations o
    LEFT JOIN subscriptions s ON o.id = s.organization_id 
      AND s.status IN ('active', 'trialing')
    WHERE s.id IS NULL
  LOOP
    -- Create trial subscription
    INSERT INTO subscriptions (
      organization_id,
      plan_id,
      status,
      billing_interval,
      current_period_start,
      current_period_end,
      trial_start,
      trial_end,
      credit_balance_cents,
      credit_used_cents
    ) VALUES (
      v_org.id,
      v_trial_plan_id,
      'trialing',
      'monthly',
      NOW(),
      NOW() + INTERVAL '1 month',
      NOW(),
      NOW() + INTERVAL '14 days',
      500, -- $5 credit
      0
    );
  END LOOP;
END $$;
