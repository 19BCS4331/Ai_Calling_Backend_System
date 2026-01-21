-- Migration: Add api_request tool type support
-- This updates the get_agent_tools function to handle api_request type tools

-- Drop the existing function first
DROP FUNCTION IF EXISTS get_agent_tools(UUID);

-- Recreate the get_agent_tools function to include api_request type
CREATE OR REPLACE FUNCTION get_agent_tools(p_agent_id UUID)
RETURNS TABLE (
  tool_id UUID,
  tool_name VARCHAR(255),
  tool_slug VARCHAR(100),
  tool_type tool_type,
  tool_config JSONB,
  tool_description TEXT,
  messages JSONB
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    t.id AS tool_id,
    t.name AS tool_name,
    t.slug AS tool_slug,
    t.type AS tool_type,
    CASE t.type
      WHEN 'function' THEN jsonb_build_object(
        'server_url', t.function_server_url,
        'method', t.function_method,
        'timeout_ms', t.function_timeout_ms,
        'headers', t.function_headers,
        'parameters', t.function_parameters,
        'auth_config', t.function_auth_config
      ) || COALESCE(at.config_overrides, '{}'::jsonb)
      WHEN 'api_request' THEN jsonb_build_object(
        'server_url', t.function_server_url,
        'method', t.function_method,
        'timeout_ms', t.function_timeout_ms,
        'headers', t.function_headers,
        'parameters', t.function_parameters,
        'auth_config', t.function_auth_config
      ) || COALESCE(at.config_overrides, '{}'::jsonb)
      WHEN 'mcp' THEN jsonb_build_object(
        'server_url', t.mcp_server_url,
        'transport', t.mcp_transport,
        'timeout_ms', t.mcp_timeout_ms,
        'auth_type', t.mcp_auth_type,
        'auth_config', t.mcp_auth_config,
        'settings', t.mcp_settings
      ) || COALESCE(at.config_overrides, '{}'::jsonb)
      WHEN 'builtin' THEN jsonb_build_object(
        'builtin_type', t.builtin_type,
        'config', t.builtin_config
      ) || COALESCE(at.config_overrides, '{}'::jsonb)
      ELSE '{}'::jsonb
    END AS tool_config,
    t.description AS tool_description,
    COALESCE(at.messages_overrides, t.messages) AS messages
  FROM agent_tools at
  JOIN tools t ON at.tool_id = t.id
  WHERE at.agent_id = p_agent_id
    AND at.is_enabled = TRUE
    AND t.status = 'active'
  ORDER BY at.sort_order, t.name;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
