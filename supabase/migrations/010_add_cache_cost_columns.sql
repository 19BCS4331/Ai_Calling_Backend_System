-- Add cache-specific cost columns to providers table
-- This allows dynamic pricing for LLM cache creation and storage

ALTER TABLE providers 
ADD COLUMN cost_cache_write_per_1k_tokens_cents DECIMAL(10, 4) DEFAULT 0,
ADD COLUMN cost_cache_storage_per_1k_tokens_per_hour_cents DECIMAL(10, 4) DEFAULT 0;

COMMENT ON COLUMN providers.cost_cache_write_per_1k_tokens_cents IS 'Cost to write/create cache per 1K tokens (cents)';
COMMENT ON COLUMN providers.cost_cache_storage_per_1k_tokens_per_hour_cents IS 'Cost to store cached tokens per 1K tokens per hour (cents)';

-- Update Gemini providers with cache pricing
-- Cache write: $0.03/1M tokens = 0.003¢/1K tokens
-- Cache storage: $1.00/1M tokens/hour = 0.0001¢/1K tokens/hour
UPDATE providers 
SET 
  cost_cache_write_per_1k_tokens_cents = 0.003,
  cost_cache_storage_per_1k_tokens_per_hour_cents = 0.0001
WHERE type = 'llm' AND slug LIKE '%gemini%';
