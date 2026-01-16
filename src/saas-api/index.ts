/**
 * SaaS API Module Exports
 * 
 * This is the main entry point for the SaaS API layer.
 * Import from this file to use any SaaS functionality.
 * 
 * Usage:
 * ```typescript
 * import { 
 *   authMiddleware, 
 *   orgContextMiddleware,
 *   createAgent,
 *   startCall 
 * } from './saas-api';
 * ```
 */

// ===========================================
// Types
// ===========================================
export * from './types';

// ===========================================
// Database
// ===========================================
export { 
  supabaseAdmin, 
  createUserClient, 
  verifyToken,
  getSupabaseUrl,
  getSupabaseAnonKey
} from './db';

// ===========================================
// Authentication
// ===========================================
export {
  resolveAuthContext,
  authMiddleware,
  optionalAuthMiddleware,
  requireAuth,
  hasAnyOrganization,
  getDefaultOrgId
} from './auth';

// ===========================================
// Organization Context
// ===========================================
export {
  resolveOrgContext,
  orgContextMiddleware,
  requireRole,
  requireActiveSubscription,
  hasRole,
  canPerformAction,
  getUserOrganizations
} from './org-context';

// ===========================================
// Plans
// ===========================================
export {
  getEffectivePlanLimits,
  isProviderAllowed,
  validateProviderSelection,
  isFeatureEnabled,
  requireFeature,
  getAvailablePlans,
  getPlanBySlug,
  getPlanById,
  canAddAgent,
  calculatePlanPrice,
  calculateOverageCost,
  getPlanComparison
} from './plans';

// ===========================================
// Billing
// ===========================================
export {
  getCurrentUsage,
  canUseMinutes,
  calculateBillingPreview,
  getDailyUsage,
  getBillingPeriodSummary,
  isApproachingLimit,
  calculateCallCost
} from './billing';

// ===========================================
// Concurrency
// ===========================================
export {
  checkConcurrencyLimit,
  getActiveCalls as getConcurrentCallCount,
  validateConcurrency,
  getSystemConcurrencyStats,
  cleanupStaleCalls,
  CONCURRENCY_MIGRATION
} from './concurrency';

// ===========================================
// Agents
// ===========================================
export {
  createAgent,
  getAgent,
  getAgentBySlug,
  listAgents,
  updateAgent,
  deleteAgent,
  publishAgent,
  pauseAgent,
  getAgentStats
} from './agents';

// ===========================================
// Calls
// ===========================================
export {
  startCall,
  endCall,
  failCall,
  getCall,
  listCalls,
  getCallTranscript,
  addTranscriptSegment,
  getActiveCalls,
  getCallStats
} from './calls';

// ===========================================
// Usage
// ===========================================
export {
  getUsageOverview,
  getDailyUsageBreakdown,
  getUsageByProvider,
  getUsageRecords,
  getUsageTrends,
  exportUsageData,
  getTopAgentsByUsage
} from './usage';

// ===========================================
// Routes & Server
// ===========================================
export { createSaaSRouter } from './routes';
export { createSaaSApp, startSaaSServer } from './server';
export type { SaaSServerConfig } from './server';

// ===========================================
// Call Bridge (Voice Pipeline Integration)
// ===========================================
export {
  startCallWithValidation,
  endCallWithMetrics,
  generateWebSocketMessage,
  getVoicePipelineUrl
} from './call-bridge';
export type {
  VoiceSessionConfig,
  StartCallBridgeRequest,
  StartCallResult,
  CallMetrics
} from './call-bridge';

// ===========================================
// Payments
// ===========================================
export * from './payments';
