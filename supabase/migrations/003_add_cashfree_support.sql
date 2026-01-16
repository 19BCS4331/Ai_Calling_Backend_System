-- ============================================
-- CASHFREE PAYMENT GATEWAY SUPPORT
-- Version: 1.0.0
-- 
-- Adds Cashfree as a payment provider alongside
-- Stripe and Razorpay for Indian market support.
-- ============================================

-- Add Cashfree customer ID to organizations
ALTER TABLE organizations 
ADD COLUMN IF NOT EXISTS cashfree_customer_id TEXT;

-- Add Cashfree subscription ID to subscriptions
ALTER TABLE subscriptions 
ADD COLUMN IF NOT EXISTS cashfree_subscription_id TEXT;

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_organizations_cashfree_customer 
ON organizations(cashfree_customer_id) 
WHERE cashfree_customer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_subscriptions_cashfree 
ON subscriptions(cashfree_subscription_id) 
WHERE cashfree_subscription_id IS NOT NULL;

-- Add Cashfree price IDs to plans (for subscription plans)
ALTER TABLE plans
ADD COLUMN IF NOT EXISTS cashfree_plan_id_monthly TEXT,
ADD COLUMN IF NOT EXISTS cashfree_plan_id_yearly TEXT;

-- Add comments for documentation
COMMENT ON COLUMN organizations.cashfree_customer_id IS 
'Cashfree customer ID for Indian payment processing';

COMMENT ON COLUMN subscriptions.cashfree_subscription_id IS 
'Cashfree subscription ID for recurring billing';

COMMENT ON COLUMN plans.cashfree_plan_id_monthly IS 
'Cashfree plan ID for monthly billing';

COMMENT ON COLUMN plans.cashfree_plan_id_yearly IS 
'Cashfree plan ID for yearly billing';

-- ============================================
-- DONE
-- ============================================
