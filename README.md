# 🎙️ VocaAI - AI Voice Calling Platform

A **production-grade, multi-tenant SaaS platform** for AI voice agents with pluggable STT/LLM/TTS providers, real-time telephony, and comprehensive billing.

> **Built for India** — Supports 10+ Indian languages with low-latency voice processing.

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Web Dashboard (React)                        │
│         Agent Builder │ Analytics │ Billing │ API Keys          │
└───────────────────────────────┬─────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                    API Layer (Express + WS)                      │
│          REST API (Port 3001)  │  Voice API (Port 8080)         │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐        │
│  │ Session  │  │   Tool   │  │   MCP    │  │ Billing  │        │
│  │ Manager  │  │ Registry │  │  Server  │  │ Engine   │        │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘        │
├─────────────────────────────────────────────────────────────────┤
│                      Voice Pipeline                              │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Audio In → STT → LLM (+ Tools) → TTS → Audio Out        │   │
│  │            ↓         ↓              ↓                     │   │
│  │        Streaming  Sentence      Streaming                 │   │
│  │        + Barge-in Chunking      Audio                     │   │
│  └──────────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────────┤
│                     Provider Layer                               │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌──────────┐  │
│  │    STT     │  │    LLM     │  │    TTS     │  │ Telephony│  │
│  ├────────────┤  ├────────────┤  ├────────────┤  ├──────────┤  │
│  │ • Sarvam   │  │ • Gemini   │  │ • Cartesia │  │ • Plivo  │  │
│  │ • Deepgram │  │ • OpenAI   │  │ • Sarvam   │  │ • Twilio │  │
│  │ • Assembly │  │ • Claude   │  │ • ElevenLabs│ └──────────┘  │
│  └────────────┘  └────────────┘  └────────────┘                 │
├─────────────────────────────────────────────────────────────────┤
│                     Data Layer (Supabase)                        │
│   Organizations │ Users │ Agents │ Calls │ Billing │ Usage     │
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
- **Barge-in Detection** - Interrupt AI mid-sentence with natural conversation
- **Dynamic API Keys** - Per-client, per-call credential injection
- **Multi-tenant SaaS** - Organizations, users, roles with RLS
- **Horizontal Scaling** - Stateless workers with external session store
- **Docker Ready** - Production-grade containerization
- **Observability** - Structured logging, metrics, cost tracking

### SaaS Features
- **🏢 Multi-tenant** - Organizations with team members and roles
- **💳 Subscription Billing** - Stripe/Razorpay integration
- **📊 Usage Tracking** - Per-minute billing with overage
- **🔑 API Keys** - Scoped keys with rate limiting
- **📞 Phone Numbers** - Provision and assign DIDs to agents
- **📈 Analytics** - Call metrics, costs, and quality tracking

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- Supabase project (for database & auth)
- API keys for your chosen providers

### Installation

```bash
# Clone and install dependencies
git clone <repository-url>
cd ai-voice-calling-backend
npm install

# Configure environment
cp .env.example .env
# Edit .env with your API keys and Supabase credentials

# Start development server
npm run dev
```

### 🐳 Docker Deployment (Recommended)

```bash
# Build and run with Docker Compose
docker-compose up -d

# With Redis for session persistence
docker-compose --profile with-redis up -d

# Or build standalone
docker build -t vocaai-backend .
docker run -d --env-file .env -p 8080:8080 vocaai-backend
```

### Manual Production Deployment

```bash
# Build
npm run build

# Start
npm start
```

### Deploy to Cloud Platforms

| Platform | Command |
|----------|----------|
| Railway | `railway up` |
| Fly.io | `fly launch && fly deploy` |
| Render | Connect repo, auto-deploy |
| DigitalOcean | App Platform from Dockerfile |

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
├── src/
│   ├── index.ts                 # Main entry point
│   ├── types/                   # TypeScript type definitions
│   ├── providers/               # Provider implementations
│   │   ├── base/                # Abstract base classes
│   │   ├── stt/                 # Sarvam, Deepgram, AssemblyAI
│   │   ├── llm/                 # Gemini, OpenAI, Claude
│   │   └── tts/                 # Cartesia, Sarvam, ElevenLabs
│   ├── pipeline/                # Voice pipeline with barge-in
│   ├── telephony/               # Plivo/Twilio integration
│   ├── tools/                   # Tool calling & registry
│   ├── mcp/                     # MCP server for n8n
│   ├── services/                # Audio cache, latency optimization
│   ├── prompts/                 # TTS-specific prompts
│   ├── session/                 # Session management
│   ├── server/                  # HTTP/WS API server
│   └── utils/                   # Logger, helpers
├── web/                         # React dashboard (Vite)
│   ├── src/components/          # UI components
│   └── src/hooks/               # WebSocket hooks
├── supabase/
│   └── migrations/              # Database schema
│       └── 001_initial_schema.sql
├── test/                        # Test clients
├── Dockerfile                   # Production container
├── docker-compose.yml           # Orchestration
└── .env.example                 # Environment template
```

## 💰 Pricing Tiers

Built-in subscription management with configurable plans:

| Plan | Price | Minutes | Concurrency | Features |
|------|-------|---------|-------------|----------|
| **Free** | $0 | Trial | 1 | Basic testing |
| **Starter** | $79/mo | 500 | 2 | Email support |
| **Growth** | $349/mo | 2,500 | 5 | Analytics, Webhooks, API |
| **Scale** | $1,299/mo | 10,000 | 20 | Voice cloning, Priority support |
| **Enterprise** | Custom | Custom | 100+ | SLA, Custom integrations |

## 🗄️ Database Schema (Supabase)

See `supabase/migrations/001_initial_schema.sql` for full schema.

**Core Tables:**
- `organizations` - Multi-tenant root with billing info
- `users` - Linked to Supabase Auth
- `organization_members` - User-org mapping with roles
- `plans` - Subscription tiers with pricing
- `subscriptions` - Org subscriptions with status
- `agents` - Voice agent configurations
- `calls` - Call records with cost breakdown
- `transcripts` - Conversation messages
- `usage_records` - Granular usage tracking
- `api_keys` - Scoped API keys
- `webhooks` - Event subscriptions

**Key Features:**
- Row Level Security (RLS) on all tables
- Automatic cost calculation triggers
- Daily usage aggregation
- Invoice number generation

## 🔒 Security

- **No hardcoded credentials** - All API keys via environment or per-request
- **Supabase RLS** - Row-level security for multi-tenancy
- **Encrypted transport** - WSS/HTTPS in production
- **PII redaction** - Sensitive data redacted from logs
- **Tenant isolation** - Sessions isolated by organization
- **API key authentication** - Scoped keys with rate limiting
- **Non-root Docker** - Container runs as unprivileged user

## 📈 Performance Targets

| Metric | Target |
|--------|--------|
| End-to-end latency | < 800ms |
| First audio byte | < 500ms |
| Concurrent calls | 1000+ |
| Session memory | < 50MB |

## 🛠️ Environment Variables

See `.env.example` for full list. Key variables:

```env
# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# Providers
SARVAM_API_KEY=your_sarvam_key
CARTESIA_API_KEY=your_cartesia_key
GOOGLE_API_KEY=your_google_key

# Telephony
PLIVO_AUTH_ID=your_plivo_id
PLIVO_AUTH_TOKEN=your_plivo_token

# Payments
STRIPE_SECRET_KEY=sk_...
RAZORPAY_KEY_ID=rzp_...
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests: `npm test`
5. Submit a pull request

## 📄 License

MIT License - see LICENSE file for details.

---

**Built with ❤️ for the Indian market** | [Documentation](./docs) | [API Reference](./docs/api.md)
