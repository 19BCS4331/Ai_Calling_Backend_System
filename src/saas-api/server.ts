/**
 * SaaS API Server
 * 
 * Standalone Express server for the SaaS REST API.
 * Runs on port 3001 (configurable via SAAS_API_PORT).
 * 
 * This server handles:
 * - Authentication & authorization
 * - Organization management
 * - Agent CRUD
 * - Call management
 * - Usage & billing
 * 
 * The voice pipeline runs on a separate port (8080).
 */

import express, { Express } from 'express';
import cors from 'cors';
import { createSaaSRouter } from './routes';
import { createWebhookRouter } from './payments';
import { createLogger } from '../utils/logger';

const logger = createLogger('saas-server');

export interface SaaSServerConfig {
  port: number;
  corsOrigins?: string[];
}

/**
 * Create and configure the SaaS API Express app.
 */
export function createSaaSApp(config?: Partial<SaaSServerConfig>): Express {
  const app = express();

  // ===========================================
  // Middleware
  // ===========================================

  // CORS configuration
  const corsOptions = {
    origin: config?.corsOrigins || [
      'http://localhost:3000',
      'http://localhost:5173',
      'http://127.0.0.1:3000',
      'http://127.0.0.1:5173'
    ],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Org-Id']
  };
  app.use(cors(corsOptions));

  // Body parsing
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));

  // Request logging
  app.use((req, res, next) => {
    const start = Date.now();
    
    res.on('finish', () => {
      const duration = Date.now() - start;
      
      // Skip health check logs
      if (req.path === '/health') return;
      
      logger.debug('Request completed', {
        method: req.method,
        path: req.path,
        status: res.statusCode,
        duration: `${duration}ms`
      });
    });
    
    next();
  });

  // ===========================================
  // Health Check
  // ===========================================

  app.get('/health', (_req, res) => {
    res.json({
      status: 'healthy',
      service: 'saas-api',
      timestamp: new Date().toISOString()
    });
  });

  // ===========================================
  // Webhook Routes (raw body needed for signature verification)
  // ===========================================

  // Stripe needs raw body for signature verification
  app.use(
    '/webhooks/stripe',
    express.raw({ type: 'application/json' })
  );

  app.use('/webhooks', createWebhookRouter());

  // ===========================================
  // API Routes
  // ===========================================

  app.use('/api/v1', createSaaSRouter());

  // ===========================================
  // 404 Handler
  // ===========================================

  app.use((_req, res) => {
    res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: 'Endpoint not found'
      }
    });
  });

  return app;
}

/**
 * Start the SaaS API server.
 */
export async function startSaaSServer(
  config?: Partial<SaaSServerConfig>
): Promise<Express> {
  const port = config?.port || parseInt(process.env.SAAS_API_PORT || '3001');
  
  const app = createSaaSApp(config);

  return new Promise((resolve) => {
    app.listen(port, () => {
      logger.info(`SaaS API server started`, { port });
      console.log(`🚀 SaaS API running at http://localhost:${port}`);
      console.log(`📚 API docs at http://localhost:${port}/api/v1`);
      resolve(app);
    });
  });
}

export default startSaaSServer;
