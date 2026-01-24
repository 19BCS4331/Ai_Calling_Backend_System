/**
 * API Server
 * Express + WebSocket server for handling voice calls
 */

import express, { Express, Request, Response, NextFunction } from 'express';
import { Server as HTTPServer, createServer } from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import { v4 as uuidv4 } from 'uuid';

import { Logger, CallSession, STTConfig, LLMConfig, TTSConfig, LatencyOptimizationConfig, DEFAULT_LATENCY_CONFIG } from '../types';
import { SessionManager, CreateSessionOptions } from '../session/session-manager';
import { ToolRegistry, builtInTools } from '../tools/tool-registry';
import { demoBookingTools } from '../tools/demo-booking-tools';
import { MCPServer, createCommonN8nTools } from '../mcp/mcp-server';
import { MCPClientManager, MCPClientConfig } from '../mcp/mcp-client';
import { VoicePipeline } from '../pipeline/voice-pipeline';
import { STTProviderFactory } from '../providers/base/stt-provider';
import { LLMProviderFactory } from '../providers/base/llm-provider';
import { TTSProviderFactory } from '../providers/base/tts-provider';
import { InMemoryMetrics, CostTracker } from '../utils/logger';
import { TelephonyManager, TelephonyManagerConfig, PlivoAdapter, TelephonyConfig } from '../telephony';
import { AudioCacheService } from '../services/audio-cache';
import { buildSystemPrompt } from '../prompts/tts-prompts';
import { createCallRecord, endCallRecord, findCallBySessionId, getOrgIdFromAgent } from '../saas-api/call-persistence';

export interface APIServerConfig {
  port: number;
  host: string;
  corsOrigins: string[];
  apiKeyHeader: string;
  enableMCP: boolean;
  mcpConfig?: {
    name: string;
    n8nBaseUrl?: string;
    n8nApiKey?: string;
  };
  mcpClients?: MCPClientConfig[];  // External MCP servers to connect to
  enableTelephony?: boolean;
  telephonyConfig?: {
    adapters: TelephonyConfig[];
    defaultSTTConfig: STTConfig;
    defaultLLMConfig: LLMConfig;
    defaultTTSConfig: TTSConfig;
    systemPrompt: string;
  };
}

export class APIServer {
  private app: Express;
  private httpServer: HTTPServer;
  private wss: WebSocketServer;
  private logger: Logger;
  private config: APIServerConfig;
  
  private sessionManager: SessionManager;
  private toolRegistry: ToolRegistry;
  private mcpServer: MCPServer | null = null;
  private mcpClientManager: MCPClientManager;
  private metrics: InMemoryMetrics;
  private costTracker: CostTracker;
  
  private activePipelines: Map<string, VoicePipeline> = new Map();
  private activeConnections: Map<string, WebSocket> = new Map();
  private connectionSessions: Map<string, Set<string>> = new Map();  // connectionId -> sessionIds
  private sessionMcpClients: Map<string, string[]> = new Map();  // sessionId -> MCP client names (for cleanup)
  private telephonyManager: TelephonyManager | null = null;
  private audioCache: AudioCacheService;

  constructor(
    config: APIServerConfig,
    sessionManager: SessionManager,
    logger: Logger
  ) {
    this.config = config;
    this.sessionManager = sessionManager;
    this.logger = logger.child({ component: 'api-server' });
    
    this.app = express();
    this.httpServer = createServer(this.app);
    this.wss = new WebSocketServer({ server: this.httpServer });
    
    this.toolRegistry = new ToolRegistry(this.logger);
    this.mcpClientManager = new MCPClientManager(this.toolRegistry, this.logger);
    this.metrics = new InMemoryMetrics();
    this.costTracker = new CostTracker();
    this.audioCache = new AudioCacheService(this.logger);
    
    this.setupMiddleware();
    this.setupRoutes();
    this.setupWebSocket();
    this.registerBuiltInTools();
    
    if (config.enableMCP && config.mcpConfig) {
      this.setupMCPServer(config.mcpConfig);
    }
    
    // Connect to external MCP servers (async, non-blocking)
    if (config.mcpClients && config.mcpClients.length > 0) {
      this.setupMCPClients(config.mcpClients);
    }
    
    // Initialize telephony if enabled
    if (config.enableTelephony && config.telephonyConfig) {
      this.setupTelephony(config.telephonyConfig);
    }
  }
  
  /**
   * Setup telephony manager and routes
   */
  private async setupTelephony(config: TelephonyManagerConfig): Promise<void> {
    // Add MCP client manager to config for MCP tool support in telephony
    const telephonyConfig = {
      ...config,
      mcpClientManager: this.mcpClientManager
    };
    
    this.telephonyManager = new TelephonyManager(
      telephonyConfig,
      this.sessionManager,
      this.toolRegistry,
      this.logger
    );
    
    await this.telephonyManager.init();
    
    // Add telephony routes
    this.setupTelephonyRoutes();
    
    this.logger.info('Telephony layer initialized', {
      adapters: config.adapters.map(a => a.provider)
    });
  }
  
  /**
   * Setup telephony webhook and stream routes
   */
  private setupTelephonyRoutes(): void {
    // Plivo answer webhook - returns XML to start audio stream
    // Handles both /answer (outbound) and /inbound (inbound calls)
    const handlePlivoAnswer = (req: any, res: any) => {
      this.logger.info('Plivo answer webhook received', { body: req.body, path: req.path });
      
      const adapter = this.telephonyManager?.getAdapter('plivo') as PlivoAdapter;
      if (!adapter) {
        res.status(500).send('Plivo adapter not configured');
        return;
      }
      
      const xml = adapter.handleWebhook('/answer', 'POST', req.body, req.query);
      res.type('application/xml').send(xml);
    };
    
    this.app.post('/telephony/plivo/answer', handlePlivoAnswer);
    this.app.post('/telephony/plivo/inbound', handlePlivoAnswer);
    
    // Plivo status/events callback
    this.app.post('/telephony/plivo/status', (req, res) => {
      this.logger.info('Plivo status webhook', { body: req.body });
      res.json({ success: true });
    });
    
    this.app.post('/telephony/plivo/events', (req, res) => {
      this.logger.info('Plivo events webhook', { body: req.body });
      res.json({ success: true });
    });
    
    // Fallback handler
    this.app.post('/telephony/plivo/fallback', (req, res) => {
      this.logger.warn('Plivo fallback triggered', { body: req.body });
      res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Speak>Sorry, there was an error processing your call. Please try again later.</Speak>
  <Hangup/>
</Response>`);
    });
    
    // Make outbound call
    this.app.post('/api/v1/telephony/call', async (req, res) => {
      try {
        const { provider, to, from } = req.body;
        if (!this.telephonyManager) {
          res.status(500).json({ error: 'Telephony not enabled' });
          return;
        }
        const callId = await this.telephonyManager.makeCall(provider || 'plivo', to, from);
        res.json({ success: true, callId });
      } catch (error) {
        res.status(400).json({ error: (error as Error).message });
      }
    });
    
    // End call
    this.app.delete('/api/v1/telephony/call/:callId', async (req, res) => {
      try {
        if (!this.telephonyManager) {
          res.status(500).json({ error: 'Telephony not enabled' });
          return;
        }
        await this.telephonyManager.endCall(req.params.callId);
        res.json({ success: true });
      } catch (error) {
        res.status(400).json({ error: (error as Error).message });
      }
    });
  }
  
  /**
   * Setup MCP client connections to external servers
   */
  private async setupMCPClients(clients: MCPClientConfig[]): Promise<void> {
    for (const clientConfig of clients) {
      try {
        await this.mcpClientManager.addServer(clientConfig);
        this.logger.info('Connected to MCP server', { name: clientConfig.name });
      } catch (error) {
        this.logger.error('Failed to connect to MCP server', { 
          name: clientConfig.name, 
          error: (error as Error).message 
        });
      }
    }
  }

  private setupMiddleware(): void {
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true }));
    
    // CORS - allow all origins for development
    this.app.use((req, res, next) => {
      const origin = req.headers.origin;
      if (this.config.corsOrigins.includes('*') || !origin) {
        res.header('Access-Control-Allow-Origin', '*');
      } else if (origin && this.config.corsOrigins.includes(origin)) {
        res.header('Access-Control-Allow-Origin', origin);
      }
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');
      if (req.method === 'OPTIONS') {
        return res.sendStatus(204);
      }
      next();
    });

    // Request logging
    this.app.use((req, res, next) => {
      const startTime = Date.now();
      res.on('finish', () => {
        const duration = Date.now() - startTime;
        this.logger.debug('HTTP request', {
          method: req.method,
          path: req.path,
          status: res.statusCode,
          duration
        });
        this.metrics.recordLatency('http_request', duration, { 
          method: req.method, 
          path: req.path 
        });
      });
      next();
    });
  }

  private setupRoutes(): void {
    // Health check
    this.app.get('/health', (req, res) => {
      res.json({ 
        status: 'healthy',
        timestamp: new Date().toISOString(),
        version: '1.0.0'
      });
    });

    // Serve test client
    this.app.get('/test', (req, res) => {
      res.sendFile('test-client.html', { root: './test' });
    });

    // Metrics endpoint
    this.app.get('/metrics', this.authenticateRequest.bind(this), (req, res) => {
      res.json(this.metrics.getStats());
    });

    // Session management
    this.app.post('/api/v1/sessions', 
      this.authenticateRequest.bind(this), 
      this.createSession.bind(this)
    );
    
    this.app.get('/api/v1/sessions/:sessionId', 
      this.authenticateRequest.bind(this), 
      this.getSession.bind(this)
    );
    
    this.app.delete('/api/v1/sessions/:sessionId', 
      this.authenticateRequest.bind(this), 
      this.endSession.bind(this)
    );

    // Tool management
    this.app.get('/api/v1/tools', 
      this.authenticateRequest.bind(this), 
      (req, res) => {
        res.json({ tools: this.toolRegistry.getDefinitions() });
      }
    );

    // MCP Server endpoint (for external clients connecting to us)
    if (this.config.enableMCP) {
      this.app.post('/api/v1/mcp', 
        this.authenticateRequest.bind(this), 
        this.handleMCPRequest.bind(this)
      );
    }
    
    // MCP Client management (for us connecting to external MCP servers)
    this.app.get('/api/v1/mcp/clients', 
      this.authenticateRequest.bind(this),
      (req, res) => {
        res.json({ clients: this.mcpClientManager.getStatus() });
      }
    );
    
    this.app.post('/api/v1/mcp/clients',
      this.authenticateRequest.bind(this),
      async (req, res) => {
        try {
          const config = req.body as MCPClientConfig;
          await this.mcpClientManager.addServer(config);
          res.json({ success: true, message: `Connected to MCP server: ${config.name}` });
        } catch (error) {
          res.status(400).json({ success: false, error: (error as Error).message });
        }
      }
    );
    
    this.app.delete('/api/v1/mcp/clients/:name',
      this.authenticateRequest.bind(this),
      async (req, res) => {
        try {
          await this.mcpClientManager.removeServer(req.params.name);
          res.json({ success: true, message: `Disconnected from MCP server: ${req.params.name}` });
        } catch (error) {
          res.status(400).json({ success: false, error: (error as Error).message });
        }
      }
    );
    
    this.app.post('/api/v1/mcp/clients/:name/refresh',
      this.authenticateRequest.bind(this),
      async (req, res) => {
        try {
          const client = this.mcpClientManager.getClient(req.params.name);
          if (!client) {
            res.status(404).json({ success: false, error: 'MCP client not found' });
            return;
          }
          await client.refreshTools();
          const tools = client.getTools();
          res.json({ success: true, tools: tools.map((t: { name: string }) => t.name) });
        } catch (error) {
          res.status(400).json({ success: false, error: (error as Error).message });
        }
      }
    );

    // Error handler
    this.app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
      this.logger.error('Unhandled error', { 
        error: err.message, 
        stack: err.stack 
      });
      res.status(500).json({ error: 'Internal server error' });
    });
  }

  private setupWebSocket(): void {
    this.wss.on('connection', (ws: WebSocket, req) => {
      const connectionId = uuidv4();
      const url = req.url || '';
      
      // Check if this is a Plivo stream connection
      if (url.includes('/telephony/plivo/stream')) {
        this.handlePlivoStreamConnection(ws, req);
        return;
      }
      
      this.activeConnections.set(connectionId, ws);
      
      this.logger.info('WebSocket connected', { connectionId });

      ws.on('message', async (data: Buffer) => {
        try {
          await this.handleWebSocketMessage(connectionId, ws, data);
        } catch (error) {
          this.logger.error('WebSocket message error', { 
            connectionId, 
            error: (error as Error).message 
          });
          ws.send(JSON.stringify({ 
            type: 'error', 
            error: (error as Error).message 
          }));
        }
      });

      ws.on('close', () => {
        this.handleWebSocketClose(connectionId);
      });

      ws.on('error', (error) => {
        this.logger.error('WebSocket error', { connectionId, error: error.message });
      });

      // Send connection acknowledgment
      ws.send(JSON.stringify({ 
        type: 'connected', 
        connectionId 
      }));
    });
  }

  private async handleWebSocketMessage(
    connectionId: string, 
    ws: WebSocket, 
    data: Buffer
  ): Promise<void> {
    // Check if binary audio data or JSON message
    try {
      const message = JSON.parse(data.toString());
      await this.handleControlMessage(connectionId, ws, message);
    } catch {
      // Binary audio data - forward to pipeline
      const pipeline = this.findPipelineForConnection(connectionId);
      if (pipeline) {
        pipeline.processAudioChunk(data);
      }
    }
  }

  private async handleControlMessage(
    connectionId: string, 
    ws: WebSocket, 
    message: any
  ): Promise<void> {
    switch (message.type) {
      case 'start_session':
        await this.handleStartSession(connectionId, ws, message);
        break;
        
      case 'end_session':
        await this.handleEndSession(connectionId, message.sessionId);
        break;
        
      case 'audio':
        // Base64 encoded audio in JSON
        if (message.data) {
          const audioBuffer = Buffer.from(message.data, 'base64');
          const pipeline = this.findPipelineForConnection(connectionId);
          if (pipeline) {
            pipeline.processAudioChunk(audioBuffer);
          }
        }
        break;
        
      case 'barge_in':
        // Client detected user speaking during AI audio playback
        this.logger.info('Barge-in received from client', { sessionId: message.sessionId });
        const pipeline = this.activePipelines.get(message.sessionId);
        if (pipeline) {
          pipeline.handleBargeIn();
        }
        break;
      
      case 'add_mcp_server':
        // Add MCP server connection dynamically
        await this.handleAddMCPServer(ws, message);
        break;
        
      case 'remove_mcp_server':
        // Remove MCP server connection
        await this.handleRemoveMCPServer(ws, message);
        break;
        
      case 'list_tools':
        // List all registered tools
        ws.send(JSON.stringify({
          type: 'tools_list',
          tools: this.toolRegistry.getDefinitions()
        }));
        break;
        
      default:
        this.logger.warn('Unknown message type', { type: message.type });
    }
  }
  
  private async handleAddMCPServer(ws: WebSocket, message: any): Promise<void> {
    try {
      const config: MCPClientConfig = {
        name: message.name,
        transport: message.transport || 'sse',  // Default to SSE for n8n MCP
        url: message.url,
        apiKey: message.apiKey,
        timeout: message.timeout || 30000
      };
      
      await this.mcpClientManager.addServer(config);
      const client = this.mcpClientManager.getClient(config.name);
      const tools = client?.getTools() || [];
      
      ws.send(JSON.stringify({
        type: 'mcp_server_added',
        name: config.name,
        tools: tools.map(t => ({ name: t.name, description: t.description }))
      }));
      
      this.logger.info('MCP server added via WebSocket', { name: config.name, toolCount: tools.length });
    } catch (error) {
      ws.send(JSON.stringify({
        type: 'mcp_error',
        error: (error as Error).message
      }));
    }
  }
  
  private async handleRemoveMCPServer(ws: WebSocket, message: any): Promise<void> {
    try {
      await this.mcpClientManager.removeServer(message.name);
      ws.send(JSON.stringify({
        type: 'mcp_server_removed',
        name: message.name
      }));
    } catch (error) {
      ws.send(JSON.stringify({
        type: 'mcp_error',
        error: (error as Error).message
      }));
    }
  }

  private async handleStartSession(
    connectionId: string, 
    ws: WebSocket, 
    message: any
  ): Promise<void> {
    this.logger.info('=== handleStartSession ENTRY ===', { connectionId });
    
    const { tenantId, config } = message;
    const agentId = config.agentId; // Agent ID from client config

    // Normalize LLM provider type FIRST - map variants to base provider
    // This must happen before API key selection so we know which key to use
    let llmProviderType = config.llm?.provider || 'gemini';
    if (llmProviderType.startsWith('gemini')) {
      llmProviderType = 'gemini';
    } else if (llmProviderType.startsWith('gpt') || llmProviderType.startsWith('openai')) {
      llmProviderType = 'openai';
    } else if (llmProviderType.startsWith('cerebras')) {
      llmProviderType = 'cerebras';
    } else if (llmProviderType.startsWith('claude') || llmProviderType.startsWith('anthropic')) {
      llmProviderType = 'anthropic';
    } else if (llmProviderType.startsWith('groq')) {
      llmProviderType = 'groq';
    }

    // Resolve API keys: use client-provided or fall back to environment variables
    // IMPORTANT: Select the correct API key based on the provider type
    const sttApiKey = config.stt?.apiKey || process.env.SARVAM_API_KEY || '';
    
    // LLM API key - select based on provider type (not generic fallback)
    let llmApiKey = config.llm?.apiKey || '';
    if (!llmApiKey) {
      switch (llmProviderType) {
        case 'cerebras':
          llmApiKey = process.env.CEREBRAS_API_KEY || '';
          break;
        case 'openai':
          llmApiKey = process.env.OPENAI_API_KEY || '';
          break;
        case 'anthropic':
          llmApiKey = process.env.ANTHROPIC_API_KEY || '';
          break;
        case 'groq':
          llmApiKey = process.env.GROQ_API_KEY || '';
          break;
        case 'gemini':
        default:
          llmApiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || '';
          break;
      }
    }
    
    // TTS API key depends on provider
    const ttsProviderType = config.tts?.provider || 'sarvam';
    const ttsApiKey = config.tts?.apiKey || 
      (ttsProviderType === 'cartesia' ? process.env.CARTESIA_API_KEY : process.env.SARVAM_API_KEY) || '';

    // Log API key resolution for debugging (only shows if keys are present, not the actual keys)
    this.logger.info('API keys resolved', {
      stt: sttApiKey ? 'present' : 'MISSING',
      llm: llmApiKey ? 'present' : 'MISSING', 
      llmProvider: llmProviderType,
      tts: ttsApiKey ? 'present' : 'MISSING',
      source: {
        stt: config.stt?.apiKey ? 'client' : 'env',
        llm: config.llm?.apiKey ? 'client' : 'env',
        tts: config.tts?.apiKey ? 'client' : 'env'
      }
    });

    // Validate required API keys
    if (!llmApiKey) {
      throw new Error(`LLM API key not configured for ${llmProviderType}. Set ${llmProviderType.toUpperCase()}_API_KEY in environment.`);
    }
    if (!sttApiKey) {
      throw new Error('STT API key not configured. Set SARVAM_API_KEY in environment.');
    }

    // Create provider configs from dynamic credentials
    // STT language: always use 'unknown' for multi-language auto-detect (Sarvam supports this)
    // TTS language: must be specific (e.g., 'en-IN') - Sarvam TTS doesn't support 'unknown'
    const sttConfig: STTConfig = {
      type: config.stt?.provider || 'sarvam',
      credentials: { apiKey: sttApiKey },
      language: config.stt?.config?.language || 'unknown', // Use explicit STT config language or default to 'unknown'
      sampleRateHertz: config.sampleRate || 16000
    };
    
    // Build merged system prompt: behavioral prompt + TTS-specific guidelines
    const mergedSystemPrompt = buildSystemPrompt(
      config.systemPrompt || '',
      ttsProviderType
    );
    
    // Set default model based on provider type
    let defaultModel = 'gemini-2.5-flash';
    if (llmProviderType === 'cerebras') {
      defaultModel = 'qwen-3-235b-a22b-instruct-2507';  // Supports tool calling
    } else if (llmProviderType === 'openai') {
      defaultModel = 'gpt-4o-mini';
    } else if (llmProviderType === 'anthropic') {
      defaultModel = 'claude-3-5-sonnet-20241022';
    } else if (llmProviderType === 'groq') {
      defaultModel = 'meta-llama/llama-4-scout-17b-16e-instruct';  // Ultra-fast with tool calling
    }
    
    const llmConfig: LLMConfig = {
      type: llmProviderType,
      credentials: { apiKey: llmApiKey },
      model: config.llm?.model || defaultModel,
      systemPrompt: mergedSystemPrompt,
      temperature: config.llm?.temperature ?? 0.7
    };

    const ttsConfig: any = {
      type: ttsProviderType,
      credentials: { apiKey: ttsApiKey },
      voice: {
        voiceId: config.tts?.voiceId || 'anushka',
        language: config.tts?.language || config.language || 'en-IN',
        gender: config.tts?.gender || 'female'
      },
      audioQuality: config.tts?.audioQuality || 'web'  // 'web' or 'telephony' for Cartesia
    };

    // LATENCY OPTIMIZATION: Parallelize independent database queries
    // This reduces session setup time by ~300ms
    let agentTools: any[] = [];
    let toolConfigs: any[] = [];
    let session: any;
    let organizationId: string | undefined;
    let callRecord: any;

    if (agentId) {
      try {
        const supabaseUrl = process.env.SUPABASE_URL;
        const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        
        if (supabaseUrl && supabaseKey) {
          const { createClient } = await import('@supabase/supabase-js');
          const supabase = createClient(supabaseUrl, supabaseKey);
          
          // Parallelize all independent database queries
          const [toolsResult, configsResult, orgIdResult] = await Promise.all([
            supabase.rpc('get_agent_tools', { p_agent_id: agentId }),
            supabase.rpc('get_agent_tools_with_configs', { p_agent_id: agentId }),
            getOrgIdFromAgent(agentId)
          ]);
          
          // Process agent tools
          if (!toolsResult.error && toolsResult.data) {
            agentTools = toolsResult.data;
            this.logger.info('Retrieved agent tools', { 
              agentId, 
              toolCount: agentTools.length 
            });
          }

          // Process tool configurations
          if (!configsResult.error && configsResult.data) {
            toolConfigs = configsResult.data;
            this.logger.info('Retrieved tool configurations', {
              agentId,
              configCount: toolConfigs.length
            });
          }

          // Process organization ID
          organizationId = orgIdResult || undefined;
        }
      } catch (error) {
        this.logger.warn('Failed to retrieve agent data', {
          agentId,
          error: (error as Error).message
        });
      }
    }

    // Parallelize session creation and call record creation
    // Session creation is needed first for sessionId, but we can prepare the call record immediately after
    session = await this.sessionManager.createSession({
      tenantId,
      callerId: connectionId,
      sttConfig,
      llmConfig,
      ttsConfig,
      systemPrompt: mergedSystemPrompt,
      context: config.context || {}
    });

    // Create call record (non-blocking for session setup)
    callRecord = await createCallRecord({
      organizationId,
      agentId,
      sessionId: session.sessionId,
      direction: 'web',
      sttProvider: sttConfig.type,
      ttsProvider: ttsConfig.type,
      llmProvider: llmConfig.type,
      metadata: {
        connectionId,
        tenantId,
        userAgent: config.context?.userAgent
      }
    });

    if (callRecord) {
      this.logger.info('Call record created for web session', {
        callId: callRecord.id,
        sessionId: session.sessionId
      });
    }

    this.logger.info('Creating providers', { sessionId: session.sessionId });

    // Create providers
    this.logger.info('Creating STT provider', { type: sttConfig.type });
    const sttProvider = STTProviderFactory.create(sttConfig, this.logger);
    this.logger.info('STT provider created');
    
    this.logger.info('Creating LLM provider', { type: llmConfig.type });
    const llmProvider = LLMProviderFactory.create(llmConfig, this.logger);
    this.logger.info('LLM provider created');
    
    this.logger.info('Creating TTS provider', { type: ttsConfig.type });
    const ttsProvider = TTSProviderFactory.create(ttsConfig, this.logger);
    this.logger.info('TTS provider created');

    this.logger.info('Providers created', { sessionId: session.sessionId });

    // Build latency optimization config from client request
    const latencyConfig: LatencyOptimizationConfig = this.buildLatencyConfig(config.latencyOptimization);

    // Audio cache is now initialized globally on server startup
    // Skip per-session initialization for better latency
    if (latencyConfig.audioCaching.enabled && !this.audioCache.isReady()) {
      this.logger.debug('Audio cache not ready, will initialize on demand');
    }

    // Create a NEW tool registry for this session (don't use shared global registry)
    // This ensures only agent-specific tools are loaded, not all built-in tools
    const sessionToolRegistry = new ToolRegistry(this.logger);

    // Log all tool types for debugging
    this.logger.info('Agent tools by type', {
      sessionId: session.sessionId,
      toolTypes: agentTools.map((t: any) => ({ name: t.tool_name, type: t.tool_type }))
    });

    // Register function and api_request tools from agent configuration
    const httpTools = agentTools.filter((t: any) => 
      t.tool_type === 'function' || t.tool_type === 'api_request'
    );
    this.logger.info('HTTP tools found', { count: httpTools.length });
    
    for (const tool of httpTools) {
      try {
        const toolConfig = tool.tool_config || {};
        
        // Log tool config for debugging
        this.logger.info('HTTP tool config', {
          sessionId: session.sessionId,
          toolName: tool.tool_name,
          toolConfig: JSON.stringify(toolConfig)
        });
        
        // Determine URL from various possible field names
        const url = toolConfig.server_url || toolConfig.endpoint_url || 
                    toolConfig.function_server_url || toolConfig.url;
        
        if (!url) {
          this.logger.warn('HTTP tool missing URL', {
            sessionId: session.sessionId,
            toolName: tool.tool_name,
            availableFields: Object.keys(toolConfig)
          });
          continue;
        }
        
        sessionToolRegistry.register({
          definition: {
            name: tool.tool_slug,
            description: tool.tool_description || tool.tool_name,
            parameters: toolConfig.parameters || { type: 'object', properties: {} }
          },
          handler: async (params: any) => {
            // Build request headers
            const headers: Record<string, string> = {
              'Content-Type': 'application/json',
              ...toolConfig.headers
            };
            
            // Handle authentication
            if (toolConfig.auth_config) {
              const auth = toolConfig.auth_config;
              if (auth.type === 'bearer' && auth.token) {
                headers['Authorization'] = `Bearer ${auth.token}`;
              } else if (auth.type === 'api_key' && auth.key) {
                headers[auth.header_name || 'X-API-Key'] = auth.key;
              } else if (auth.type === 'basic' && auth.username && auth.password) {
                const credentials = Buffer.from(`${auth.username}:${auth.password}`).toString('base64');
                headers['Authorization'] = `Basic ${credentials}`;
              }
            }
            
            // Call the API endpoint
            const response = await fetch(url, {
              method: toolConfig.method || 'GET',
              headers,
              ...(toolConfig.method !== 'GET' && toolConfig.method !== 'HEAD' ? {
                body: JSON.stringify(toolConfig.body_template ? 
                  this.interpolateBody(toolConfig.body_template, params) : 
                  params
                )
              } : {}),
              signal: AbortSignal.timeout(toolConfig.timeout_ms || 30000)
            });

            if (!response.ok) {
              throw new Error(`API request failed: ${response.status} ${response.statusText}`);
            }

            const result: any = await response.json();
            return result;
          }
        });
        
        this.logger.info('Registered agent HTTP tool', {
          sessionId: session.sessionId,
          agentId,
          toolName: tool.tool_name,
          toolSlug: tool.tool_slug,
          toolType: tool.tool_type
        });
      } catch (error) {
        this.logger.warn('Failed to register agent HTTP tool', {
          sessionId: session.sessionId,
          agentId,
          toolName: tool.tool_name,
          error: (error as Error).message
        });
      }
    }

    // Register builtin tools from agent configuration
    const builtinTools = agentTools.filter((t: any) => t.tool_type === 'builtin');
    for (const tool of builtinTools) {
      try {
        const toolConfig = tool.tool_config || {};
        const builtinType = toolConfig.builtin_type || tool.tool_slug;
        
        // Handle different builtin tool types
        if (builtinType === 'end_call' || tool.tool_name === 'End Call') {
          sessionToolRegistry.register({
            definition: {
              name: 'end_call',
              description: tool.tool_description || 'End the current call',
              parameters: { type: 'object', properties: {} }
            },
            handler: async () => {
              // Signal to end the call
              this.logger.info('End call tool invoked', { sessionId: session.sessionId });
              return { action: 'end_call', message: 'Call ended by agent' };
            }
          });
          
          this.logger.info('Registered builtin tool', {
            sessionId: session.sessionId,
            toolName: 'end_call'
          });
        }
        // Add more builtin tool handlers here as needed
      } catch (error) {
        this.logger.warn('Failed to register builtin tool', {
          sessionId: session.sessionId,
          toolName: tool.tool_name,
          error: (error as Error).message
        });
      }
    }

    // Create pipeline with session-specific tool registry
    const pipeline = new VoicePipeline(
      session,
      sttProvider,
      llmProvider,
      ttsProvider,
      sessionToolRegistry,
      this.logger,
      { latencyOptimization: latencyConfig },
      this.audioCache
    );

    // Set up pipeline events
    this.setupPipelineEvents(pipeline, ws, session.sessionId);

    this.logger.info('Pipeline created, cleaning up old sessions', { sessionId: session.sessionId });

    // Clean up any existing sessions for this connection before creating new one
    await this.cleanupConnectionSessions(connectionId);

    this.logger.info('Old sessions cleaned up, connecting MCP tools', { sessionId: session.sessionId });

    // Connect to MCP tools from agent configuration - PARALLELIZED for speed
    const connectedMcpClients: string[] = [];
    const mcpTools = agentTools.filter((t: any) => t.tool_type === 'mcp');
    
    // Build all MCP connection promises
    const mcpConnectionPromises: Promise<{ name: string; success: boolean; toolName: string }>[] = [];
    
    for (const tool of mcpTools) {
      const toolConfig = tool.tool_config || {};
      const clientName = `agent_${agentId}_${tool.tool_slug}_${session.sessionId.slice(0, 8)}`;
      
      // Get configurations for this specific MCP tool
      const mcpToolConfigs = toolConfigs
        .filter(c => c.tool_id === tool.tool_id)
        .map(c => ({
          mcp_function_name: c.mcp_function_name,
          enabled: c.enabled,
          custom_name: c.custom_name
        }));

      this.logger.info('MCP tool configurations', {
        toolId: tool.tool_id,
        toolName: tool.tool_name,
        configCount: mcpToolConfigs.length,
        configs: mcpToolConfigs
      });
      
      const connectionPromise = this.mcpClientManager.addServer({
        name: clientName,
        transport: toolConfig.transport || 'sse',
        url: toolConfig.server_url,
        apiKey: toolConfig.auth_config?.token || toolConfig.auth_config?.key,
        timeout: toolConfig.timeout_ms || 30000,
        toolConfigs: mcpToolConfigs.length > 0 ? mcpToolConfigs : undefined
      }, sessionToolRegistry, session.sessionId).then(() => ({ name: clientName, success: true, toolName: tool.tool_name }))
        .catch((error: Error) => {
          this.logger.warn('Failed to connect to agent MCP tool', {
            sessionId: session.sessionId,
            agentId,
            toolName: tool.tool_name,
            error: error.message
          });
          return { name: clientName, success: false, toolName: tool.tool_name };
        });
      
      mcpConnectionPromises.push(connectionPromise);
    }
    
    // Connect to per-session MCP workflows if specified (legacy support)
    // config.mcpWorkflows can be an array of { name, url, apiKey? } objects
    if (config.mcpWorkflows && Array.isArray(config.mcpWorkflows)) {
      for (const workflow of config.mcpWorkflows) {
        if (workflow.url) {
          const clientName = `${workflow.name || 'n8n'}_${session.sessionId.slice(0, 8)}`;
          
          const connectionPromise = this.mcpClientManager.addServer({
            name: clientName,
            transport: 'sse',
            url: workflow.url,
            apiKey: workflow.apiKey,
            timeout: 30000
          }, sessionToolRegistry, session.sessionId).then(() => ({ name: clientName, success: true, toolName: workflow.name || 'n8n' }))
            .catch((error: Error) => {
              this.logger.warn('Failed to connect to MCP workflow', {
                sessionId: session.sessionId,
                workflow: workflow.name,
                error: error.message
              });
              return { name: clientName, success: false, toolName: workflow.name || 'n8n' };
            });
          
          mcpConnectionPromises.push(connectionPromise);
        }
      }
    }
    
    // Wait for all MCP connections in parallel (non-blocking for session start)
    if (mcpConnectionPromises.length > 0) {
      this.logger.info('Waiting for MCP connections', { 
        sessionId: session.sessionId, 
        count: mcpConnectionPromises.length 
      });
      
      try {
        const results = await Promise.all(mcpConnectionPromises);
        this.logger.info('MCP connections completed', { 
          sessionId: session.sessionId, 
          successful: results.filter(r => r.success).length,
          failed: results.filter(r => !r.success).length
        });
        
        for (const result of results) {
          if (result.success) {
            connectedMcpClients.push(result.name);
            this.logger.info('Connected to MCP tool', {
              sessionId: session.sessionId,
              toolName: result.toolName
            });
          }
        }
      } catch (error) {
        this.logger.error('MCP connection error', {
          sessionId: session.sessionId,
          error: (error as Error).message
        });
      }
    }
    
    // Track which MCP clients belong to this session for cleanup
    if (connectedMcpClients.length > 0) {
      this.sessionMcpClients.set(session.sessionId, connectedMcpClients);
    }
    
    // Store and start pipeline
    this.activePipelines.set(session.sessionId, pipeline);
    
    // Track connection -> session mapping
    if (!this.connectionSessions.has(connectionId)) {
      this.connectionSessions.set(connectionId, new Set());
    }
    this.connectionSessions.get(connectionId)!.add(session.sessionId);
    
    this.logger.info('Starting voice pipeline', { sessionId: session.sessionId });
    await pipeline.start();
    this.logger.info('Voice pipeline started successfully', { sessionId: session.sessionId });

    // Update session status
    await this.sessionManager.updateStatus(session.sessionId, 'active');

    // Send audio format info so client can configure playback correctly
    // Sample rate depends on TTS provider:
    // - Cartesia: 44100Hz (web) or 8000Hz (telephony)
    // - Sarvam: 22050Hz
    let sampleRate = 44100;
    if (ttsConfig.type === 'sarvam') {
      sampleRate = 22050;
    } else if (ttsConfig.type === 'cartesia' && ttsConfig.audioQuality === 'telephony') {
      sampleRate = 8000;
    }
    
    const audioFormat = {
      sampleRate,
      bitsPerSample: 16,
      channels: 1,
      encoding: 'pcm_s16le'  // Raw PCM, signed 16-bit little-endian
    };
    
    ws.send(JSON.stringify({
      type: 'session_started',
      sessionId: session.sessionId,
      audioFormat
    }));

    this.logger.info('Voice session started', { 
      sessionId: session.sessionId, 
      tenantId 
    });
  }

  /**
   * Interpolate body template with parameters
   * Replaces {{param}} placeholders with actual values
   */
  private interpolateBody(template: any, params: Record<string, any>): any {
    if (typeof template === 'string') {
      return template.replace(/\{\{(\w+)\}\}/g, (_, key) => params[key] ?? '');
    }
    if (Array.isArray(template)) {
      return template.map(item => this.interpolateBody(item, params));
    }
    if (typeof template === 'object' && template !== null) {
      const result: Record<string, any> = {};
      for (const [key, value] of Object.entries(template)) {
        result[key] = this.interpolateBody(value, params);
      }
      return result;
    }
    return template;
  }

  /**
   * Build latency optimization config from client request
   * Merges client config with defaults, allowing partial overrides
   */
  private buildLatencyConfig(clientConfig?: Partial<LatencyOptimizationConfig>): LatencyOptimizationConfig {
    if (!clientConfig) {
      return DEFAULT_LATENCY_CONFIG;
    }

    return {
      turnDetection: {
        ...DEFAULT_LATENCY_CONFIG.turnDetection,
        ...clientConfig.turnDetection
      },
      fillers: {
        ...DEFAULT_LATENCY_CONFIG.fillers,
        ...clientConfig.fillers
      },
      audioCaching: {
        ...DEFAULT_LATENCY_CONFIG.audioCaching,
        ...clientConfig.audioCaching
      }
    };
  }

  private setupPipelineEvents(
    pipeline: VoicePipeline, 
    ws: WebSocket, 
    sessionId: string
  ): void {
    pipeline.on('stt_partial', (text: string) => {
      ws.send(JSON.stringify({ type: 'stt_partial', sessionId, text }));
    });

    pipeline.on('stt_final', (text: string) => {
      ws.send(JSON.stringify({ type: 'stt_final', sessionId, text }));
    });

    pipeline.on('llm_token', (token: string) => {
      ws.send(JSON.stringify({ type: 'llm_token', sessionId, token }));
    });

    pipeline.on('llm_sentence', (sentence: string) => {
      ws.send(JSON.stringify({ type: 'llm_sentence', sessionId, sentence }));
    });

    pipeline.on('tts_audio_chunk', (chunk: Buffer) => {
      // Send as binary WebSocket frame for efficiency
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(chunk);
      }
    });

    pipeline.on('first_audio_byte', (data: { latencyMs: number }) => {
      ws.send(JSON.stringify({ type: 'first_audio_byte', sessionId, latencyMs: data.latencyMs }));
      this.logger.info('First audio byte sent to client', { sessionId, latencyMs: data.latencyMs });
    });

    pipeline.on('turn_complete', (metrics: any) => {
      ws.send(JSON.stringify({ type: 'turn_complete', sessionId, metrics }));
      this.metrics.recordLatency('turn_e2e', metrics.firstByteLatencyMs, {
        sessionId
      });
    });

    pipeline.on('error', (error: Error) => {
      ws.send(JSON.stringify({ type: 'error', sessionId, error: error.message }));
    });

    pipeline.on('barge_in', () => {
      ws.send(JSON.stringify({ type: 'barge_in', sessionId }));
    });

    pipeline.on('session_end_requested', async (data: { reason?: string }) => {
      this.logger.info('Agent requested call end', { sessionId, reason: data?.reason });
      
      // Send session_ended message to client
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'session_ended',
          sessionId,
          reason: data?.reason || 'Call ended by agent'
        }));
      }
      
      // Clean up pipeline and session
      const pipeline = this.activePipelines.get(sessionId);
      if (pipeline) {
        this.activePipelines.delete(sessionId);
      }
      await this.sessionManager.endSession(sessionId);
      
      // Close WebSocket connection
      if (ws.readyState === WebSocket.OPEN) {
        ws.close(1000, 'Call ended by agent');
      }
    });
  }

  private async handleEndSession(
    connectionId: string, 
    sessionId: string
  ): Promise<void> {
    const pipeline = this.activePipelines.get(sessionId);
    if (pipeline) {
      await pipeline.stop();
      this.activePipelines.delete(sessionId);
    }

    // Clean up session-specific MCP clients
    await this.cleanupSessionMcpClients(sessionId);

    const session = await this.sessionManager.endSession(sessionId);
    
    // End call record in database
    const callRecord = await findCallBySessionId(sessionId);
    if (callRecord) {
      const durationSeconds = session?.metrics ? Math.floor(session.metrics.totalDurationMs / 1000) : 0;
      const firstResponseLatency = session?.metrics?.e2eLatencyMs?.[0] || undefined;
      const avgResponseLatency = session?.metrics?.e2eLatencyMs?.length 
        ? Math.floor(session.metrics.e2eLatencyMs.reduce((a, b) => a + b, 0) / session.metrics.e2eLatencyMs.length)
        : undefined;
      
      await endCallRecord({
        callId: callRecord.id,
        durationSeconds,
        endReason: 'normal',
        llmPromptTokens: session?.metrics?.llmPromptTokens || 0,
        llmCompletionTokens: session?.metrics?.llmCompletionTokens || 0,
        llmCachedTokens: session?.metrics?.llmCachedTokens || 0,
        ttsCharacters: session?.metrics?.ttsCharacters || 0,
        latencyFirstResponseMs: firstResponseLatency,
        latencyAvgResponseMs: avgResponseLatency,
        interruptionsCount: session?.metrics?.interruptionsCount || 0
      });
      
      this.logger.info('Call record ended via end_session', { 
        callId: callRecord.id, 
        sessionId,
        durationSeconds
      });
    }
    
    // Trigger post-call follow-up email (non-blocking)
    this.triggerPostCallFollowUp(sessionId, session).catch(err => {
      this.logger.warn('Post-call follow-up failed', { sessionId, error: err.message });
    });
    
    const ws = this.activeConnections.get(connectionId);
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'session_ended',
        sessionId,
        metrics: session?.metrics
      }));
    }
  }

  /**
   * Clean up MCP clients that were connected for a specific session
   */
  private async cleanupSessionMcpClients(sessionId: string): Promise<void> {
    const clientNames = this.sessionMcpClients.get(sessionId);
    // Use new cleanupSession method for connection pooling
    if (clientNames && clientNames.length > 0) {
      try {
        await this.mcpClientManager.cleanupSession(sessionId);
        this.logger.info('Cleaned up session MCP connections', { sessionId, count: clientNames.length });
      } catch (error) {
        this.logger.warn('Failed to cleanup session MCP connections', {
          sessionId,
          error: (error as Error).message
        });
      }
    } 
    this.sessionMcpClients.delete(sessionId);
  }

  /**
   * Trigger post-call follow-up email for demo enquiries
   * Checks if the session has a pending email and triggers it
   */
  private async triggerPostCallFollowUp(sessionId: string, session: any): Promise<void> {
    // Only process for web-demo tenant (voice demo)
    if (session?.tenantId !== 'web-demo') {
      return;
    }

    try {
      const supabaseUrl = process.env.SUPABASE_URL;
      const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      
      if (!supabaseUrl || !supabaseKey) {
        return; // Supabase not configured
      }

      // Dynamic import to avoid issues if not installed
      const { createClient } = await import('@supabase/supabase-js');
      const supabase = createClient(supabaseUrl, supabaseKey);

      // Get the enquiry for this session
      const { data: enquiry, error } = await supabase
        .from('demo_enquiries')
        .select('*')
        .eq('session_id', sessionId)
        .single();

      if (error || !enquiry) {
        return; // No enquiry found
      }

      // Update call duration
      const callDuration = session?.metrics?.turnDurationMs 
        ? Math.round(session.metrics.turnDurationMs / 1000)
        : null;

      await supabase
        .from('demo_enquiries')
        .update({
          call_duration_seconds: callDuration,
          updated_at: new Date().toISOString()
        })
        .eq('id', enquiry.id);

      // Check if there's a pending email to send
      const pendingEmail = enquiry.metadata?.pending_email;
      if (pendingEmail && enquiry.email && !enquiry.follow_up_email_sent) {
        this.logger.info('Triggering post-call follow-up email', {
          sessionId,
          emailType: pendingEmail.type,
          customerEmail: enquiry.email
        });

        // TODO: Integrate with n8n workflow or direct email service
        // For now, mark as needing email send (batch job can pick this up)
        await supabase
          .from('demo_enquiries')
          .update({
            metadata: {
              ...enquiry.metadata,
              email_ready_to_send: true,
              call_ended_at: new Date().toISOString()
            },
            updated_at: new Date().toISOString()
          })
          .eq('id', enquiry.id);

        this.logger.info('Post-call follow-up queued', {
          sessionId,
          enquiryId: enquiry.id,
          customerEmail: enquiry.email
        });
      }
    } catch (error) {
      this.logger.error('Error in post-call follow-up', {
        sessionId,
        error: (error as Error).message
      });
    }
  }

  private handleWebSocketClose(connectionId: string): void {
    this.activeConnections.delete(connectionId);
    
    // Stop pipelines associated with this connection
    const sessionIds = this.connectionSessions.get(connectionId);
    if (sessionIds) {
      for (const sessionId of sessionIds) {
        const pipeline = this.activePipelines.get(sessionId);
        if (pipeline) {
          pipeline.stop().catch(err => {
            this.logger.error('Error stopping pipeline on disconnect', { 
              sessionId, 
              error: err.message 
            });
          });
          this.activePipelines.delete(sessionId);
        }
        
        // Clean up session-specific MCP clients
        this.cleanupSessionMcpClients(sessionId).catch(() => {});
        
        // End session and update call record in database
        this.endSessionWithCallRecord(sessionId, 'disconnect');
      }
      this.connectionSessions.delete(connectionId);
    }
    
    this.logger.info('WebSocket disconnected', { connectionId });
  }
  
  /**
   * End a session and update the call record in the database
   */
  private async endSessionWithCallRecord(sessionId: string, endReason: string): Promise<void> {
    try {
      const session = await this.sessionManager.endSession(sessionId);
      
      // End call record in database
      const callRecord = await findCallBySessionId(sessionId);
      if (callRecord) {
        const durationSeconds = session?.metrics ? Math.floor(session.metrics.totalDurationMs / 1000) : 0;
        const firstResponseLatency = session?.metrics?.e2eLatencyMs?.[0] || undefined;
        const avgResponseLatency = session?.metrics?.e2eLatencyMs?.length 
          ? Math.floor(session.metrics.e2eLatencyMs.reduce((a, b) => a + b, 0) / session.metrics.e2eLatencyMs.length)
          : undefined;
        
        await endCallRecord({
          callId: callRecord.id,
          durationSeconds,
          endReason,
          llmPromptTokens: session?.metrics?.llmPromptTokens || 0,
          llmCompletionTokens: session?.metrics?.llmCompletionTokens || 0,
          llmCachedTokens: session?.metrics?.llmCachedTokens || 0,
          ttsCharacters: session?.metrics?.ttsCharacters || 0,
          latencyFirstResponseMs: firstResponseLatency,
          latencyAvgResponseMs: avgResponseLatency,
          interruptionsCount: session?.metrics?.interruptionsCount || 0
        });
        
        this.logger.info('Call record ended', { 
          callId: callRecord.id, 
          sessionId,
          durationSeconds,
          endReason
        });
      }
    } catch (err) {
      this.logger.error('Error ending session with call record', { 
        sessionId, 
        error: (err as Error).message 
      });
    }
  }

  /**
   * Clean up existing sessions for a connection before creating a new one
   */
  private async cleanupConnectionSessions(connectionId: string): Promise<void> {
    const sessionIds = this.connectionSessions.get(connectionId);
    if (sessionIds && sessionIds.size > 0) {
      this.logger.info('Cleaning up existing sessions for connection', { 
        connectionId, 
        sessionCount: sessionIds.size 
      });
      
      for (const sessionId of sessionIds) {
        const pipeline = this.activePipelines.get(sessionId);
        if (pipeline) {
          await pipeline.stop().catch(() => {});
          this.activePipelines.delete(sessionId);
        }
        await this.sessionManager.endSession(sessionId).catch(() => {});
      }
      sessionIds.clear();
    }
  }

  private findPipelineForConnection(connectionId: string): VoicePipeline | undefined {
    // Find the active pipeline for this connection
    const sessionIds = this.connectionSessions.get(connectionId);
    if (sessionIds) {
      // Return the most recent session's pipeline (last in set)
      const sessionArray = Array.from(sessionIds);
      const lastSessionId = sessionArray[sessionArray.length - 1];
      if (lastSessionId) {
        return this.activePipelines.get(lastSessionId);
      }
    }
    return undefined;
  }

  private authenticateRequest(req: Request, res: Response, next: NextFunction): void {
    const apiKey = req.headers[this.config.apiKeyHeader.toLowerCase()] as string;
    
    if (!apiKey) {
      res.status(401).json({ error: 'API key required' });
      return;
    }

    // In production, validate against database/secrets manager
    // For now, just check if present
    next();
  }

  private async createSession(req: Request, res: Response): Promise<void> {
    try {
      const options: CreateSessionOptions = req.body;
      const session = await this.sessionManager.createSession(options);
      res.status(201).json({ sessionId: session.sessionId, status: session.status });
    } catch (error) {
      this.logger.error('Failed to create session', { error: (error as Error).message });
      res.status(500).json({ error: (error as Error).message });
    }
  }

  private async getSession(req: Request, res: Response): Promise<void> {
    const { sessionId } = req.params;
    const session = await this.sessionManager.getSession(sessionId);
    
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    
    res.json(session);
  }

  private async endSession(req: Request, res: Response): Promise<void> {
    const { sessionId } = req.params;
    
    const pipeline = this.activePipelines.get(sessionId);
    if (pipeline) {
      await pipeline.stop();
      this.activePipelines.delete(sessionId);
    }
    
    const session = await this.sessionManager.endSession(sessionId);
    
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    
    res.json({ sessionId, status: 'ended', metrics: session.metrics });
  }

  private async handleMCPRequest(req: Request, res: Response): Promise<void> {
    if (!this.mcpServer) {
      res.status(503).json({ error: 'MCP server not enabled' });
      return;
    }

    const response = await this.mcpServer.handleRequest(req.body);
    res.json(response);
  }

  private registerBuiltInTools(): void {
    this.toolRegistry.registerMany(builtInTools);
    this.toolRegistry.registerMany(demoBookingTools);
    this.logger.info('Built-in tools registered', { 
      count: builtInTools.length + demoBookingTools.length,
      demoTools: demoBookingTools.length
    });
  }

  /**
   * Handle Plivo audio stream WebSocket connection
   */
  private handlePlivoStreamConnection(ws: WebSocket, req: any): void {
    this.logger.info('Plivo stream WebSocket connected', { url: req.url });
    
    const adapter = this.telephonyManager?.getAdapter('plivo') as PlivoAdapter;
    if (!adapter) {
      this.logger.error('Plivo adapter not available for stream connection');
      ws.close(1011, 'Plivo adapter not configured');
      return;
    }
    
    // Delegate to Plivo adapter
    adapter.handleStreamConnection(ws);
  }

  private setupMCPServer(config: { name: string; n8nBaseUrl?: string; n8nApiKey?: string }): void {
    this.mcpServer = new MCPServer(
      { name: config.name, url: '' },
      this.toolRegistry,
      this.logger
    );

    // Register n8n workflow tools if configured
    if (config.n8nBaseUrl) {
      const n8nTools = createCommonN8nTools(config.n8nBaseUrl, config.n8nApiKey);
      for (const tool of n8nTools) {
        this.mcpServer.registerN8nWebhook(tool);
      }
      this.logger.info('n8n tools registered', { count: n8nTools.length });
    }
  }

  /**
   * Start the server
   */
  async start(): Promise<void> {
    // LATENCY OPTIMIZATION: Pre-initialize audio cache globally on server startup
    // This eliminates 14+ seconds of cache preload time on first session
    if (this.config.telephonyConfig?.defaultTTSConfig || process.env.SARVAM_API_KEY || process.env.CARTESIA_API_KEY) {
      try {
        this.logger.info('Pre-initializing global audio cache');
        
        // Create a default TTS provider for cache preloading
        const defaultTTSConfig: TTSConfig = this.config.telephonyConfig?.defaultTTSConfig || {
          type: (process.env.CARTESIA_API_KEY ? 'cartesia' : 'sarvam') as any,
          credentials: { 
            apiKey: process.env.CARTESIA_API_KEY || process.env.SARVAM_API_KEY || '' 
          },
          voice: { voiceId: 'anushka', language: 'en-IN' as any, gender: 'female' }
        };
        
        const cacheTTSProvider = TTSProviderFactory.create(defaultTTSConfig, this.logger);
        await cacheTTSProvider.initialize();
        
        // Preload cache with common languages
        await this.audioCache.initialize(cacheTTSProvider, ['en-IN', 'hi-IN']);
        this.logger.info('Global audio cache initialized successfully');
      } catch (error) {
        this.logger.warn('Failed to initialize global audio cache', { 
          error: (error as Error).message 
        });
      }
    }

    return new Promise((resolve) => {
      this.httpServer.listen(this.config.port, this.config.host, () => {
        this.logger.info('API server started', {
          host: this.config.host,
          port: this.config.port,
          mcp: this.config.enableMCP,
          audioCacheReady: this.audioCache.isReady()
        });
        resolve();
      });
    });
  }

  /**
   * Stop the server
   */
  async stop(): Promise<void> {
    // Shutdown telephony manager
    if (this.telephonyManager) {
      await this.telephonyManager.shutdown();
    }
    
    // Stop all active pipelines
    for (const [sessionId, pipeline] of this.activePipelines) {
      await pipeline.stop();
    }
    this.activePipelines.clear();

    // Close all WebSocket connections
    for (const ws of this.activeConnections.values()) {
      ws.close(1000, 'Server shutting down');
    }
    this.activeConnections.clear();

    // Close servers
    this.wss.close();
    
    return new Promise((resolve, reject) => {
      this.httpServer.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
}

export default APIServer;
