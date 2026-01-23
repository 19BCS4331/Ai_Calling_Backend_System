-- Migration: Fix cost precision in calls table
-- Change cost columns from INTEGER to DECIMAL(10,4) to preserve fractional cents

-- Drop dependent views first
DROP VIEW IF EXISTS v_organization_current_usage;

-- Alter cost columns to DECIMAL for precision
ALTER TABLE calls 
  ALTER COLUMN cost_telephony_cents TYPE DECIMAL(10,4),
  ALTER COLUMN cost_stt_cents TYPE DECIMAL(10,4),
  ALTER COLUMN cost_tts_cents TYPE DECIMAL(10,4),
  ALTER COLUMN cost_llm_cents TYPE DECIMAL(10,4),
  ALTER COLUMN cost_total_cents TYPE DECIMAL(10,4);

-- Update default values to 0.0
ALTER TABLE calls 
  ALTER COLUMN cost_telephony_cents SET DEFAULT 0.0,
  ALTER COLUMN cost_stt_cents SET DEFAULT 0.0,
  ALTER COLUMN cost_tts_cents SET DEFAULT 0.0,
  ALTER COLUMN cost_llm_cents SET DEFAULT 0.0,
  ALTER COLUMN cost_total_cents SET DEFAULT 0.0;

-- Add comment for clarity
COMMENT ON COLUMN calls.cost_telephony_cents IS 'Telephony cost in cents (supports fractional cents for accuracy)';
COMMENT ON COLUMN calls.cost_stt_cents IS 'STT cost in cents (supports fractional cents for accuracy)';
COMMENT ON COLUMN calls.cost_tts_cents IS 'TTS cost in cents (supports fractional cents for accuracy)';
COMMENT ON COLUMN calls.cost_llm_cents IS 'LLM cost in cents (supports fractional cents for accuracy)';
COMMENT ON COLUMN calls.cost_total_cents IS 'Total cost in cents (supports fractional cents for accuracy)';

-- Recreate the view that was dropped
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
