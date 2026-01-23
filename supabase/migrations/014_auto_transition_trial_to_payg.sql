-- ============================================
-- AUTO-TRANSITION TRIAL TO PAYG
-- Automatically move users to PAYG when trial credits exhausted
-- ============================================

-- Function to auto-transition trial users to PAYG when credits reach 0
CREATE OR REPLACE FUNCTION auto_transition_trial_to_payg()
RETURNS TRIGGER AS $$
DECLARE
  trial_plan_id UUID;
  payg_plan_id UUID;
BEGIN
  -- Only process if credit_balance_cents changed and is now 0 or negative
  IF NEW.credit_balance_cents <= 0 AND (OLD.credit_balance_cents IS NULL OR OLD.credit_balance_cents > 0) THEN
    -- Get trial and PAYG plan IDs
    SELECT id INTO trial_plan_id FROM plans WHERE slug = 'trial';
    SELECT id INTO payg_plan_id FROM plans WHERE slug = 'payg';
    
    -- If this subscription is on trial plan, switch to PAYG
    IF NEW.plan_id = trial_plan_id THEN
      -- Update to PAYG plan
      NEW.plan_id := payg_plan_id;
      NEW.status := 'active';
      
      -- Reset credit tracking (PAYG doesn't use credits)
      NEW.credit_balance_cents := 0;
      
      -- Log the transition
      RAISE NOTICE 'Auto-transitioned organization % from Trial to PAYG', NEW.organization_id;
      
      -- Insert audit log
      INSERT INTO audit_logs (
        organization_id,
        user_id,
        action,
        resource_type,
        resource_id,
        details
      ) VALUES (
        NEW.organization_id,
        NULL, -- System action
        'subscription_auto_upgraded',
        'subscription',
        NEW.id,
        jsonb_build_object(
          'from_plan', 'trial',
          'to_plan', 'payg',
          'reason', 'trial_credits_exhausted'
        )
      );
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for auto-transition
DROP TRIGGER IF EXISTS trigger_auto_transition_trial_to_payg ON subscriptions;
CREATE TRIGGER trigger_auto_transition_trial_to_payg
  BEFORE UPDATE ON subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION auto_transition_trial_to_payg();

COMMENT ON FUNCTION auto_transition_trial_to_payg() IS 'Automatically transitions trial users to PAYG when credits are exhausted';
