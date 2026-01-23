-- Add column to track cached tokens for transparency and auditing
-- This helps understand caching effectiveness and verify cost calculations

ALTER TABLE calls 
ADD COLUMN llm_cached_tokens INTEGER DEFAULT 0;

COMMENT ON COLUMN calls.llm_cached_tokens IS 'Number of LLM prompt tokens served from cache (receive 75% discount)';
