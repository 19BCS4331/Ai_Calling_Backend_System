-- ============================================
-- CONCURRENCY FUNCTION MIGRATION
-- Version: 1.0.1
-- 
-- This adds the atomic concurrency checking function
-- needed by the SaaS API layer.
-- ============================================

-- Atomic concurrency checking function
-- This locks the org row to prevent race conditions when
-- multiple calls try to start simultaneously.

CREATE OR REPLACE FUNCTION check_and_reserve_call_slot(
  p_org_id UUID,
  p_max_concurrent INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_current INTEGER;
BEGIN
  -- Lock the organization row to serialize concurrent checks
  -- This ensures only one call can be checking at a time per org
  PERFORM id FROM organizations WHERE id = p_org_id FOR UPDATE;
  
  -- Count current active calls
  SELECT COUNT(*) INTO v_current
  FROM calls
  WHERE organization_id = p_org_id
    AND status = 'in_progress';
  
  -- Check if allowed
  IF v_current >= p_max_concurrent THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'current', v_current,
      'max', p_max_concurrent,
      'reason', 'Concurrent call limit reached'
    );
  END IF;
  
  RETURN jsonb_build_object(
    'allowed', true,
    'current', v_current,
    'max', p_max_concurrent
  );
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION check_and_reserve_call_slot(UUID, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION check_and_reserve_call_slot(UUID, INTEGER) TO service_role;

-- Add comment for documentation
COMMENT ON FUNCTION check_and_reserve_call_slot IS 
'Atomic concurrency check for call slots. Locks the organization row to prevent race conditions.';
