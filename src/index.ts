/**
 * AI Voice Calling Backend - Main Entry Point
 * Production-grade voice AI system with pluggable providers
 */

import dotenv from 'dotenv';
dotenv.config();

import { createLogger } from './utils/logger';
import { SessionManager, SessionManagerConfig } from './session/session-manager';
import { APIServer, APIServerConfig } from './server/api-server';

// Import providers to register them
import './providers/stt/sarvam-stt';
import './providers/tts/sarvam-tts';
import './providers/tts/reverie-tts';
import './providers/tts/cartesia-tts';
import './providers/llm/gemini-llm';

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
    mcp: serverConfig.enableMCP
  });
}

main().catch((error) => {
  logger.error('Failed to start server', { error: error.message });
  process.exit(1);
});
