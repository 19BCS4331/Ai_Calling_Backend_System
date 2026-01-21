# Tools Management Guide

## Overview

The Tools Management feature allows you to create reusable tools that extend your voice agents' capabilities. Tools can be:
- **Function Tools**: Custom webhooks that call your server
- **MCP Tools**: Model Context Protocol server integrations
- **Built-in Tools**: System tools like call transfer, end call, etc.

## Database Schema

### Tables

#### `tools`
Organization-level tool definitions with configuration for different tool types.

**Key Fields:**
- `type`: 'function', 'mcp', or 'builtin'
- `status`: 'active', 'inactive', or 'error'
- Type-specific config fields (function_*, mcp_*, builtin_*)
- `messages`: Voice messages during tool execution
- `async_mode`: Run tool asynchronously
- `retry_config`: Retry settings

#### `agent_tools`
Junction table linking agents to tools with per-agent overrides.

**Key Fields:**
- `agent_id`: Reference to agent
- `tool_id`: Reference to tool
- `config_overrides`: Agent-specific config
- `messages_overrides`: Agent-specific messages
- `is_enabled`: Enable/disable tool for this agent
- `sort_order`: Tool execution priority

#### `tool_executions`
Logs of tool executions for analytics and debugging.

## Creating Tools

### Function Tools

Function tools call your custom webhook endpoints:

```typescript
{
  name: "Book Appointment",
  type: "function",
  function_server_url: "https://your-api.com/book-appointment",
  function_method: "POST",
  function_timeout_ms: 30000,
  function_headers: {
    "Authorization": "Bearer your-token",
    "Content-Type": "application/json"
  },
  function_parameters: {
    "type": "object",
    "properties": {
      "date": { "type": "string", "format": "date" },
      "time": { "type": "string" },
      "name": { "type": "string" }
    },
    "required": ["date", "time", "name"]
  }
}
```

**Request Format:**
Your server will receive:
```json
{
  "tool_name": "Book Appointment",
  "parameters": {
    "date": "2026-01-20",
    "time": "14:00",
    "name": "John Doe"
  },
  "call_id": "uuid",
  "agent_id": "uuid"
}
```

**Response Format:**
Your server should return:
```json
{
  "success": true,
  "result": {
    "confirmation_number": "ABC123",
    "message": "Appointment booked successfully"
  }
}
```

### MCP Tools

MCP tools connect to Model Context Protocol servers:

```typescript
{
  name: "Company Knowledge Base",
  type: "mcp",
  mcp_server_url: "https://your-mcp-server.com/sse",
  mcp_transport: "sse",
  mcp_timeout_ms: 30000,
  mcp_auth_type: "bearer",
  mcp_auth_config: {
    "token": "your-bearer-token"
  }
}
```

**Supported Transports:**
- `sse`: Server-Sent Events (recommended)
- `websocket`: WebSocket connection
- `stdio`: Standard I/O (for local processes)

**Authentication Types:**
- `none`: No authentication
- `bearer`: Bearer token in Authorization header
- `api_key`: API key in custom header
- `basic`: Basic HTTP authentication

### Built-in Tools

Built-in tools are system-level tools that don't require configuration:
- Transfer Call
- End Call
- DTMF (Dial Keypad)
- SMS

## Adding Tools to Agents

### Via UI

1. Navigate to **Agents** → Select your agent → **Tools** tab
2. Click **Add Tool**
3. Select from available tools
4. Configure tool-specific settings (optional)
5. Enable/disable as needed

### Via API

```typescript
// Add tool to agent
const { data } = await supabase
  .from('agent_tools')
  .insert({
    agent_id: 'agent-uuid',
    tool_id: 'tool-uuid',
    is_enabled: true,
    config_overrides: {
      // Agent-specific overrides
    }
  });
```

## Tool Messages

Configure what the agent says during tool execution:

```typescript
{
  messages: {
    request_start: "Let me check that for you...",
    request_complete: "I've got the information.",
    request_failed: "I couldn't complete that request right now.",
    request_delayed: "This is taking a moment, please hold..."
  }
}
```

## Backend Integration

### Retrieving Agent Tools

Use the `get_agent_tools()` database function:

```sql
SELECT * FROM get_agent_tools('agent-uuid');
```

Returns:
- Tool configuration merged with agent-specific overrides
- Only enabled tools with 'active' status
- Ordered by sort_order

### Per-Agent MCP Connections

When a call starts with an agent:

1. Backend queries `get_agent_tools(agent_id)` for MCP tools
2. Dynamically connects to each MCP server
3. Makes tools available during the call
4. Disconnects MCP clients when call ends

**Example Backend Flow:**

```typescript
// On session start
const agentTools = await getAgentTools(agentId);
const mcpTools = agentTools.filter(t => t.tool_type === 'mcp');

for (const tool of mcpTools) {
  const mcpClient = await mcpClientManager.addServer({
    name: `${sessionId}_${tool.tool_slug}`,
    url: tool.tool_config.server_url,
    transport: tool.tool_config.transport,
    auth: tool.tool_config.auth_config
  });
  
  sessionMcpClients.set(sessionId, mcpClient);
}

// On session end
await cleanupSessionMcpClients(sessionId);
```

## Tool Validation

Validate tool connectivity before using:

```typescript
// Via UI: Tools page → Click "Validate" on a tool

// Via API
const result = await validateTool(toolId);
if (!result.valid) {
  console.error('Validation failed:', result.error);
}
```

Validation checks:
- **Function tools**: HEAD request to server URL
- **MCP tools**: Connection test to MCP server
- Updates `last_validated_at` and `validation_error` fields

## Best Practices

### 1. Tool Design
- **Single Responsibility**: Each tool should do one thing well
- **Clear Naming**: Use descriptive names that the LLM can understand
- **Good Descriptions**: Help the LLM know when to use the tool

### 2. Error Handling
- Always return proper error responses
- Use retry configuration for transient failures
- Set appropriate timeouts

### 3. Security
- Use authentication for all external tools
- Store credentials securely (encrypted in database)
- Validate all inputs on your server

### 4. Performance
- Use async mode for long-running operations
- Set realistic timeouts
- Monitor tool execution logs

### 5. Testing
- Test tools independently before adding to agents
- Use validation feature regularly
- Monitor tool_executions table for issues

## Troubleshooting

### Tool Not Executing

1. Check tool status is 'active'
2. Verify tool is enabled in agent_tools
3. Check validation_error field
4. Review tool_executions logs

### MCP Connection Failures

1. Verify MCP server URL is accessible
2. Check authentication credentials
3. Ensure correct transport type
4. Review backend logs for connection errors

### Function Tool Timeouts

1. Increase function_timeout_ms
2. Enable async_mode for long operations
3. Optimize your server endpoint
4. Check network connectivity

## Migration Guide

To add the tools feature to an existing deployment:

1. **Run Migration:**
   ```bash
   supabase db push
   # Or manually run: supabase/migrations/004_tools_management.sql
   ```

2. **Update Backend:**
   - Implement per-agent tool retrieval
   - Add MCP client lifecycle management
   - Handle tool execution requests

3. **Deploy Frontend:**
   - New Tools page and components are ready
   - Agent form includes Tools tab
   - No breaking changes to existing features

## API Reference

### Database Functions

#### `get_agent_tools(agent_id UUID)`
Returns all enabled tools for an agent with merged configuration.

**Returns:**
- `tool_id`: Tool UUID
- `tool_name`: Tool name
- `tool_slug`: Tool slug
- `tool_type`: 'function', 'mcp', or 'builtin'
- `tool_config`: Merged configuration (base + overrides)
- `messages`: Merged messages (base + overrides)

### Views

#### `v_tools_with_usage`
Tools with usage statistics.

**Columns:**
- All tool columns
- `agent_count`: Number of agents using this tool
- `executions_last_30_days`: Execution count in last 30 days

#### `v_agent_tools_detail`
Agent-tool associations with full details.

**Columns:**
- All agent_tools columns
- All related tool columns (prefixed with `tool_`)

## Examples

### Example 1: Weather Lookup Tool

```typescript
const weatherTool = {
  name: "Weather Lookup",
  description: "Get current weather for a location",
  type: "function",
  function_server_url: "https://api.yourservice.com/weather",
  function_method: "POST",
  function_parameters: {
    type: "object",
    properties: {
      location: {
        type: "string",
        description: "City name or zip code"
      }
    },
    required: ["location"]
  },
  messages: {
    request_start: "Let me check the weather for you...",
    request_complete: "Here's the weather information.",
    request_failed: "I couldn't get the weather right now."
  }
};
```

### Example 2: CRM Integration via MCP

```typescript
const crmTool = {
  name: "CRM Lookup",
  description: "Look up customer information from CRM",
  type: "mcp",
  mcp_server_url: "https://your-mcp-server.com/sse",
  mcp_transport: "sse",
  mcp_auth_type: "bearer",
  mcp_auth_config: {
    token: process.env.CRM_MCP_TOKEN
  },
  messages: {
    request_start: "Looking up your information...",
    request_complete: "I found your account details."
  }
};
```

### Example 3: Appointment Booking

```typescript
const bookingTool = {
  name: "Book Appointment",
  description: "Schedule an appointment with our team",
  type: "function",
  function_server_url: "https://api.yourservice.com/appointments",
  function_method: "POST",
  function_timeout_ms: 45000,
  function_parameters: {
    type: "object",
    properties: {
      date: { type: "string", format: "date" },
      time: { type: "string", pattern: "^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$" },
      name: { type: "string", minLength: 2 },
      email: { type: "string", format: "email" },
      phone: { type: "string" }
    },
    required: ["date", "time", "name"]
  },
  async_mode: false,
  retry_config: {
    max_retries: 3,
    retry_delay_ms: 2000
  }
};
```

## Support

For issues or questions:
1. Check tool_executions table for error logs
2. Review validation_error field on tools
3. Check backend logs for MCP connection issues
4. Consult Vapi documentation for tool best practices
