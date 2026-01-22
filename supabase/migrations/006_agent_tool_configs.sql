-- ============================================
-- Agent Tool Configuration Management
-- ============================================
-- This migration adds support for selective tool enablement and renaming
-- per agent, allowing users to customize which MCP tools are available
-- and what they're called.

-- ============================================
-- Agent Tool Configurations Table
-- ============================================
CREATE TABLE IF NOT EXISTS agent_tool_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  tool_id UUID NOT NULL REFERENCES tools(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  
  -- Tool customization
  enabled BOOLEAN NOT NULL DEFAULT true,
  custom_name TEXT,  -- Override the MCP tool name (e.g., "get_customer_data2" -> "get_customer_data")
  custom_description TEXT,  -- Override tool description
  
  -- MCP-specific fields
  mcp_function_name TEXT,  -- Original n8n/MCP function name
  display_order INTEGER DEFAULT 0,  -- Order in UI
  
  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Constraints
  UNIQUE(agent_id, tool_id, mcp_function_name),
  
  -- Ensure custom_name is unique per agent if provided
  CONSTRAINT unique_custom_name_per_agent 
    EXCLUDE (agent_id WITH =, custom_name WITH =) 
    WHERE (custom_name IS NOT NULL AND enabled = true)
);

-- ============================================
-- Indexes
-- ============================================
CREATE INDEX idx_agent_tool_configs_agent_id ON agent_tool_configs(agent_id);
CREATE INDEX idx_agent_tool_configs_tool_id ON agent_tool_configs(tool_id);
CREATE INDEX idx_agent_tool_configs_org_id ON agent_tool_configs(organization_id);
CREATE INDEX idx_agent_tool_configs_enabled ON agent_tool_configs(enabled) WHERE enabled = true;

-- ============================================
-- RLS Policies
-- ============================================
ALTER TABLE agent_tool_configs ENABLE ROW LEVEL SECURITY;

-- Users can view tool configs for agents in their organizations
CREATE POLICY agent_tool_configs_select ON agent_tool_configs
  FOR SELECT
  USING (organization_id IN (SELECT get_user_org_ids()));

-- Users can insert tool configs for agents in their organizations
CREATE POLICY agent_tool_configs_insert ON agent_tool_configs
  FOR INSERT
  WITH CHECK (organization_id IN (SELECT get_user_org_ids()));

-- Users can update tool configs for agents in their organizations
CREATE POLICY agent_tool_configs_update ON agent_tool_configs
  FOR UPDATE
  USING (organization_id IN (SELECT get_user_org_ids()));

-- Users can delete tool configs for agents in their organizations
CREATE POLICY agent_tool_configs_delete ON agent_tool_configs
  FOR DELETE
  USING (organization_id IN (SELECT get_user_org_ids()));

-- ============================================
-- Triggers
-- ============================================
CREATE TRIGGER update_agent_tool_configs_updated_at
  BEFORE UPDATE ON agent_tool_configs
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- ============================================
-- Helper Function: Get Agent Tools with Configs
-- ============================================
-- This function returns all tools for an agent with their configurations
CREATE OR REPLACE FUNCTION get_agent_tools_with_configs(p_agent_id UUID)
RETURNS TABLE (
  tool_id UUID,
  tool_name TEXT,
  tool_type TEXT,
  tool_slug TEXT,
  tool_description TEXT,
  mcp_server_url TEXT,
  mcp_function_name TEXT,
  enabled BOOLEAN,
  custom_name TEXT,
  custom_description TEXT,
  display_order INTEGER,
  config_id UUID
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    t.id AS tool_id,
    t.name AS tool_name,
    t.type AS tool_type,
    t.slug AS tool_slug,
    t.description AS tool_description,
    t.mcp_server_url,
    atc.mcp_function_name,
    COALESCE(atc.enabled, true) AS enabled,
    atc.custom_name,
    atc.custom_description,
    COALESCE(atc.display_order, 0) AS display_order,
    atc.id AS config_id
  FROM tools t
  INNER JOIN agent_tools at ON t.id = at.tool_id
  LEFT JOIN agent_tool_configs atc ON t.id = atc.tool_id AND at.agent_id = atc.agent_id
  WHERE at.agent_id = p_agent_id
  ORDER BY COALESCE(atc.display_order, 0), t.name;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- Helper Function: Bulk Update Tool Configs
-- ============================================
-- This function allows bulk updating tool configurations for an agent
CREATE OR REPLACE FUNCTION update_agent_tool_configs(
  p_agent_id UUID,
  p_organization_id UUID,
  p_configs JSONB
)
RETURNS VOID AS $$
DECLARE
  config JSONB;
BEGIN
  -- Loop through each config in the array
  FOR config IN SELECT * FROM jsonb_array_elements(p_configs)
  LOOP
    INSERT INTO agent_tool_configs (
      agent_id,
      tool_id,
      organization_id,
      enabled,
      custom_name,
      custom_description,
      mcp_function_name,
      display_order
    ) VALUES (
      p_agent_id,
      (config->>'tool_id')::UUID,
      p_organization_id,
      COALESCE((config->>'enabled')::BOOLEAN, true),
      config->>'custom_name',
      config->>'custom_description',
      config->>'mcp_function_name',
      COALESCE((config->>'display_order')::INTEGER, 0)
    )
    ON CONFLICT (agent_id, tool_id, mcp_function_name)
    DO UPDATE SET
      enabled = COALESCE((config->>'enabled')::BOOLEAN, true),
      custom_name = config->>'custom_name',
      custom_description = config->>'custom_description',
      display_order = COALESCE((config->>'display_order')::INTEGER, 0),
      updated_at = NOW();
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- Comments
-- ============================================
COMMENT ON TABLE agent_tool_configs IS 'Configuration for tools attached to agents, including selective enablement and renaming';
COMMENT ON COLUMN agent_tool_configs.custom_name IS 'Custom name to use instead of the original tool name (e.g., rename get_customer_data2 to get_customer_data)';
COMMENT ON COLUMN agent_tool_configs.mcp_function_name IS 'For MCP tools with multiple functions, this identifies which specific function this config applies to';
COMMENT ON FUNCTION get_agent_tools_with_configs IS 'Returns all tools for an agent with their configuration settings';
COMMENT ON FUNCTION update_agent_tool_configs IS 'Bulk update or insert tool configurations for an agent';
