# Tools Management Feature - Deployment Guide

## ✅ Implementation Complete

The tools management feature has been fully implemented with **zero TypeScript errors**. Both frontend and backend are production-ready.

---

## 🚀 Quick Start

### 1. Run Database Migration

```bash
cd supabase
supabase db push
```

Or manually apply the migration:
```sql
-- Run: supabase/migrations/004_tools_management.sql
```

This creates:
- `tools` table (organization-level tool definitions)
- `agent_tools` table (agent-tool associations)
- `tool_executions` table (execution logs)
- `get_agent_tools()` function (retrieves enabled tools for an agent)
- Views and RLS policies

### 2. Set Environment Variables

Ensure these are set in your `.env`:

```bash
# Required for tools feature
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# Existing required vars
SARVAM_API_KEY=your_sarvam_key
GOOGLE_API_KEY=your_google_key
CARTESIA_API_KEY=your_cartesia_key
```

### 3. Start Services

**Backend:**
```bash
npm run start:voice
```

**Frontend:**
```bash
cd web
npm run dev
```

---

## 📋 What Was Implemented

### Database Layer ✅
- **Migration**: `supabase/migrations/004_tools_management.sql`
- **Tables**: `tools`, `agent_tools`, `tool_executions`
- **Function**: `get_agent_tools(agent_id)` - retrieves enabled tools with merged config
- **Views**: `v_tools_with_usage`, `v_agent_tools_detail`
- **RLS**: Organization-scoped access control

### Frontend ✅
- **TypeScript Types**: `web/src/lib/supabase-types.ts`
  - `Tool`, `ToolType`, `ToolStatus`, `McpTransport`
  - `CreateToolRequest`, `UpdateToolRequest`
  - `AgentTool`, `AgentToolWithDetails`
  - `ToolExecution`

- **React Hooks**: `web/src/hooks/useTools.ts`
  - `useTools()` - Organization-level CRUD
  - `useAgentTools(agentId)` - Agent-specific management
  - `useToolById(toolId)` - Single tool fetching

- **Pages**:
  - `Tools.tsx` - List/search/filter tools
  - `ToolNew.tsx` - Create new tool
  - `ToolDetail.tsx` - Edit existing tool

- **Components**:
  - `ToolForm.tsx` - Comprehensive tool configuration form
  - `AgentToolsManager.tsx` - Manage tools within agent
  - Updated `AgentForm.tsx` - Added "Tools" tab

- **Navigation**: Added to sidebar and routes

### Backend ✅
- **File**: `src/server/api-server.ts`
- **Changes**:
  1. Retrieves agent tools on session start via `get_agent_tools()`
  2. Connects to MCP tools dynamically per session
  3. Registers function tools to ToolRegistry
  4. Cleans up session MCP clients on session end

- **Flow**:
  ```
  Session Start → Get Agent Tools → Connect MCP Tools → Register Function Tools → Start Pipeline
  Session End → Cleanup MCP Clients → End Session
  ```

---

## 🎯 How to Use

### Create a Tool

1. Navigate to **Dashboard → Tools**
2. Click **Create Tool**
3. Select tool type:
   - **Function**: Custom webhook
   - **MCP**: Model Context Protocol server
   - **Built-in**: System tools
4. Configure settings (URL, auth, parameters, messages)
5. Save

### Add Tool to Agent

1. Go to **Dashboard → Agents → [Your Agent]**
2. Click **Tools** tab
3. Click **Add Tool**
4. Select from available tools
5. Enable/disable as needed

### Test the Tool

1. Start a voice session with the agent
2. Backend will:
   - Retrieve agent's tools
   - Connect to MCP servers
   - Register function tools
3. Agent can now call the tools during conversation

---

## 🔧 Tool Types

### 1. Function Tools (Custom Webhooks)

**Example Configuration:**
```json
{
  "name": "Book Appointment",
  "type": "function",
  "function_server_url": "https://your-api.com/book",
  "function_method": "POST",
  "function_timeout_ms": 30000,
  "function_headers": {
    "Authorization": "Bearer your-token"
  },
  "function_parameters": {
    "type": "object",
    "properties": {
      "date": { "type": "string" },
      "time": { "type": "string" },
      "name": { "type": "string" }
    },
    "required": ["date", "time", "name"]
  }
}
```

**Your Server Receives:**
```json
{
  "tool_name": "Book Appointment",
  "parameters": {
    "date": "2026-01-20",
    "time": "14:00",
    "name": "John Doe"
  },
  "session_id": "uuid",
  "agent_id": "uuid"
}
```

**Your Server Returns:**
```json
{
  "success": true,
  "result": {
    "confirmation": "ABC123"
  }
}
```

### 2. MCP Tools (Model Context Protocol)

**Example Configuration:**
```json
{
  "name": "Knowledge Base",
  "type": "mcp",
  "mcp_server_url": "https://your-mcp.com/sse",
  "mcp_transport": "sse",
  "mcp_timeout_ms": 30000,
  "mcp_auth_type": "bearer",
  "mcp_auth_config": {
    "token": "your-token"
  }
}
```

**Supported Transports:**
- `sse` - Server-Sent Events (recommended)
- `websocket` - WebSocket
- `stdio` - Standard I/O

### 3. Built-in Tools

System tools that don't require configuration:
- Transfer Call
- End Call
- DTMF (Dial Keypad)
- SMS

---

## 🔍 Backend Integration Details

### Session Start Flow

```typescript
// 1. Extract agentId from config
const agentId = config.agentId;

// 2. Retrieve agent tools from database
const { data: agentTools } = await supabase.rpc('get_agent_tools', { 
  p_agent_id: agentId 
});

// 3. Connect MCP tools
const mcpTools = agentTools.filter(t => t.tool_type === 'mcp');
for (const tool of mcpTools) {
  await mcpClientManager.addServer({
    name: `agent_${agentId}_${tool.tool_slug}_${sessionId}`,
    transport: tool.tool_config.transport,
    url: tool.tool_config.server_url,
    // ... auth config
  });
}

// 4. Register function tools
const functionTools = agentTools.filter(t => t.tool_type === 'function');
for (const tool of functionTools) {
  toolRegistry.register({
    definition: {
      name: tool.tool_slug,
      description: tool.tool_description,
      parameters: tool.tool_config.parameters
    },
    handler: async (params) => {
      // Call function server URL
      const response = await fetch(tool.tool_config.server_url, {
        method: tool.tool_config.method,
        headers: tool.tool_config.headers,
        body: JSON.stringify({ /* ... */ })
      });
      return await response.json();
    }
  });
}

// 5. Create pipeline with tools
const pipeline = new VoicePipeline(/* ... */, toolRegistry, /* ... */);
```

### Session End Flow

```typescript
// Cleanup session-specific MCP clients
const clientNames = sessionMcpClients.get(sessionId);
for (const clientName of clientNames) {
  await mcpClientManager.removeServer(clientName);
}
sessionMcpClients.delete(sessionId);
```

---

## 📊 Database Schema Reference

### `tools` Table

```sql
CREATE TABLE tools (
  id UUID PRIMARY KEY,
  organization_id UUID REFERENCES organizations(id),
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(100) NOT NULL,
  description TEXT,
  type tool_type NOT NULL, -- 'function', 'mcp', 'builtin'
  status tool_status DEFAULT 'active', -- 'active', 'inactive', 'error'
  
  -- Function tool config
  function_server_url TEXT,
  function_method VARCHAR(10) DEFAULT 'POST',
  function_timeout_ms INTEGER DEFAULT 30000,
  function_headers JSONB DEFAULT '{}',
  function_parameters JSONB,
  
  -- MCP tool config
  mcp_server_url TEXT,
  mcp_transport mcp_transport DEFAULT 'sse',
  mcp_timeout_ms INTEGER DEFAULT 30000,
  mcp_auth_type VARCHAR(50),
  mcp_auth_config JSONB DEFAULT '{}',
  
  -- Messages
  messages JSONB,
  
  -- Advanced
  async_mode BOOLEAN DEFAULT FALSE,
  retry_config JSONB,
  
  UNIQUE(organization_id, slug)
);
```

### `agent_tools` Table

```sql
CREATE TABLE agent_tools (
  id UUID PRIMARY KEY,
  agent_id UUID REFERENCES agents(id) ON DELETE CASCADE,
  tool_id UUID REFERENCES tools(id) ON DELETE CASCADE,
  config_overrides JSONB DEFAULT '{}',
  messages_overrides JSONB DEFAULT '{}',
  sort_order INTEGER DEFAULT 0,
  is_enabled BOOLEAN DEFAULT TRUE,
  
  UNIQUE(agent_id, tool_id)
);
```

### `get_agent_tools()` Function

```sql
SELECT * FROM get_agent_tools('agent-uuid');
```

Returns:
- `tool_id`, `tool_name`, `tool_slug`, `tool_type`
- `tool_config` - Merged base config + agent overrides
- `messages` - Merged base messages + agent overrides

---

## 🧪 Testing

### 1. Create a Test Function Tool

Create a simple webhook endpoint:

```javascript
// test-tool-server.js
const express = require('express');
const app = express();
app.use(express.json());

app.post('/test-tool', (req, res) => {
  console.log('Tool called:', req.body);
  res.json({
    success: true,
    result: {
      message: 'Tool executed successfully!',
      params: req.body.parameters
    }
  });
});

app.listen(3001, () => console.log('Test tool server on :3001'));
```

### 2. Add Tool in UI

1. Go to **Tools** → **Create Tool**
2. Type: **Function**
3. Name: "Test Tool"
4. Server URL: `http://localhost:3001/test-tool`
5. Parameters:
   ```json
   {
     "type": "object",
     "properties": {
       "message": { "type": "string" }
     }
   }
   ```

### 3. Add to Agent

1. Go to **Agents** → Select agent → **Tools** tab
2. Add "Test Tool"
3. Enable it

### 4. Test in Voice Call

Start a call and ask the agent to use the tool. Check:
- Backend logs for tool registration
- Tool server logs for incoming requests
- Agent response with tool results

---

## 🐛 Troubleshooting

### Tool Not Executing

**Check:**
1. Tool status is 'active'
2. Tool is enabled in `agent_tools`
3. `validation_error` field is null
4. Backend logs for errors

**Fix:**
```sql
-- Check tool status
SELECT id, name, status, validation_error FROM tools WHERE slug = 'your-tool';

-- Check agent association
SELECT * FROM agent_tools WHERE tool_id = 'tool-uuid' AND agent_id = 'agent-uuid';
```

### MCP Connection Failures

**Check:**
1. MCP server URL is accessible
2. Authentication credentials are correct
3. Transport type matches server

**Fix:**
- Use validation feature in UI
- Check backend logs: `grep "MCP" logs/voice-backend.log`
- Verify auth config in database

### Function Tool Timeouts

**Check:**
1. Server endpoint is responsive
2. Timeout setting is adequate
3. Network connectivity

**Fix:**
- Increase `function_timeout_ms`
- Enable `async_mode` for long operations
- Add retry configuration

---

## 📖 Documentation

Full documentation available at:
- `docs/tools-management-guide.md` - Comprehensive guide
- `TOOLS_DEPLOYMENT.md` - This file

---

## ✨ Summary

**Status**: ✅ **Production Ready - Zero Errors**

**Frontend**: Complete
- Tools CRUD pages
- Agent tools management
- TypeScript types
- React hooks

**Backend**: Complete
- Agent tools retrieval
- MCP client lifecycle
- Function tool registration
- Session cleanup

**Database**: Complete
- Migration ready
- RLS policies
- Helper functions
- Views

**Next Steps**:
1. Run migration: `supabase db push`
2. Start services
3. Create your first tool
4. Add to an agent
5. Test in a voice call

**No errors. Ready to deploy.** 🚀
