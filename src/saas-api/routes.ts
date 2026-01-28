/**
 * SaaS API Routes
 * 
 * Express router for all SaaS API endpoints.
 * Mount at /api/v1 on your Express app.
 * 
 * Route Structure:
 * - /auth/* - Authentication endpoints
 * - /orgs/* - Organization management
 * - /orgs/:orgId/agents/* - Agent CRUD
 * - /orgs/:orgId/calls/* - Call management
 * - /orgs/:orgId/usage/* - Usage & billing
 * - /plans/* - Public plan information
 */

import { Router, Request, Response, NextFunction } from 'express';
import {
  // Database
  supabaseAdmin,
  
  // Auth
  authMiddleware,
  optionalAuthMiddleware,
  requireAuth,
  getDefaultOrgId,
  
  // Org Context
  orgContextMiddleware,
  requireRole,
  requireActiveSubscription,
  getUserOrganizations,
  
  // Plans
  getAvailablePlans,
  getPlanBySlug,
  getPlanComparison,
  getEffectivePlanLimits,
  
  // Billing
  getCurrentUsage,
  calculateBillingPreview,
  getBillingPeriodSummary,
  isApproachingLimit,
  
  // Agents
  createAgent,
  getAgent,
  getAgentBySlug,
  listAgents,
  updateAgent,
  deleteAgent,
  publishAgent,
  pauseAgent,
  getAgentStats,
  
  // Calls
  startCall,
  endCall,
  failCall,
  getCall,
  listCalls,
  getCallTranscript,
  getActiveCalls,
  getCallStats,
  
  // Usage
  getUsageOverview,
  getDailyUsageBreakdown,
  getUsageByProvider,
  getUsageRecords,
  getUsageTrends,
  exportUsageData,
  getTopAgentsByUsage,
  
  // Types
  SaaSError,
  CreateAgentRequest,
  UpdateAgentRequest,
  StartCallRequest,
  EndCallRequest
} from './index';
import { getPaymentManager, PaymentProvider } from './payments';
import { 
  startCallWithValidation, 
  endCallWithMetrics, 
  generateWebSocketMessage,
  getVoicePipelineUrl,
  StartCallBridgeRequest,
  CallMetrics
} from './call-bridge';
import {
  connectPlivoAccount,
  disconnectPlivoAccount,
  getPlivoConnectionStatus,
  fetchPlivoNumbers,
  getTelephonyCredentials,
  linkNumberToApplication,
  unlinkNumberFromApplication
} from './telephony-integration';
import { createLogger } from '../utils/logger';

const logger = createLogger('saas-routes');

/**
 * Async handler wrapper to catch errors.
 */
function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * Global error handler for SaaS API routes.
 */
function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof SaaSError) {
    res.status(err.statusCode).json(err.toJSON());
    return;
  }

  logger.error('Unhandled error in SaaS API', {
    error: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method
  });

  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred'
    }
  });
}

// ===========================================
// Create Router
// ===========================================

export function createSaaSRouter(): Router {
  const router = Router();

  // ===========================================
  // AUTH ROUTES
  // ===========================================

  /**
   * GET /auth/me
   * Get current user info and organizations
   */
  router.get('/auth/me', authMiddleware, asyncHandler(async (req, res) => {
    const orgs = await getUserOrganizations(req.auth!);
    const defaultOrgId = getDefaultOrgId(req.auth!);

    res.json({
      user: req.auth!.user,
      organizations: orgs,
      default_organization_id: defaultOrgId
    });
  }));

  /**
   * GET /auth/organizations
   * List all organizations user belongs to
   */
  router.get('/auth/organizations', authMiddleware, asyncHandler(async (req, res) => {
    const orgs = await getUserOrganizations(req.auth!);
    res.json({ organizations: orgs });
  }));

  // ===========================================
  // PLANS ROUTES (Public)
  // ===========================================

  /**
   * GET /plans
   * List all available plans (public)
   */
  router.get('/plans', asyncHandler(async (_req, res) => {
    const plans = await getAvailablePlans();
    res.json({ plans });
  }));

  /**
   * GET /plans/compare
   * Get plan comparison data for pricing page
   */
  router.get('/plans/compare', asyncHandler(async (_req, res) => {
    const comparison = await getPlanComparison();
    res.json(comparison);
  }));

  /**
   * GET /plans/:slug
   * Get a specific plan by slug
   */
  router.get('/plans/:slug', asyncHandler(async (req, res) => {
    const plan = await getPlanBySlug(req.params.slug);
    if (!plan) {
      throw SaaSError.notFound('Plan');
    }
    res.json({ plan });
  }));

  // ===========================================
  // ORGANIZATION ROUTES
  // ===========================================

  /**
   * GET /orgs/:orgId
   * Get organization details with subscription & limits
   */
  router.get(
    '/orgs/:orgId',
    authMiddleware,
    orgContextMiddleware('orgId'),
    asyncHandler(async (req, res) => {
      const limits = getEffectivePlanLimits(req.org!);
      
      res.json({
        organization: req.org!.organization,
        subscription: req.org!.subscription,
        plan: req.org!.plan,
        limits,
        membership: {
          role: req.org!.membership.role
        }
      });
    })
  );

  /**
   * GET /orgs/:orgId/dashboard
   * Get dashboard overview data
   */
  router.get(
    '/orgs/:orgId/dashboard',
    authMiddleware,
    orgContextMiddleware('orgId'),
    asyncHandler(async (req, res) => {
      const [usage, limits, approaching, topAgents] = await Promise.all([
        getCurrentUsage(req.org!),
        Promise.resolve(getEffectivePlanLimits(req.org!)),
        isApproachingLimit(req.org!),
        getTopAgentsByUsage(req.org!, 5)
      ]);

      res.json({
        usage,
        limits: {
          included_minutes: limits.included_minutes,
          max_concurrent_calls: limits.max_concurrent_calls,
          overage_rate_cents: limits.overage_rate_cents
        },
        approaching_limit: approaching,
        top_agents: topAgents,
        plan_name: limits.plan_name,
        plan_tier: limits.plan_tier
      });
    })
  );

  // ===========================================
  // AGENT ROUTES
  // ===========================================

  /**
   * GET /orgs/:orgId/agents
   * List all agents
   */
  router.get(
    '/orgs/:orgId/agents',
    authMiddleware,
    orgContextMiddleware('orgId'),
    asyncHandler(async (req, res) => {
      const { page, limit, status } = req.query;
      
      const result = await listAgents(req.org!, {
        page: page ? parseInt(page as string) : undefined,
        limit: limit ? parseInt(limit as string) : undefined,
        status: status as any
      });

      res.json(result);
    })
  );

  /**
   * POST /orgs/:orgId/agents
   * Create a new agent
   */
  router.post(
    '/orgs/:orgId/agents',
    authMiddleware,
    orgContextMiddleware('orgId'),
    requireRole('member'),
    asyncHandler(async (req, res) => {
      const agent = await createAgent(req.org!, req.body as CreateAgentRequest);
      res.status(201).json({ agent });
    })
  );

  /**
   * GET /orgs/:orgId/agents/:agentId
   * Get agent details
   */
  router.get(
    '/orgs/:orgId/agents/:agentId',
    authMiddleware,
    orgContextMiddleware('orgId'),
    asyncHandler(async (req, res) => {
      const agent = await getAgent(req.org!, req.params.agentId);
      res.json({ agent });
    })
  );

  /**
   * GET /orgs/:orgId/agents/by-slug/:slug
   * Get agent by slug
   */
  router.get(
    '/orgs/:orgId/agents/by-slug/:slug',
    authMiddleware,
    orgContextMiddleware('orgId'),
    asyncHandler(async (req, res) => {
      const agent = await getAgentBySlug(req.org!, req.params.slug);
      res.json({ agent });
    })
  );

  /**
   * PATCH /orgs/:orgId/agents/:agentId
   * Update an agent
   */
  router.patch(
    '/orgs/:orgId/agents/:agentId',
    authMiddleware,
    orgContextMiddleware('orgId'),
    requireRole('member'),
    asyncHandler(async (req, res) => {
      const agent = await updateAgent(
        req.org!,
        req.params.agentId,
        req.body as UpdateAgentRequest
      );
      res.json({ agent });
    })
  );

  /**
   * DELETE /orgs/:orgId/agents/:agentId
   * Delete (archive) an agent
   */
  router.delete(
    '/orgs/:orgId/agents/:agentId',
    authMiddleware,
    orgContextMiddleware('orgId'),
    requireRole('admin'),
    asyncHandler(async (req, res) => {
      await deleteAgent(req.org!, req.params.agentId);
      res.status(204).send();
    })
  );

  /**
   * POST /orgs/:orgId/agents/:agentId/publish
   * Publish an agent
   */
  router.post(
    '/orgs/:orgId/agents/:agentId/publish',
    authMiddleware,
    orgContextMiddleware('orgId'),
    requireRole('member'),
    asyncHandler(async (req, res) => {
      const agent = await publishAgent(req.org!, req.params.agentId);
      res.json({ agent });
    })
  );

  /**
   * POST /orgs/:orgId/agents/:agentId/pause
   * Pause an agent
   */
  router.post(
    '/orgs/:orgId/agents/:agentId/pause',
    authMiddleware,
    orgContextMiddleware('orgId'),
    requireRole('member'),
    asyncHandler(async (req, res) => {
      const agent = await pauseAgent(req.org!, req.params.agentId);
      res.json({ agent });
    })
  );

  /**
   * GET /orgs/:orgId/agents/:agentId/stats
   * Get agent statistics
   */
  router.get(
    '/orgs/:orgId/agents/:agentId/stats',
    authMiddleware,
    orgContextMiddleware('orgId'),
    asyncHandler(async (req, res) => {
      const stats = await getAgentStats(req.org!, req.params.agentId);
      res.json({ stats });
    })
  );

  // ===========================================
  // CALL ROUTES
  // ===========================================

  /**
   * GET /orgs/:orgId/calls
   * List calls with filters
   */
  router.get(
    '/orgs/:orgId/calls',
    authMiddleware,
    orgContextMiddleware('orgId'),
    asyncHandler(async (req, res) => {
      const { page, limit, status, direction, agent_id, start_date, end_date } = req.query;
      
      const result = await listCalls(req.org!, {
        page: page ? parseInt(page as string) : undefined,
        limit: limit ? parseInt(limit as string) : undefined,
        status: status as any,
        direction: direction as any,
        agent_id: agent_id as string,
        start_date: start_date as string,
        end_date: end_date as string
      });

      res.json(result);
    })
  );

  /**
   * POST /orgs/:orgId/calls
   * Start a new call (simple - just creates record)
   */
  router.post(
    '/orgs/:orgId/calls',
    authMiddleware,
    orgContextMiddleware('orgId'),
    requireRole('member'),
    asyncHandler(async (req, res) => {
      const call = await startCall(req.org!, req.body as StartCallRequest);
      res.status(201).json({ call });
    })
  );

  /**
   * POST /orgs/:orgId/calls/start-session
   * Start a call with full validation and get voice pipeline session config.
   * 
   * This is the recommended way to start calls from the web app:
   * 1. Call this endpoint to validate and create call record
   * 2. Connect to the WebSocket URL in the response
   * 3. Send the start_session message from the response
   */
  router.post(
    '/orgs/:orgId/calls/start-session',
    authMiddleware,
    orgContextMiddleware('orgId'),
    requireRole('member'),
    asyncHandler(async (req, res) => {
      const result = await startCallWithValidation(
        req.org!,
        req.body as StartCallBridgeRequest
      );

      // Generate the WebSocket message for convenience
      const wsMessage = generateWebSocketMessage(result.session_config);

      res.status(201).json({
        call: result.call,
        session: {
          ...result.session_config,
          websocket_message: wsMessage
        }
      });
    })
  );

  /**
   * GET /orgs/:orgId/calls/active
   * Get currently active calls
   */
  router.get(
    '/orgs/:orgId/calls/active',
    authMiddleware,
    orgContextMiddleware('orgId'),
    asyncHandler(async (req, res) => {
      const calls = await getActiveCalls(req.org!);
      res.json({ calls, count: calls.length });
    })
  );

  /**
   * GET /orgs/:orgId/calls/stats
   * Get call statistics for a time period
   */
  router.get(
    '/orgs/:orgId/calls/stats',
    authMiddleware,
    orgContextMiddleware('orgId'),
    asyncHandler(async (req, res) => {
      const { start_date, end_date } = req.query;
      
      const startDate = start_date 
        ? new Date(start_date as string)
        : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const endDate = end_date
        ? new Date(end_date as string)
        : new Date();

      const stats = await getCallStats(req.org!, startDate, endDate);
      res.json({ stats });
    })
  );

  /**
   * GET /orgs/:orgId/calls/:callId
   * Get call details
   */
  router.get(
    '/orgs/:orgId/calls/:callId',
    authMiddleware,
    orgContextMiddleware('orgId'),
    asyncHandler(async (req, res) => {
      const call = await getCall(req.org!, req.params.callId);
      res.json({ call });
    })
  );

  /**
   * POST /orgs/:orgId/calls/:callId/end
   * End a call (simple)
   */
  router.post(
    '/orgs/:orgId/calls/:callId/end',
    authMiddleware,
    orgContextMiddleware('orgId'),
    asyncHandler(async (req, res) => {
      const call = await endCall(
        req.org!,
        req.params.callId,
        req.body as EndCallRequest
      );
      res.json({ call });
    })
  );

  /**
   * POST /orgs/:orgId/calls/:callId/end-session
   * End a call with full metrics from voice pipeline.
   * 
   * This is the recommended way to end calls started via /start-session.
   * Pass all metrics collected from the voice pipeline session.
   */
  router.post(
    '/orgs/:orgId/calls/:callId/end-session',
    authMiddleware,
    orgContextMiddleware('orgId'),
    asyncHandler(async (req, res) => {
      const call = await endCallWithMetrics(
        req.org!,
        req.params.callId,
        req.body as CallMetrics
      );
      res.json({ call });
    })
  );

  /**
   * POST /orgs/:orgId/calls/:callId/fail
   * Mark a call as failed
   */
  router.post(
    '/orgs/:orgId/calls/:callId/fail',
    authMiddleware,
    orgContextMiddleware('orgId'),
    asyncHandler(async (req, res) => {
      const { error_message, duration_seconds } = req.body;
      const call = await failCall(
        req.org!,
        req.params.callId,
        error_message || 'Unknown error',
        duration_seconds || 0
      );
      res.json({ call });
    })
  );

  /**
   * GET /orgs/:orgId/calls/:callId/transcript
   * Get call transcript
   */
  router.get(
    '/orgs/:orgId/calls/:callId/transcript',
    authMiddleware,
    orgContextMiddleware('orgId'),
    asyncHandler(async (req, res) => {
      const transcript = await getCallTranscript(req.org!, req.params.callId);
      res.json({ transcript });
    })
  );

  // ===========================================
  // USAGE & BILLING ROUTES
  // ===========================================

  /**
   * GET /orgs/:orgId/usage
   * Get usage overview
   */
  router.get(
    '/orgs/:orgId/usage',
    authMiddleware,
    orgContextMiddleware('orgId'),
    asyncHandler(async (req, res) => {
      const overview = await getUsageOverview(req.org!);
      res.json(overview);
    })
  );

  /**
   * GET /orgs/:orgId/usage/daily
   * Get daily usage breakdown
   */
  router.get(
    '/orgs/:orgId/usage/daily',
    authMiddleware,
    orgContextMiddleware('orgId'),
    asyncHandler(async (req, res) => {
      const { days } = req.query;
      const breakdown = await getDailyUsageBreakdown(
        req.org!,
        days ? parseInt(days as string) : 30
      );
      res.json(breakdown);
    })
  );

  /**
   * GET /orgs/:orgId/usage/by-provider
   * Get usage breakdown by provider
   */
  router.get(
    '/orgs/:orgId/usage/by-provider',
    authMiddleware,
    orgContextMiddleware('orgId'),
    asyncHandler(async (req, res) => {
      const { start_date, end_date } = req.query;
      
      const startDate = start_date
        ? new Date(start_date as string)
        : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const endDate = end_date
        ? new Date(end_date as string)
        : new Date();

      const byProvider = await getUsageByProvider(req.org!, startDate, endDate);
      res.json(byProvider);
    })
  );

  /**
   * GET /orgs/:orgId/usage/trends
   * Get usage trends
   */
  router.get(
    '/orgs/:orgId/usage/trends',
    authMiddleware,
    orgContextMiddleware('orgId'),
    asyncHandler(async (req, res) => {
      const { period } = req.query;
      const trends = await getUsageTrends(
        req.org!,
        (period as 'week' | 'month' | 'quarter') || 'month'
      );
      res.json(trends);
    })
  );

  /**
   * GET /orgs/:orgId/usage/records
   * Get detailed usage records
   */
  router.get(
    '/orgs/:orgId/usage/records',
    authMiddleware,
    orgContextMiddleware('orgId'),
    asyncHandler(async (req, res) => {
      const { page, limit, start_date, end_date, usage_type } = req.query;
      
      const records = await getUsageRecords(req.org!, {
        page: page ? parseInt(page as string) : undefined,
        limit: limit ? parseInt(limit as string) : undefined,
        start_date: start_date as string,
        end_date: end_date as string,
        usage_type: usage_type as string
      });

      res.json(records);
    })
  );

  /**
   * GET /orgs/:orgId/usage/export
   * Export usage data as JSON (CSV-ready)
   */
  router.get(
    '/orgs/:orgId/usage/export',
    authMiddleware,
    orgContextMiddleware('orgId'),
    requireRole('admin'),
    asyncHandler(async (req, res) => {
      const { start_date, end_date } = req.query;
      
      const startDate = start_date
        ? new Date(start_date as string)
        : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const endDate = end_date
        ? new Date(end_date as string)
        : new Date();

      const data = await exportUsageData(req.org!, startDate, endDate);
      
      res.setHeader('Content-Type', 'application/json');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="usage-${startDate.toISOString().split('T')[0]}-${endDate.toISOString().split('T')[0]}.json"`
      );
      res.json({ data });
    })
  );

  /**
   * GET /orgs/:orgId/billing
   * Get billing summary
   */
  router.get(
    '/orgs/:orgId/billing',
    authMiddleware,
    orgContextMiddleware('orgId'),
    asyncHandler(async (req, res) => {
      const summary = await getBillingPeriodSummary(req.org!);
      res.json(summary);
    })
  );

  /**
   * GET /orgs/:orgId/billing/preview
   * Get billing preview for current period
   */
  router.get(
    '/orgs/:orgId/billing/preview',
    authMiddleware,
    orgContextMiddleware('orgId'),
    asyncHandler(async (req, res) => {
      const preview = await calculateBillingPreview(req.org!);
      res.json(preview);
    })
  );

  // ===========================================
  // PAYMENT ROUTES
  // ===========================================

  /**
   * GET /payments/providers
   * List available payment providers
   */
  router.get('/payments/providers', (_req, res) => {
    const manager = getPaymentManager();
    res.json({
      providers: manager.getAvailableProviders(),
      default: manager.getDefaultProvider()?.provider || null
    });
  });

  /**
   * POST /orgs/:orgId/payments/checkout
   * Create a checkout session
   */
  router.post(
    '/orgs/:orgId/payments/checkout',
    authMiddleware,
    orgContextMiddleware('orgId'),
    requireRole('admin'),
    asyncHandler(async (req, res) => {
      const { plan_id, billing_interval, success_url, cancel_url, provider } = req.body;

      if (!plan_id || !success_url || !cancel_url) {
        throw SaaSError.validation('Missing required fields: plan_id, success_url, cancel_url');
      }

      const manager = getPaymentManager();
      const session = await manager.createCheckout(
        {
          organization_id: req.org!.organization.id,
          plan_id,
          billing_interval: billing_interval || 'monthly',
          success_url,
          cancel_url,
          customer_email: req.org!.organization.billing_email || req.auth!.user.email
        },
        provider as PaymentProvider
      );

      res.json({ session });
    })
  );

  /**
   * POST /orgs/:orgId/payments/portal
   * Create a customer portal session
   */
  router.post(
    '/orgs/:orgId/payments/portal',
    authMiddleware,
    orgContextMiddleware('orgId'),
    requireRole('admin'),
    asyncHandler(async (req, res) => {
      const { return_url, provider } = req.body;

      if (!return_url) {
        throw SaaSError.validation('Missing required field: return_url');
      }

      // Determine which provider to use based on existing subscription
      const org = req.org!.organization;
      let providerName: PaymentProvider = provider || 'stripe';
      let customerId: string | null = null;

      if (org.stripe_customer_id) {
        providerName = 'stripe';
        customerId = org.stripe_customer_id;
      } else if (org.razorpay_customer_id) {
        providerName = 'razorpay';
        customerId = org.razorpay_customer_id;
      } else if (org.cashfree_customer_id) {
        providerName = 'cashfree';
        customerId = org.cashfree_customer_id;
      }

      if (!customerId) {
        throw SaaSError.validation('No payment customer found for this organization');
      }

      const manager = getPaymentManager();
      const session = await manager.createPortalSession(providerName, customerId, return_url);

      res.json({ session });
    })
  );

  /**
   * POST /orgs/:orgId/payments/cancel
   * Cancel subscription
   */
  router.post(
    '/orgs/:orgId/payments/cancel',
    authMiddleware,
    orgContextMiddleware('orgId'),
    requireRole('owner'),
    asyncHandler(async (req, res) => {
      const { immediately } = req.body;
      const subscription = req.org!.subscription;

      if (!subscription) {
        throw SaaSError.validation('No active subscription found');
      }

      // Determine provider
      let providerName: PaymentProvider | null = null;
      let subscriptionId: string | null = null;

      if (subscription.stripe_subscription_id) {
        providerName = 'stripe';
        subscriptionId = subscription.stripe_subscription_id;
      } else if (subscription.razorpay_subscription_id) {
        providerName = 'razorpay';
        subscriptionId = subscription.razorpay_subscription_id;
      } else if (subscription.cashfree_subscription_id) {
        providerName = 'cashfree';
        subscriptionId = subscription.cashfree_subscription_id;
      }

      if (!providerName || !subscriptionId) {
        throw SaaSError.validation('No payment subscription found');
      }

      const manager = getPaymentManager();
      await manager.cancelSubscription(providerName, subscriptionId, immediately);

      res.json({ success: true, cancel_at_period_end: !immediately });
    })
  );

  // ===========================================
  // TOOLS ROUTES
  // ===========================================

  /**
   * GET /orgs/:orgId/agents/:agentId/tool-configs
   * Get all tool configurations for an agent
   */
  router.get(
    '/orgs/:orgId/agents/:agentId/tool-configs',
    authMiddleware,
    orgContextMiddleware('orgId'),
    asyncHandler(async (req, res) => {
      const { agentId } = req.params;

      const { data, error } = await supabaseAdmin.rpc('get_agent_tools_with_configs', {
        p_agent_id: agentId
      });

      if (error) throw error;

      res.json({ tools: data || [] });
    })
  );

  /**
   * POST /orgs/:orgId/agents/:agentId/tool-configs
   * Update tool configurations for an agent (bulk update)
   */
  router.post(
    '/orgs/:orgId/agents/:agentId/tool-configs',
    authMiddleware,
    orgContextMiddleware('orgId'),
    asyncHandler(async (req, res) => {
      const { agentId } = req.params;
      const { configs } = req.body;

      if (!Array.isArray(configs)) {
        throw SaaSError.validation('configs must be an array');
      }

      const { error } = await supabaseAdmin.rpc('update_agent_tool_configs', {
        p_agent_id: agentId,
        p_organization_id: req.org!.organization.id,
        p_configs: configs
      });

      if (error) throw error;

      res.json({ success: true });
    })
  );

  /**
   * POST /orgs/:orgId/tools/:toolId/discover-functions
   * Discover available functions from an MCP tool
   */
  router.post(
    '/orgs/:orgId/tools/:toolId/discover-functions',
    authMiddleware,
    orgContextMiddleware('orgId'),
    asyncHandler(async (req, res) => {
      const { toolId } = req.params;
      const { agentId } = req.body;

      // Get the tool details
      const { data: tool, error: toolError } = await supabaseAdmin
        .from('tools')
        .select('*')
        .eq('id', toolId)
        .eq('organization_id', req.org!.organization.id)
        .single();

      if (toolError || !tool) {
        throw SaaSError.notFound('Tool not found');
      }

      if (tool.type !== 'mcp') {
        throw SaaSError.validation('Only MCP tools support function discovery');
      }

      // Get existing configurations for this tool and agent
      const { data: configs, error: configError } = await supabaseAdmin
        .from('agent_tool_configs')
        .select('*')
        .eq('tool_id', toolId)
        .eq('agent_id', agentId)
        .order('display_order');

      if (configError) {
        throw configError;
      }

      // Return configurations with function details
      res.json({
        functions: configs || []
      });
    })
  );

  /**
   * POST /orgs/:orgId/tools/validate
   * Validate a tool configuration
   */
  router.post(
    '/orgs/:orgId/tools/validate',
    authMiddleware,
    orgContextMiddleware('orgId'),
    asyncHandler(async (req, res) => {
      const { tool_type, mcp_server_url, function_server_url, mcp_auth_config, function_auth_config, function_headers } = req.body;

      if (!tool_type) {
        throw SaaSError.validation('tool_type is required');
      }

      try {
        if (tool_type === 'mcp' && mcp_server_url) {
          // Validate MCP server connection
          const headers: Record<string, string> = {
            'Accept': 'text/event-stream' // Indicate we accept SSE
          };
          
          // Add auth header if provided
          if (mcp_auth_config?.token) {
            headers['Authorization'] = `Bearer ${mcp_auth_config.token}`;
          } else if (mcp_auth_config?.key) {
            headers['Authorization'] = `Bearer ${mcp_auth_config.key}`;
          }

          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 3000); // Reduced to 3s

          try {
            const response = await fetch(mcp_server_url, {
              method: 'GET',
              headers,
              signal: controller.signal
            });

            clearTimeout(timeoutId);

            // MCP/SSE servers might return various status codes or keep connection open
            // Accept anything except 5xx errors
            if (response.status >= 500) {
              throw new Error(`MCP server error: ${response.status}`);
            }

            res.json({ 
              valid: true, 
              status: response.status,
              message: 'MCP server is reachable'
            });
          } catch (err: any) {
            clearTimeout(timeoutId);
            
            if (err.name === 'AbortError') {
              // For SSE/MCP servers, timeout during connection is actually OK
              // It means the server is listening and waiting for SSE handshake
              res.json({ 
                valid: true, 
                status: 200,
                message: 'MCP server is listening (SSE connection established)'
              });
              return;
            }
            throw err;
          }
        } else if (tool_type === 'api_request' && function_server_url) {
          // Validate API endpoint with HEAD request
          const headers: Record<string, string> = {};

          // Add custom headers if provided
          if (function_headers && typeof function_headers === 'object') {
            Object.assign(headers, function_headers);
          }

          // Add auth header if provided
          if (function_auth_config) {
            if (function_auth_config.type === 'bearer' && function_auth_config.token) {
              headers['Authorization'] = `Bearer ${function_auth_config.token}`;
            } else if (function_auth_config.type === 'api_key') {
              if (function_auth_config.header_name && function_auth_config.api_key) {
                headers[function_auth_config.header_name] = function_auth_config.api_key;
              }
            } else if (function_auth_config.type === 'basic' && function_auth_config.username && function_auth_config.password) {
              const credentials = Buffer.from(`${function_auth_config.username}:${function_auth_config.password}`).toString('base64');
              headers['Authorization'] = `Basic ${credentials}`;
            }
          }

          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 10000);

          try {
            const response = await fetch(function_server_url, {
              method: 'HEAD',
              headers,
              signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok && response.status !== 405) {
              throw new Error(`Server returned ${response.status}`);
            }

            res.json({ 
              valid: true, 
              status: response.status,
              message: 'API endpoint is reachable'
            });
          } catch (err: any) {
            clearTimeout(timeoutId);
            
            if (err.name === 'AbortError') {
              throw new Error('Connection timeout - server took too long to respond');
            }
            throw err;
          }
        } else {
          throw SaaSError.validation('Invalid tool configuration for validation');
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Validation failed';
        res.json({ 
          valid: false, 
          error: errorMessage 
        });
      }
    })
  );

  // ===========================================
  // Provider Integrations
  // ===========================================

  /**
   * GET /providers/test
   * Test endpoint to verify routing
   */
  router.get('/providers/test', (_req, res) => {
    res.json({ message: 'Provider routes are working', timestamp: new Date().toISOString() });
  });

  /**
   * GET /providers/cartesia/voices
   * Fetch available voices from Cartesia API
   */
  router.get(
    '/providers/cartesia/voices',
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = req.auth!.user.id;

      // Get user's organization and Cartesia credentials
      const { data: orgMembers } = await supabaseAdmin
        .from('organization_members')
        .select('organization_id')
        .eq('user_id', userId)
        .limit(1)
        .single();

      if (!orgMembers) {
        throw SaaSError.notFound('Organization not found');
      }

      const { data: credentials } = await supabaseAdmin
        .from('organization_provider_credentials')
        .select('credentials')
        .eq('organization_id', orgMembers.organization_id)
        .eq('provider_slug', 'cartesia')
        .single();

      // Use organization's API key if available, otherwise fall back to environment variable
      const apiKey = credentials?.credentials?.api_key || process.env.CARTESIA_API_KEY;

      if (!apiKey) {
        throw SaaSError.validation('Cartesia API key not configured. Please add CARTESIA_API_KEY to environment variables or configure it in your organization settings.');
      }

      // Fetch voices from Cartesia API
      // Include limit parameter to get more voices, and filter for public voices if available
      const cartesiaResponse = await fetch('https://api.cartesia.ai/voices?limit=100', {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Cartesia-Version': '2024-06-10',
        },
      });

      if (!cartesiaResponse.ok) {
        const errorText = await cartesiaResponse.text();
        console.error('Cartesia API error:', errorText);
        throw new SaaSError(
          'EXTERNAL_API_ERROR',
          `Failed to fetch voices from Cartesia: ${cartesiaResponse.status}`,
          502
        );
      }

      const cartesiaData = await cartesiaResponse.json();
      
      // Cartesia API returns voices as a direct array, not wrapped in a data property
      const voices = Array.isArray(cartesiaData) ? cartesiaData : [];
      
      console.log('Number of voices received:', voices.length);
      
      res.json({
        voices: voices.map((voice: any) => ({
          id: voice.id,
          name: voice.name,
          description: voice.description,
          language: voice.language,
          is_public: voice.is_public,
        })),
        has_more: false,
      });
    })
  );

  // ===========================================
  // TELEPHONY INTEGRATION ROUTES
  // ===========================================

  /**
   * POST /orgs/:orgId/telephony/plivo/connect
   * Connect Plivo account with credentials
   */
  router.post(
    '/orgs/:orgId/telephony/plivo/connect',
    authMiddleware,
    orgContextMiddleware('orgId'),
    requireRole('admin'),
    asyncHandler(async (req, res) => {
      const { authId, authToken } = req.body;

      if (!authId || !authToken) {
        throw SaaSError.validation('authId and authToken are required');
      }

      const webhookBaseUrl = process.env.WEBHOOK_BASE_URL || 
                             process.env.PUBLIC_URL || 
                             `https://${req.get('host')}`;

      const result = await connectPlivoAccount(
        req.org!,
        authId,
        authToken,
        webhookBaseUrl
      );

      res.json(result);
    })
  );

  /**
   * DELETE /orgs/:orgId/telephony/plivo/disconnect
   * Disconnect Plivo account
   */
  router.delete(
    '/orgs/:orgId/telephony/plivo/disconnect',
    authMiddleware,
    orgContextMiddleware('orgId'),
    requireRole('admin'),
    asyncHandler(async (req, res) => {
      await disconnectPlivoAccount(req.org!);
      res.json({ message: 'Plivo account disconnected successfully' });
    })
  );

  /**
   * GET /orgs/:orgId/telephony/plivo/status
   * Get Plivo connection status
   */
  router.get(
    '/orgs/:orgId/telephony/plivo/status',
    authMiddleware,
    orgContextMiddleware('orgId'),
    asyncHandler(async (req, res) => {
      const status = await getPlivoConnectionStatus(req.org!);
      res.json(status);
    })
  );

  // ===========================================
  // PHONE NUMBERS ROUTES
  // ===========================================

  /**
   * GET /orgs/:orgId/phone-numbers
   * List organization's phone numbers
   */
  router.get(
    '/orgs/:orgId/phone-numbers',
    authMiddleware,
    orgContextMiddleware('orgId'),
    asyncHandler(async (req, res) => {
      const { data: phoneNumbers, error } = await supabaseAdmin
        .from('phone_numbers')
        .select(`
          *,
          agent:agents(id, name, slug)
        `)
        .eq('organization_id', req.org!.organization.id)
        .order('created_at', { ascending: false });

      if (error) {
        throw new SaaSError('INTERNAL_ERROR', error.message, 500);
      }

      res.json({ phone_numbers: phoneNumbers || [] });
    })
  );

  /**
   * POST /orgs/:orgId/phone-numbers
   * Manually add a phone number (for providers like TATA that don't have API sync)
   */
  router.post(
    '/orgs/:orgId/phone-numbers',
    authMiddleware,
    orgContextMiddleware('orgId'),
    requireRole('admin'),
    asyncHandler(async (req, res) => {
      const { phone_number, country_code, provider } = req.body;

      if (!phone_number) {
        throw SaaSError.validation('phone_number is required');
      }

      if (!provider || !['plivo', 'tata', 'twilio'].includes(provider)) {
        throw SaaSError.validation('Valid provider is required (plivo, tata, or twilio)');
      }

      // Check if number already exists
      const { data: existingNumber } = await supabaseAdmin
        .from('phone_numbers')
        .select('id')
        .eq('organization_id', req.org!.organization.id)
        .eq('phone_number', phone_number)
        .single();

      if (existingNumber) {
        throw SaaSError.validation('Phone number already exists');
      }

      // Insert new number
      const { data: newNumber, error: insertError } = await supabaseAdmin
        .from('phone_numbers')
        .insert({
          organization_id: req.org!.organization.id,
          phone_number,
          country_code: country_code || 'IN',
          telephony_provider: provider,
          provider_number_id: phone_number,
          capabilities: {
            voice: true,
            sms: false
          },
          monthly_cost_cents: 0,
          is_active: true
        })
        .select()
        .single();

      if (insertError) {
        throw new SaaSError('INTERNAL_ERROR', insertError.message, 500);
      }

      res.json({ phone_number: newNumber });
    })
  );

  /**
   * POST /orgs/:orgId/phone-numbers/sync
   * Sync phone numbers from Plivo
   */
  router.post(
    '/orgs/:orgId/phone-numbers/sync',
    authMiddleware,
    orgContextMiddleware('orgId'),
    requireRole('admin'),
    asyncHandler(async (req, res) => {
      const credentials = await getTelephonyCredentials(
        req.org!.organization.id,
        'plivo'
      );

      if (!credentials) {
        throw SaaSError.validation('Plivo not connected. Please connect your Plivo account first.');
      }

      // Fetch numbers from Plivo
      const plivoNumbers = await fetchPlivoNumbers(
        credentials.authId,
        credentials.authToken
      );

      // Get existing numbers in database
      const { data: existingNumbers } = await supabaseAdmin
        .from('phone_numbers')
        .select('phone_number')
        .eq('organization_id', req.org!.organization.id)
        .eq('telephony_provider', 'plivo');

      const existingNumberSet = new Set(
        (existingNumbers || []).map(n => n.phone_number)
      );

      // Helper function to extract country code from phone number
      const getCountryCodeFromNumber = (phoneNumber: string): string => {
        // Common country code prefixes (1-3 digits)
        const countryCodeMap: Record<string, string> = {
          '1': 'US',    // USA/Canada
          '44': 'GB',   // UK
          '91': 'IN',   // India
          '86': 'CN',   // China
          '81': 'JP',   // Japan
          '49': 'DE',   // Germany
          '33': 'FR',   // France
          '39': 'IT',   // Italy
          '61': 'AU',   // Australia
          '55': 'BR',   // Brazil
          '52': 'MX',   // Mexico
          '7': 'RU',    // Russia
          '82': 'KR',   // South Korea
          '34': 'ES',   // Spain
          '31': 'NL',   // Netherlands
          '46': 'SE',   // Sweden
          '47': 'NO',   // Norway
          '45': 'DK',   // Denmark
          '41': 'CH',   // Switzerland
          '43': 'AT',   // Austria
          '32': 'BE',   // Belgium
          '48': 'PL',   // Poland
          '65': 'SG',   // Singapore
          '60': 'MY',   // Malaysia
          '66': 'TH',   // Thailand
          '84': 'VN',   // Vietnam
          '62': 'ID',   // Indonesia
          '63': 'PH',   // Philippines
          '27': 'ZA',   // South Africa
          '20': 'EG',   // Egypt
          '971': 'AE',  // UAE
          '966': 'SA',  // Saudi Arabia
        };

        // Try 3-digit, then 2-digit, then 1-digit prefixes
        for (let len = 3; len >= 1; len--) {
          const prefix = phoneNumber.substring(0, len);
          if (countryCodeMap[prefix]) {
            return countryCodeMap[prefix];
          }
        }
        
        return 'US'; // Default fallback
      };

      // Insert new numbers
      const numbersToInsert = plivoNumbers
        .filter(n => !existingNumberSet.has(n.number))
        .map(n => ({
          organization_id: req.org!.organization.id,
          phone_number: n.number,
          country_code: n.country_iso || getCountryCodeFromNumber(n.number),
          telephony_provider: 'plivo',
          provider_number_id: n.number,
          capabilities: {
            voice: n.voice_enabled,
            sms: n.sms_enabled
          },
          monthly_cost_cents: Math.round(parseFloat(n.monthly_rental_rate || '0') * 100),
          is_active: true
        }));

      if (numbersToInsert.length > 0) {
        const { error: insertError } = await supabaseAdmin
          .from('phone_numbers')
          .insert(numbersToInsert);

        if (insertError) {
          throw new SaaSError('INTERNAL_ERROR', insertError.message, 500);
        }
      }

      res.json({
        message: `Synced ${numbersToInsert.length} new phone numbers`,
        synced: numbersToInsert.length,
        total: plivoNumbers.length
      });
    })
  );

  /**
   * POST /orgs/:orgId/phone-numbers/:numberId/link
   * Link phone number to agent
   */
  router.post(
    '/orgs/:orgId/phone-numbers/:numberId/link',
    authMiddleware,
    orgContextMiddleware('orgId'),
    requireRole('member'),
    asyncHandler(async (req, res) => {
      const { numberId } = req.params;
      const { agent_id } = req.body;

      if (!agent_id) {
        throw SaaSError.validation('agent_id is required');
      }

      // Verify phone number belongs to org
      const { data: phoneNumber, error: fetchError } = await supabaseAdmin
        .from('phone_numbers')
        .select('*')
        .eq('id', numberId)
        .eq('organization_id', req.org!.organization.id)
        .single();

      if (fetchError || !phoneNumber) {
        throw SaaSError.notFound('Phone number not found');
      }

      // Verify agent belongs to org
      const { data: agent, error: agentError } = await supabaseAdmin
        .from('agents')
        .select('id')
        .eq('id', agent_id)
        .eq('organization_id', req.org!.organization.id)
        .single();

      if (agentError || !agent) {
        throw SaaSError.notFound('Agent not found');
      }

      // Only link via Plivo API if this is a Plivo number
      if (phoneNumber.telephony_provider === 'plivo') {
        // Get Plivo credentials and app ID
        const credentials = await getTelephonyCredentials(
          req.org!.organization.id,
          'plivo'
        );

        const { data: orgData } = await supabaseAdmin
          .from('organizations')
          .select('plivo_app_id')
          .eq('id', req.org!.organization.id)
          .single();

        if (!credentials || !orgData?.plivo_app_id) {
          throw SaaSError.validation('Plivo not properly configured');
        }

        // Link number to Plivo application
        await linkNumberToApplication(
          credentials.authId,
          credentials.authToken,
          phoneNumber.phone_number,
          orgData.plivo_app_id
        );
      }
      // For TATA and other providers, just update the database
      // No external API calls needed

      // Update database
      const { data: updatedNumber, error: updateError } = await supabaseAdmin
        .from('phone_numbers')
        .update({ agent_id })
        .eq('id', numberId)
        .select()
        .single();

      if (updateError) {
        throw new SaaSError('INTERNAL_ERROR', updateError.message, 500);
      }

      res.json({ phone_number: updatedNumber });
    })
  );

  /**
   * DELETE /orgs/:orgId/phone-numbers/:numberId/link
   * Unlink phone number from agent
   */
  router.delete(
    '/orgs/:orgId/phone-numbers/:numberId/link',
    authMiddleware,
    orgContextMiddleware('orgId'),
    requireRole('member'),
    asyncHandler(async (req, res) => {
      const { numberId } = req.params;

      // Verify phone number belongs to org
      const { data: phoneNumber, error: fetchError } = await supabaseAdmin
        .from('phone_numbers')
        .select('*')
        .eq('id', numberId)
        .eq('organization_id', req.org!.organization.id)
        .single();

      if (fetchError || !phoneNumber) {
        throw SaaSError.notFound('Phone number not found');
      }

      // Only unlink via Plivo API if this is a Plivo number
      if (phoneNumber.telephony_provider === 'plivo') {
        // Get Plivo credentials
        const credentials = await getTelephonyCredentials(
          req.org!.organization.id,
          'plivo'
        );

        if (!credentials) {
          throw SaaSError.validation('Plivo not connected');
        }

        // Unlink from Plivo application
        await unlinkNumberFromApplication(
          credentials.authId,
          credentials.authToken,
          phoneNumber.phone_number
        );
      }
      // For TATA and other providers, just update the database
      // No external API calls needed

      // Update database
      const { data: updatedNumber, error: updateError } = await supabaseAdmin
        .from('phone_numbers')
        .update({ agent_id: null })
        .eq('id', numberId)
        .select()
        .single();

      if (updateError) {
        throw new SaaSError('INTERNAL_ERROR', updateError.message, 500);
      }

      res.json({ phone_number: updatedNumber });
    })
  );

  // ===========================================
  // Error Handler
  // ===========================================

  router.use(errorHandler);

  return router;
}

export default createSaaSRouter;
