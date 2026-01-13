/**
 * API Server
 * Express + WebSocket server for handling voice calls
 */

import express, { Express, Request, Response, NextFunction } from 'express';
import { Server as HTTPServer, createServer } from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import { v4 as uuidv4 } from 'uuid';

import { Logger, CallSession, STTConfig, LLMConfig, TTSConfig } from '../types';
import { SessionManager, CreateSessionOptions } from '../session/session-manager';
import { ToolRegistry, builtInTools } from '../tools/tool-registry';
import { MCPServer, createCommonN8nTools } from '../mcp/mcp-server';
import { MCPClientManager, MCPClientConfig } from '../mcp/mcp-client';
import { VoicePipeline } from '../pipeline/voice-pipeline';
import { STTProviderFactory } from '../providers/base/stt-provider';
import { LLMProviderFactory } from '../providers/base/llm-provider';
import { TTSProviderFactory } from '../providers/base/tts-provider';
import { InMemoryMetrics, CostTracker } from '../utils/logger';

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
    const { tenantId, config } = message;

    // Create provider configs from dynamic credentials
    // Default to en-IN for better English transcription; Hindi speakers still work well
    const sttConfig: STTConfig = {
      type: config.stt?.provider || 'sarvam',
      credentials: { apiKey: config.stt?.apiKey || '' },
      language: config.language || 'en-IN',
      sampleRateHertz: config.sampleRate || 16000
    };

    const llmConfig: LLMConfig = {
      type: config.llm?.provider || 'gemini',
      credentials: { apiKey: config.llm?.apiKey || '' },
      model: config.llm?.model || 'gemini-2.5-flash',
      systemPrompt: config.systemPrompt,
      temperature: config.llm?.temperature ?? 0.7
    };

    const ttsConfig: any = {
      type: config.tts?.provider || 'sarvam',
      credentials: { apiKey: config.tts?.apiKey || '' },
      voice: {
        voiceId: config.tts?.voiceId || 'anushka',
        language: config.language || 'en-IN',
        gender: config.tts?.gender || 'female'
      },
      audioQuality: config.tts?.audioQuality || 'web'  // 'web' or 'telephony' for Cartesia
    };

    // Create session
    const session = await this.sessionManager.createSession({
      tenantId,
      callerId: connectionId,
      sttConfig,
      llmConfig,
      ttsConfig,
      systemPrompt: config.systemPrompt,
      context: config.context || {}
    });

    // Create providers
    const sttProvider = STTProviderFactory.create(sttConfig, this.logger);
    const llmProvider = LLMProviderFactory.create(llmConfig, this.logger);
    const ttsProvider = TTSProviderFactory.create(ttsConfig, this.logger);

    // Create pipeline
    const pipeline = new VoicePipeline(
      session,
      sttProvider,
      llmProvider,
      ttsProvider,
      this.toolRegistry,
      this.logger
    );

    // Set up pipeline events
    this.setupPipelineEvents(pipeline, ws, session.sessionId);

    // Store and start pipeline
    this.activePipelines.set(session.sessionId, pipeline);
    await pipeline.start();

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

    const session = await this.sessionManager.endSession(sessionId);
    
    const ws = this.activeConnections.get(connectionId);
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'session_ended',
        sessionId,
        metrics: session?.metrics
      }));
    }
  }

  private handleWebSocketClose(connectionId: string): void {
    this.activeConnections.delete(connectionId);
    
    // Find and stop any associated pipelines
    for (const [sessionId, pipeline] of this.activePipelines) {
      // This is a simplified check - in production, maintain connection->session mapping
      pipeline.stop().catch(err => {
        this.logger.error('Error stopping pipeline on disconnect', { 
          sessionId, 
          error: err.message 
        });
      });
    }
    
    this.logger.info('WebSocket disconnected', { connectionId });
  }

  private findPipelineForConnection(connectionId: string): VoicePipeline | undefined {
    // In production, maintain proper connection->session mapping
    // For now, return first active pipeline (simplified)
    for (const pipeline of this.activePipelines.values()) {
      return pipeline;
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
    this.logger.info('Built-in tools registered', { count: builtInTools.length });
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
    return new Promise((resolve) => {
      this.httpServer.listen(this.config.port, this.config.host, () => {
        this.logger.info('API server started', {
          host: this.config.host,
          port: this.config.port,
          mcp: this.config.enableMCP
        });
        resolve();
      });
    });
  }

  /**
   * Stop the server
   */
  async stop(): Promise<void> {
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
