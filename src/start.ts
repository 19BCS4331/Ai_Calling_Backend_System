/**
 * VocaCore AI Platform - Unified Entry Point
 * 
 * Starts both the SaaS API and Voice Pipeline servers.
 * 
 * Usage:
 *   npm run start:all     - Start both servers
 *   npm run start:saas    - Start only SaaS API (port 3001)
 *   npm run start:voice   - Start only Voice Pipeline (port 8080)
 * 
 * Environment Variables:
 *   SAAS_API_PORT    - SaaS API port (default: 3001)
 *   VOICE_API_PORT   - Voice Pipeline port (default: 8080)
 *   START_MODE       - 'all' | 'saas' | 'voice' (default: 'all')
 */

import dotenv from 'dotenv';
dotenv.config();

import { createLogger } from './utils/logger';
import { startSaaSServer } from './saas-api';

const logger = createLogger('vocaai-platform');

// Determine what to start
const startMode = process.env.START_MODE || 'all';

async function startSaaSAPI(): Promise<void> {
  const port = parseInt(process.env.SAAS_API_PORT || '3001');
  
  // Parse CORS origins from environment
  const corsOrigins = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',').map(origin => origin.trim())
    : ['http://localhost:3000', 'http://localhost:5173'];
  
  logger.info('Starting SaaS API server...', { port, corsOrigins });
  
  await startSaaSServer({ port, corsOrigins });
  
  logger.info('SaaS API server started', { 
    port,
    endpoints: {
      health: `http://localhost:${port}/health`,
      api: `http://localhost:${port}/api/v1`
    }
  });
}

async function startVoicePipeline(): Promise<void> {
  logger.info('Voice Pipeline should be started via: npm run start:voice');
  logger.info('This runs src/index.ts directly');
}

async function main(): Promise<void> {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║   ██╗   ██╗ ██████╗  ██████╗ █████╗  █████╗ ██╗              ║
║   ██║   ██║██╔═══██╗██╔════╝██╔══██╗██╔══██╗██║              ║
║   ██║   ██║██║   ██║██║     ███████║███████║██║              ║
║   ╚██╗ ██╔╝██║   ██║██║     ██╔══██║██╔══██║██║              ║
║    ╚████╔╝ ╚██████╔╝╚██████╗██║  ██║██║  ██║██║              ║
║     ╚═══╝   ╚═════╝  ╚═════╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝              ║
║                                                              ║
║   AI Voice Calling Platform                                  ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
  `);

  logger.info('Starting VocaCore AI Platform...', { mode: startMode });

  try {
    switch (startMode) {
      case 'saas':
        await startSaaSAPI();
        break;
      
      case 'voice':
        // For voice-only mode, use the existing index.ts entry point
        logger.info('Voice-only mode: Use "npm run start:voice" which runs src/index.ts');
        process.exit(0);
        break;
      
      case 'all':
      default:
        // Start SaaS API
        await startSaaSAPI();
        
        // Note: Voice pipeline should be started separately for now
        // to avoid conflicts with the existing index.ts lifecycle
        logger.info('SaaS API is running. Start voice pipeline separately with: npm run start:voice');
        break;
    }

    // Keep process alive
    logger.info('Platform is running. Press Ctrl+C to stop.');

  } catch (error) {
    logger.error('Failed to start platform', { error: (error as Error).message });
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('Received SIGTERM, shutting down...');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('Received SIGINT, shutting down...');
  process.exit(0);
});

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', { error: error.message, stack: error.stack });
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection', { reason: String(reason) });
  process.exit(1);
});

main();
