-- ============================================
-- TOOLS MANAGEMENT SCHEMA
-- Version: 1.0.0
-- Adds support for organization-level tools and agent-tool associations
-- ============================================

-- ============================================
-- ENUMS
-- ============================================

CREATE TYPE tool_type AS ENUM (
  'function',    -- Custom webhook-based function tools
  'mcp',         -- MCP (Model Context Protocol) server integrations
  'builtin'      -- Built-in system tools (transfer, end call, etc.)
);

CREATE TYPE tool_status AS ENUM (
  'active',
  'inactive',
  'error'
);

CREATE TYPE mcp_transport AS ENUM (
  'sse',         -- Server-Sent Events (recommended)
  'stdio',       -- Standard I/O
  'websocket'    -- WebSocket
);

-- ============================================
-- TOOLS TABLE
-- Organization-level tool definitions
-- ============================================

CREATE TABLE tools (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  
  -- Basic info
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(100) NOT NULL,
  description TEXT,
  type tool_type NOT NULL,
  status tool_status DEFAULT 'active',
  
  -- Function tool config (type = 'function')
  -- Server URL where the function is hosted
  function_server_url TEXT,
  -- HTTP method (POST, GET, etc.)
  function_method VARCHAR(10) DEFAULT 'POST',
  -- Request timeout in milliseconds
  function_timeout_ms INTEGER DEFAULT 30000,
  -- Custom headers for the request
  function_headers JSONB DEFAULT '{}',
  -- Function parameters schema (JSON Schema format)
  function_parameters JSONB DEFAULT '{"type": "object", "properties": {}}',
  
  -- MCP tool config (type = 'mcp')
  -- MCP server URL
  mcp_server_url TEXT,
  -- Transport type
  mcp_transport mcp_transport DEFAULT 'sse',
  -- Connection timeout
  mcp_timeout_ms INTEGER DEFAULT 30000,
  -- Authentication config
  mcp_auth_type VARCHAR(50), -- 'none', 'bearer', 'api_key', 'basic'
  mcp_auth_config JSONB DEFAULT '{}', -- Encrypted auth details
  -- Additional MCP settings
  mcp_settings JSONB DEFAULT '{}',
  
  -- Builtin tool config (type = 'builtin')
  -- Which builtin tool this represents
  builtin_type VARCHAR(50), -- 'transfer_call', 'end_call', 'dtmf', 'sms'
  builtin_config JSONB DEFAULT '{}',
  
  -- Voice assistant messages during tool execution
  messages JSONB DEFAULT '{
    "request_start": null,
    "request_complete": null,
    "request_failed": null,
    "request_delayed": null
  }',
  
  -- Advanced settings
  async_mode BOOLEAN DEFAULT FALSE, -- Run tool asynchronously
  retry_config JSONB DEFAULT '{"max_retries": 3, "retry_delay_ms": 1000}',
  
  -- Validation status
  last_validated_at TIMESTAMPTZ,
  validation_error TEXT,
  
  -- Metadata
  metadata JSONB DEFAULT '{}',
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES users(id),
  
  UNIQUE(organization_id, slug)
);

CREATE INDEX idx_tools_org ON tools(organization_id);
CREATE INDEX idx_tools_type ON tools(type);
CREATE INDEX idx_tools_status ON tools(status);

-- ============================================
-- AGENT TOOLS JUNCTION TABLE
-- Many-to-many relationship between agents and tools
-- ============================================

CREATE TABLE agent_tools (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  tool_id UUID NOT NULL REFERENCES tools(id) ON DELETE CASCADE,
  
  -- Tool-specific overrides for this agent
  -- Allows customizing tool behavior per agent
  config_overrides JSONB DEFAULT '{}',
  
  -- Override messages for this agent
  messages_overrides JSONB DEFAULT '{}',
  
  -- Ordering for tool priority
  sort_order INTEGER DEFAULT 0,
  
  -- Status
  is_enabled BOOLEAN DEFAULT TRUE,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(agent_id, tool_id)
);

CREATE INDEX idx_agent_tools_agent ON agent_tools(agent_id);
CREATE INDEX idx_agent_tools_tool ON agent_tools(tool_id);

-- ============================================
-- TOOL EXECUTION LOGS
-- Track tool usage for analytics and debugging
-- ============================================

CREATE TABLE tool_executions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
  tool_id UUID REFERENCES tools(id) ON DELETE SET NULL,
  call_id UUID REFERENCES calls(id) ON DELETE SET NULL,
  
  -- Execution details
  tool_name VARCHAR(255) NOT NULL,
  tool_type tool_type NOT NULL,
  
  -- Input/Output
  input_parameters JSONB,
  output_result JSONB,
  
  -- Timing
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER,
  
  -- Status
  status VARCHAR(50) NOT NULL DEFAULT 'pending', -- 'pending', 'success', 'error', 'timeout'
  error_message TEXT,
  
  -- Metadata
  metadata JSONB DEFAULT '{}',
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_tool_executions_org ON tool_executions(organization_id);
CREATE INDEX idx_tool_executions_agent ON tool_executions(agent_id);
CREATE INDEX idx_tool_executions_tool ON tool_executions(tool_id);
CREATE INDEX idx_tool_executions_call ON tool_executions(call_id);
CREATE INDEX idx_tool_executions_started ON tool_executions(started_at DESC);

-- ============================================
-- VIEWS
-- ============================================

-- View for tools with usage counts
CREATE OR REPLACE VIEW v_tools_with_usage AS
SELECT 
  t.*,
  COUNT(DISTINCT at.agent_id) AS agent_count,
  COUNT(DISTINCT te.id) FILTER (WHERE te.started_at > NOW() - INTERVAL '30 days') AS executions_last_30_days
FROM tools t
LEFT JOIN agent_tools at ON t.id = at.tool_id AND at.is_enabled = TRUE
LEFT JOIN tool_executions te ON t.id = te.tool_id
GROUP BY t.id;

-- View for agent tools with full tool details
CREATE OR REPLACE VIEW v_agent_tools_detail AS
SELECT 
  at.id AS agent_tool_id,
  at.agent_id,
  at.is_enabled,
  at.sort_order,
  at.config_overrides,
  at.messages_overrides,
  t.id AS tool_id,
  t.name AS tool_name,
  t.slug AS tool_slug,
  t.description AS tool_description,
  t.type AS tool_type,
  t.status AS tool_status,
  t.function_server_url,
  t.function_parameters,
  t.mcp_server_url,
  t.mcp_transport,
  t.mcp_auth_type,
  t.builtin_type,
  t.messages,
  t.async_mode
FROM agent_tools at
JOIN tools t ON at.tool_id = t.id;

-- ============================================
-- FUNCTIONS
-- ============================================

-- Function to get all enabled tools for an agent
CREATE OR REPLACE FUNCTION get_agent_tools(p_agent_id UUID)
RETURNS TABLE (
  tool_id UUID,
  tool_name VARCHAR(255),
  tool_slug VARCHAR(100),
  tool_type tool_type,
  tool_config JSONB,
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
        'parameters', t.function_parameters
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
    END AS tool_config,
    COALESCE(at.messages_overrides, t.messages) AS messages
  FROM agent_tools at
  JOIN tools t ON at.tool_id = t.id
  WHERE at.agent_id = p_agent_id
    AND at.is_enabled = TRUE
    AND t.status = 'active'
  ORDER BY at.sort_order, t.name;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- TRIGGERS
-- ============================================

-- Update updated_at timestamp
CREATE TRIGGER update_tools_updated_at
  BEFORE UPDATE ON tools
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_agent_tools_updated_at
  BEFORE UPDATE ON agent_tools
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================

ALTER TABLE tools ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_tools ENABLE ROW LEVEL SECURITY;
ALTER TABLE tool_executions ENABLE ROW LEVEL SECURITY;

-- Tools policies
CREATE POLICY "Users can view tools in their organizations"
  ON tools FOR SELECT
  USING (organization_id IN (SELECT get_user_org_ids()));

CREATE POLICY "Users can create tools in their organizations"
  ON tools FOR INSERT
  WITH CHECK (organization_id IN (SELECT get_user_org_ids()));

CREATE POLICY "Users can update tools in their organizations"
  ON tools FOR UPDATE
  USING (organization_id IN (SELECT get_user_org_ids()));

CREATE POLICY "Users can delete tools in their organizations"
  ON tools FOR DELETE
  USING (organization_id IN (SELECT get_user_org_ids()));

-- Agent tools policies (based on agent's organization)
CREATE POLICY "Users can view agent tools for their agents"
  ON agent_tools FOR SELECT
  USING (agent_id IN (
    SELECT id FROM agents WHERE organization_id IN (SELECT get_user_org_ids())
  ));

CREATE POLICY "Users can create agent tools for their agents"
  ON agent_tools FOR INSERT
  WITH CHECK (agent_id IN (
    SELECT id FROM agents WHERE organization_id IN (SELECT get_user_org_ids())
  ));

CREATE POLICY "Users can update agent tools for their agents"
  ON agent_tools FOR UPDATE
  USING (agent_id IN (
    SELECT id FROM agents WHERE organization_id IN (SELECT get_user_org_ids())
  ));

CREATE POLICY "Users can delete agent tools for their agents"
  ON agent_tools FOR DELETE
  USING (agent_id IN (
    SELECT id FROM agents WHERE organization_id IN (SELECT get_user_org_ids())
  ));

-- Tool executions policies
CREATE POLICY "Users can view tool executions in their organizations"
  ON tool_executions FOR SELECT
  USING (organization_id IN (SELECT get_user_org_ids()));

CREATE POLICY "Users can create tool executions in their organizations"
  ON tool_executions FOR INSERT
  WITH CHECK (organization_id IN (SELECT get_user_org_ids()));

-- ============================================
-- SEED DATA: Builtin Tools
-- ============================================

-- These are system-level builtin tools that can be enabled per agent
-- They will be created for each organization when needed

-- Note: Builtin tools are typically created at the application level
-- when an organization is created, not as global seed data
