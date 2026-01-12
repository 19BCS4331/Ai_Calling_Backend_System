# 🎙️ AI Voice Calling Backend

A **production-grade, low-latency AI voice calling backend** with pluggable STT/LLM/TTS providers, designed for real-time AI phone calls in India.

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     API Server (Express + WS)                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐  │
│  │  Session │    │   Tool   │    │   MCP    │    │ Metrics  │  │
│  │ Manager  │    │ Registry │    │  Server  │    │ Collector│  │
│  └──────────┘    └──────────┘    └──────────┘    └──────────┘  │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                      Voice Pipeline                              │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Audio In → STT → LLM (+ Tools) → TTS → Audio Out        │   │
│  │            ↓         ↓              ↓                     │   │
│  │        Streaming  Sentence      Streaming                 │   │
│  │        Partial    Chunking      Audio                     │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                     Provider Layer                               │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐                 │
│  │    STT     │  │    LLM     │  │    TTS     │                 │
│  ├────────────┤  ├────────────┤  ├────────────┤                 │
│  │ • Sarvam   │  │ • Gemini   │  │ • Sarvam   │                 │
│  │ • Google   │  │ • OpenAI   │  │ • Reverie  │                 │
│  │ • Reverie  │  │ • Groq     │  │ • Google   │                 │
│  └────────────┘  └────────────┘  └────────────┘                 │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## ✨ Features

### Core Capabilities
- **🔌 Pluggable Providers** - Swap STT/LLM/TTS providers without code changes
- **⚡ Low Latency** - Sub-800ms end-to-end response time target
- **🇮🇳 Indian Language Support** - Hindi, Tamil, Telugu, Malayalam, Kannada, Bengali, Marathi, Gujarati, Punjabi
- **🎯 Agentic AI** - Tool calling with conversation memory
- **🔗 n8n Integration** - Native MCP server for workflow automation

### Technical Features
- **WebSocket Streaming** - Real-time bidirectional audio
- **Dynamic API Keys** - Per-client, per-call credential injection
- **Multi-tenant** - Session isolation with Redis-backed state
- **Horizontal Scaling** - Stateless workers with external session store
- **Observability** - Structured logging, metrics, cost tracking

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- Redis 6+
- API keys for your chosen providers

### Installation

```bash
# Clone and install dependencies
git clone <repository-url>
cd ai-voice-calling-backend
npm install

# Configure environment
cp .env.example .env
# Edit .env with your API keys

# Start development server
npm run dev
```

### Production Deployment

```bash
# Build
npm run build

# Start
npm start
```

## 📡 API Reference

### REST Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/metrics` | GET | System metrics |
| `/api/v1/sessions` | POST | Create new session |
| `/api/v1/sessions/:id` | GET | Get session details |
| `/api/v1/sessions/:id` | DELETE | End session |
| `/api/v1/tools` | GET | List available tools |
| `/api/v1/mcp` | POST | MCP protocol endpoint |

### WebSocket Protocol

Connect to `ws://localhost:3000` for real-time voice streaming.

#### Start Session
```json
{
  "type": "start_session",
  "tenantId": "your-tenant-id",
  "config": {
    "language": "hi-IN",
    "systemPrompt": "You are a helpful assistant...",
    "stt": {
      "provider": "sarvam",
      "apiKey": "your-sarvam-key"
    },
    "llm": {
      "provider": "gemini",
      "apiKey": "your-gemini-key",
      "model": "gemini-2.5-flash"
    },
    "tts": {
      "provider": "sarvam",
      "apiKey": "your-sarvam-key",
      "voiceId": "anushka"
    }
  }
}
```

#### Send Audio
Send binary WebSocket frames with PCM audio (16kHz, 16-bit, mono)

Or send base64 encoded:
```json
{
  "type": "audio",
  "data": "base64-encoded-audio-data"
}
```

#### Events from Server
```json
{ "type": "session_started", "sessionId": "..." }
{ "type": "stt_partial", "sessionId": "...", "text": "..." }
{ "type": "stt_final", "sessionId": "...", "text": "..." }
{ "type": "llm_sentence", "sessionId": "...", "sentence": "..." }
{ "type": "turn_complete", "sessionId": "...", "metrics": {...} }
{ "type": "barge_in", "sessionId": "..." }
// Binary frames: TTS audio chunks
```

## 🔧 Provider Configuration

### Sarvam AI (STT + TTS)
```typescript
{
  type: 'sarvam',
  credentials: { apiKey: 'your-key' },
  language: 'hi-IN',
  model: 'saarika:v2.5'  // STT model
}
```

### Google Gemini (LLM)
```typescript
{
  type: 'gemini',
  credentials: { apiKey: 'your-key' },
  model: 'gemini-2.5-flash',
  temperature: 0.7
}
```

### Reverie (TTS)
```typescript
{
  type: 'reverie',
  credentials: { 
    apiKey: 'your-key',
    projectId: 'your-app-id'
  }
}
```

## 🛠️ Tool Calling

### Built-in Tools
- `get_current_time` - Get current date/time
- `end_call` - End call gracefully
- `transfer_call` - Transfer to human agent
- `hold_call` - Put caller on hold

### n8n Workflow Tools (via MCP)
- `create_loan_application` - Create loan in CRM
- `fetch_customer_details` - Fetch customer data
- `send_payment_link` - Send payment links
- `book_appointment` - Book appointments
- `update_crm_record` - Update CRM records
- `check_loan_status` - Check loan status
- `send_document_request` - Request documents

### Custom Tools
```typescript
import { ToolRegistry, RegisteredTool } from './tools/tool-registry';

const myTool: RegisteredTool = {
  definition: {
    name: 'my_custom_tool',
    description: 'Does something useful',
    parameters: {
      type: 'object',
      properties: {
        param1: { type: 'string', description: 'A parameter' }
      },
      required: ['param1']
    }
  },
  handler: async (args, context) => {
    // Your tool logic here
    return { result: 'success' };
  }
};

toolRegistry.register(myTool);
```

## 🔗 n8n Integration

### Setup n8n Webhooks

1. Create workflows in n8n with Webhook triggers
2. Configure the webhook URLs in your environment:

```env
N8N_BASE_URL=https://your-n8n.com
N8N_API_KEY=your-n8n-api-key
ENABLE_MCP=true
```

3. The voice agent will automatically discover and use these tools during conversations.

### Example n8n Workflow
```
[Webhook Trigger] → [CRM Lookup] → [Decision] → [Response]
```

## 📊 Observability

### Metrics Endpoint
```bash
curl http://localhost:3000/metrics
```

Returns:
```json
{
  "latencies": {
    "http_request{method=\"GET\",path=\"/health\"}": {
      "count": 100,
      "avg": 5.2,
      "p95": 12,
      "p99": 25
    },
    "turn_e2e": {
      "avg": 650,
      "p95": 780
    }
  },
  "counters": {
    "sessions_created": 50,
    "tool_calls": 120
  }
}
```

### Logging
Structured JSON logs with Pino:
```json
{
  "level": "info",
  "time": "2025-01-12T13:30:00.000Z",
  "service": "voice-agent",
  "sessionId": "abc-123",
  "msg": "Turn complete",
  "e2eLatency": 650,
  "turnCount": 5
}
```

## 🌐 Supported Languages

| Language | Code | STT | TTS |
|----------|------|-----|-----|
| Indian English | en-IN | ✅ | ✅ |
| Hindi | hi-IN | ✅ | ✅ |
| Tamil | ta-IN | ✅ | ✅ |
| Telugu | te-IN | ✅ | ✅ |
| Malayalam | ml-IN | ✅ | ✅ |
| Kannada | kn-IN | ✅ | ✅ |
| Bengali | bn-IN | ✅ | ✅ |
| Marathi | mr-IN | ✅ | ✅ |
| Gujarati | gu-IN | ✅ | ✅ |
| Punjabi | pa-IN | ✅ | ✅ |

## 📁 Project Structure

```
src/
├── index.ts                 # Main entry point
├── types/                   # TypeScript type definitions
│   └── index.ts
├── providers/               # Provider implementations
│   ├── base/               # Abstract base classes
│   │   ├── stt-provider.ts
│   │   ├── llm-provider.ts
│   │   └── tts-provider.ts
│   ├── stt/                # STT implementations
│   │   └── sarvam-stt.ts
│   ├── llm/                # LLM implementations
│   │   └── gemini-llm.ts
│   └── tts/                # TTS implementations
│       ├── sarvam-tts.ts
│       └── reverie-tts.ts
├── pipeline/               # Voice pipeline
│   └── voice-pipeline.ts
├── tools/                  # Tool calling
│   └── tool-registry.ts
├── mcp/                    # MCP server
│   └── mcp-server.ts
├── session/                # Session management
│   └── session-manager.ts
├── server/                 # HTTP/WS server
│   └── api-server.ts
└── utils/                  # Utilities
    └── logger.ts
```

## 🔒 Security

- **No hardcoded credentials** - All API keys via environment or per-request
- **Encrypted transport** - WSS/HTTPS in production
- **PII redaction** - Sensitive data redacted from logs
- **Tenant isolation** - Sessions isolated by tenant ID
- **API key authentication** - Required for all endpoints

## 📈 Performance Targets

| Metric | Target |
|--------|--------|
| End-to-end latency | < 800ms |
| First audio byte | < 500ms |
| Concurrent calls | 1000+ |
| Session memory | < 50MB |

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests: `npm test`
5. Submit a pull request

## 📄 License

MIT License - see LICENSE file for details.
