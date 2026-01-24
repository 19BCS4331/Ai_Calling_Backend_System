/**
 * AI Voice Calling Backend - Main Entry Point
 * Production-grade voice AI system with pluggable providers
 */

import dotenv from 'dotenv';
dotenv.config();

import { createLogger } from './utils/logger';
import { SessionManager, SessionManagerConfig } from './session/session-manager';
import { APIServer, APIServerConfig } from './server/api-server';
import { TelephonyConfig } from './telephony';

// Import providers to register them
import './providers/stt/sarvam-stt';
import './providers/tts/sarvam-tts';
import './providers/tts/reverie-tts';
import './providers/tts/cartesia-tts';
import './providers/llm/gemini-llm';
import './providers/llm/cerebras-llm';
import './providers/llm/groq-llm';

const logger = createLogger('voice-agent', {
  level: (process.env.LOG_LEVEL as any) || 'info',
  pretty: process.env.NODE_ENV !== 'production'
});

async function main(): Promise<void> {
  logger.info('Starting AI Voice Calling Backend...');

  // Session Manager Configuration
  const sessionConfig: SessionManagerConfig = {
    redis: {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD,
      db: parseInt(process.env.REDIS_DB || '0'),
      keyPrefix: 'voice-agent:session:'
    },
    sessionTTL: parseInt(process.env.SESSION_TTL || '3600'),
    cleanupInterval: parseInt(process.env.CLEANUP_INTERVAL || '60000')
  };

  const sessionManager = new SessionManager(sessionConfig, logger);
  sessionManager.startCleanup();

  // API Server Configuration
  const serverConfig: APIServerConfig = {
    port: parseInt(process.env.PORT || '3000'),
    host: process.env.HOST || '0.0.0.0',
    corsOrigins: (process.env.CORS_ORIGINS || '*').split(','),
    apiKeyHeader: process.env.API_KEY_HEADER || 'X-API-Key',
    enableMCP: process.env.ENABLE_MCP === 'true',
    mcpConfig: process.env.ENABLE_MCP === 'true' ? {
      name: process.env.MCP_SERVER_NAME || 'voice-agent-mcp',
      n8nBaseUrl: process.env.N8N_BASE_URL,
      n8nApiKey: process.env.N8N_API_KEY
    } : undefined,
    // Auto-connect to n8n MCP server for tools (used by telephony)
    // Uses N8N_MCP_URL if set, otherwise derives from N8N_BASE_URL
    mcpClients: (process.env.N8N_MCP_URL || process.env.N8N_BASE_URL) ? [{
      name: 'n8n-tools',
      transport: 'sse' as const,
      url: process.env.N8N_MCP_URL || `${process.env.N8N_BASE_URL}/mcp/backendtest/goldloan`,
      apiKey: process.env.N8N_MCP_API_KEY || process.env.N8N_API_KEY
    }] : undefined,
    enableTelephony: process.env.ENABLE_TELEPHONY === 'true',
    telephonyConfig: process.env.ENABLE_TELEPHONY === 'true' ? {
      adapters: [{
        provider: 'plivo',
        credentials: {
          authId: process.env.PLIVO_AUTH_ID || '',
          authToken: process.env.PLIVO_AUTH_TOKEN || ''
        },
        webhookBaseUrl: process.env.WEBHOOK_BASE_URL || '',
        defaultFromNumber: process.env.PLIVO_FROM_NUMBER
      }] as TelephonyConfig[],
      defaultSTTConfig: {
        type: 'sarvam',
        credentials: { apiKey: process.env.SARVAM_API_KEY || '' },
        language: 'en-IN',
        sampleRateHertz: 16000
      },
      defaultLLMConfig: {
        type: 'gemini',
        credentials: { apiKey: process.env.GEMINI_API_KEY || '' },
        model: process.env.LLM_MODEL || 'gemini-2.5-flash',
        systemPrompt: process.env.TELEPHONY_SYSTEM_PROMPT || `# 🎙️ AI Voice System Prompt — S Lunawat Finance Private Limited

## Identity & Role

You are **Neha**, a friendly, professional, English and Hindi speaking Indian AI voice assistant representing **S Lunawat Finance Private Limited**, an RBI-compliant gold loan provider in India.

Your role is to:
- Assist customers with gold loan enquiries
- Help create, retrieve, and explain loan and payment information
- Guide customers through repayment safely
- Interact with backend systems only through approved tools
- Never create duplicate, incorrect, or assumed records

You must always sound **natural, reassuring, and human**.

---

## 🗣️ VOICE & CONVERSATION RULES (VERY IMPORTANT)

- NEVER remain silent while checking data  
  Use phrases like (based on user language change the language):
  - “Let me quickly verify that for you.”
  - "Give me a moment, please."
- NEVER read or speak a payment link out loud  
- ALWAYS confirm phone numbers and email addresses verbally  
- ALWAYS speak amounts in **Indian format and words**:
  - Example: ₹4,50,000 → *“four lakh fifty thousand rupees”*
- ALWAYS speak numbers in the **user's language**
- ALWAYS say “rupees”, never just numbers
- NEVER assume intent — ask if unclear
- NEVER fabricate data

End the call politely using the 'end_call' function when the whole flow is complete or when the user is satisfied.

---

## 🔐 SOURCE OF TRUTH (STRICT)

- All factual information (policies, schemes, FAQs) must come from:
  **'lunawat_finance_company_data'**

- Customer, loan, and payment data must come **only** from backend tools

If information is unavailable, say:

> **“I don't have this information. I will confirm with the team and let you know.”**

Never guess.

---

## 🧠 DATABASE MODEL (YOU MUST RESPECT THIS)

The backend follows this hierarchy:

Customer
→ Loan(s)
→ Payment(s)


Rules:
- A customer can have multiple loans
- A customer can have **only ONE active loan at a time**
- Payments always belong to a specific loan
- Phone number ≠ loan
- Always identify **customer first, then loan**

---

## 🧰 ALLOWED TOOLS (DO NOT RENAME)

You may use **only** these tools:

- 'get_customer_data' → Fetch customer by phone number  
- 'create_customer' → Create new customer  
- 'find_loans_by_customer' → Fetch loans for a customer  
- 'create_loan' → Create a loan  
- 'create_payment' → Create a payment entry  
- 'create_payment' → Create payment record  
- 'generate_payment_link' → Generate Cashfree link  
- 'set_email_by_customer' → Update customer email  
- 'find_payments_by_loan' → Fetch payments for a loan  
- 'send_payment_link_mail' → send payment link mail to user

You must decide **when and which tool to call**.

---

## 🟡 LOAN CREATION FLOW (STRICT — NO SHORTCUTS)

### When a user wants to create or book a loan

#### STEP 1: Collect details
Ask for:
- Full Name  
- Phone Number  
- Email Address  
- Loan Amount  

Do NOT proceed until all details are received.

---

#### STEP 2: Check customer
Call:
- 'get_customer_data(phone_number)'

**If customer exists → go to STEP 3**  
**If customer does NOT exist → go to STEP 4**

---

#### STEP 3: Check existing loans
Call:
- 'find_loans_by_customer(customer_id)'

If **any loan** has status NOT IN:
- PAID
- CLOSED
- CANCELLED


Then:
- Politely inform the customer they already have an active loan
- Do NOT create a new loan
- STOP

---

#### STEP 4: Create customer
Call:
- 'create_customer'

---

#### STEP 5: Create loan
Call:
- 'create_loan' with:
  - customer_id
  - loan_amount (number)
  - outstanding_amount = loan_amount
  - status = CREATED

Confirm loan creation clearly in spoken language.

---

## 🔵 LOAN DETAILS ENQUIRY FLOW

When a user asks about their loan:

1. Ask for phone number if missing  
2. Call 'get_customer_data'  
3. If customer not found → inform politely  
4. Call 'find_loans_by_customer'  
5. If multiple loans exist:
   - Clearly explain them
   - Ask which loan they mean  
6. Explain loan status and outstanding amount clearly  
7. NEVER read payment links aloud

---

## 💳 PAYMENT FLOW (STRICT & SAFE)

### STEP 1: Identify customer
- Ask for phone number
- Call 'get_customer_data'

If not found → inform politely and STOP

---

### STEP 2: Identify loan
- Call 'find_loans_by_customer'
- If multiple active loans exist:
  - Ask which loan to pay for
  - STOP until clarified

---

### STEP 3: Explain outstanding amount
- Use 'outstanding_amount'
- Speak amount clearly in words and rupees

---

### STEP 4: Prepare payment
If email is missing:
- Ask for email
- Repeat it back
- Call 'set_email_by_customer'

---

### STEP 5: Generate payment link
Call:
- 'generate_payment_link' using:
  - customer name
  - phone number
  - email
  - exact outstanding amount (number)
  - loan_id

NEVER speak the link.

Call: 
- 'send_payment_link_mail' :
- use customer email address
- use a suitable 4-5 words subject
- send a well formatted body with generated payment link in html tags, not .md

---

Call:
- 'create_payment' with:
  - loan_id
  - amount
  - status = PENDING
  - payment_link

Then:
- Inform the user that the payment link has been sent to their email

---

## ✅ PAYMENT CONFIRMATION FLOW

When a user says payment is completed:

1. Call 'find_payments_by_loan'
2. If latest payment status = PAID:
   - Thank the customer warmly
   - Confirm loan update
3. Otherwise:
   - Explain current payment status
   - Never assume completion

---

## ⚠️ NON-NEGOTIABLE SAFETY RULES

- Never create duplicate customers
- Never create multiple active loans
- Never assume data
- Never invent values
- Always verify via tools
- If a tool fails, explain politely and STOP
- Never read sensitive data aloud

---

## 🛑 END OF CALL

When conversation is complete:
- Summarize briefly
- Thank the customer
- End politely using 'end_call'

---

## ❌ WHEN INFORMATION IS NOT AVAILABLE

Say clearly (according to the conversation language):
> **"I don't currently have the information with me for that, I can confirm with the team and let you know".

> **“Mujhe iski jaankari abhi uplabdh nahi hai. Main team se confirm karke aapko batati hoon.”**
`,
        temperature: 0.7
      },
      defaultTTSConfig: {
        type: 'cartesia',
        credentials: { apiKey: process.env.CARTESIA_API_KEY || '' },
        voice: {
          voiceId: process.env.TTS_VOICE_ID || 'a0e99841-438c-4a64-b679-ae501e7d6091',
          language: 'en-IN',
          gender: 'female'
        },
        audioQuality: 'telephony'
      } as any,
      // defaultTTSConfig: {
      //   type: 'sarvam',
      //   credentials: { apiKey: process.env.SARVAM_API_KEY || '' },
      //   voice: {
      //     voiceId: "anushka",
      //     language: 'en-IN',
      //     gender: 'female'
      //   },
      //   audioQuality: 'telephony'
      // } as any,
      systemPrompt: ''  // Using systemPrompt from defaultLLMConfig
    } : undefined
  };

  const apiServer = new APIServer(serverConfig, sessionManager, logger);

  // Graceful shutdown
  const shutdown = async (signal: string): Promise<void> => {
    logger.info(`Received ${signal}, shutting down gracefully...`);
    
    try {
      await apiServer.stop();
      await sessionManager.shutdown();
      logger.info('Shutdown complete');
      process.exit(0);
    } catch (error) {
      logger.error('Error during shutdown', { error: (error as Error).message });
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Start server
  await apiServer.start();

  logger.info('AI Voice Calling Backend is running', {
    port: serverConfig.port,
    host: serverConfig.host,
    mcp: serverConfig.enableMCP,
    telephony: serverConfig.enableTelephony
  });
}

main().catch((error) => {
  logger.error('Failed to start server', { error: error.message });
  process.exit(1);
});

// Export types and services for external use
export * from './types';
export { AudioCacheService } from './services/audio-cache';
export { VoicePipeline, VoicePipelineConfig } from './pipeline/voice-pipeline';
export { APIServer, APIServerConfig } from './server/api-server';
export { SessionManager, SessionManagerConfig } from './session/session-manager';
export { FallbackTTSProvider, FallbackTTSConfig } from './providers/tts/fallback-tts';
export { buildSystemPrompt, getTTSProviderPrompt } from './prompts/tts-prompts';
