-- Disable automatic cost calculation trigger
-- Application now handles cost calculation with caching discount

DROP TRIGGER IF EXISTS calculate_call_cost_trigger ON calls;

-- Keep the function for potential future use, but don't auto-trigger it
-- If needed, it can be called manually or re-enabled later
