-- ============================================
-- FIX TRIAL CREDIT BALANCE
-- Update existing trial subscriptions to have $5 credit
-- ============================================

-- Update all trial subscriptions to have $5 credit (500 cents)
UPDATE subscriptions
SET 
  credit_balance_cents = 500,
  credit_used_cents = 0,
  status = 'trialing',
  trial_start = COALESCE(trial_start, NOW()),
  trial_end = COALESCE(trial_end, NOW() + INTERVAL '14 days'),
  updated_at = NOW()
FROM plans
WHERE subscriptions.plan_id = plans.id
  AND plans.slug = 'trial'
  AND subscriptions.credit_balance_cents = 0;

-- Log the update
DO $$
DECLARE
  v_updated_count INTEGER;
BEGIN
  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  RAISE NOTICE 'Updated % trial subscriptions with $5 credit', v_updated_count;
END $$;
