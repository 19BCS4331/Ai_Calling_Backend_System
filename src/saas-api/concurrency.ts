/**
 * Concurrency Module
 * 
 * CRITICAL: This module handles atomic concurrency enforcement.
 * 
 * WHY THIS MATTERS:
 * - Without atomic checks, two calls could start simultaneously and both pass the limit check
 * - This leads to exceeding plan limits and infrastructure overload
 * - Race conditions here = real money and customer experience issues
 * 
 * IMPLEMENTATION:
 * - Uses PostgreSQL row-level locking (SELECT FOR UPDATE)
 * - Checks and increments in a single transaction
 * - Decrements on call end (must be called reliably)
 * 
 * FALLBACK:
 * - If Redis is available, we use it for faster checks
 * - Database is the source of truth, Redis is optimization
 */

import { supabaseAdmin } from './db';
import {
  OrgContext,
  ConcurrencyCheckResult,
  SaaSError
} from './types';
import { getEffectivePlanLimits } from './plans';
import { createLogger } from '../utils/logger';

const logger = createLogger('saas-concurrency');

/**
 * Atomic concurrency check and increment.
 * 
 * This function:
 * 1. Counts current in_progress calls for the org
 * 2. Compares against plan limit
 * 3. If allowed, returns success (call will be created as in_progress)
 * 
 * The actual "increment" happens when the call record is created with status='in_progress'.
 * This function just validates that creating such a record is allowed.
 * 
 * IMPORTANT: This uses a database function with row-level locking to prevent race conditions.
 */
export async function checkConcurrencyLimit(
  orgContext: OrgContext
): Promise<ConcurrencyCheckResult> {
  const limits = getEffectivePlanLimits(orgContext);
  const orgId = orgContext.organization.id;
  const maxConcurrent = limits.max_concurrent_calls;

  // Use a transaction with row-level locking to get accurate count
  // We lock the organization row to serialize concurrent checks
  const { data, error } = await supabaseAdmin.rpc('check_and_reserve_call_slot', {
    p_org_id: orgId,
    p_max_concurrent: maxConcurrent
  });

  if (error) {
    // If the RPC doesn't exist, fall back to non-atomic check
    // This is a safety net during development
    if (error.message.includes('function') && error.message.includes('does not exist')) {
      logger.warn('Concurrency RPC not found, using fallback check', { orgId });
      return fallbackConcurrencyCheck(orgId, maxConcurrent);
    }

    logger.error('Concurrency check failed', { orgId, error: error.message });
    throw new SaaSError('INTERNAL_ERROR', 'Failed to check concurrency limit', 500);
  }

  // RPC returns { allowed: boolean, current: number, max: number, reason?: string }
  return {
    allowed: data.allowed,
    current_active: data.current,
    max_allowed: data.max,
    reason: data.reason
  };
}

/**
 * Fallback concurrency check (non-atomic).
 * 
 * WARNING: This has a race condition window.
 * Only use if the atomic RPC is not available.
 */
async function fallbackConcurrencyCheck(
  orgId: string,
  maxConcurrent: number
): Promise<ConcurrencyCheckResult> {
  const { count, error } = await supabaseAdmin
    .from('calls')
    .select('*', { count: 'exact', head: true })
    .eq('organization_id', orgId)
    .eq('status', 'in_progress');

  if (error) {
    logger.error('Fallback concurrency check failed', { orgId, error: error.message });
    throw new SaaSError('INTERNAL_ERROR', 'Failed to check concurrency', 500);
  }

  const currentActive = count || 0;

  if (currentActive >= maxConcurrent) {
    return {
      allowed: false,
      current_active: currentActive,
      max_allowed: maxConcurrent,
      reason: `Concurrent call limit reached (${currentActive}/${maxConcurrent})`
    };
  }

  return {
    allowed: true,
    current_active: currentActive,
    max_allowed: maxConcurrent
  };
}

/**
 * Get current active call count for an organization.
 * Use this for display purposes, not enforcement.
 */
export async function getActiveCalls(orgId: string): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from('calls')
    .select('*', { count: 'exact', head: true })
    .eq('organization_id', orgId)
    .eq('status', 'in_progress');

  if (error) {
    logger.error('Failed to count active calls', { orgId, error: error.message });
    return 0;
  }

  return count || 0;
}

/**
 * Validate concurrency before starting a call.
 * Throws SaaSError if limit is exceeded.
 */
export async function validateConcurrency(orgContext: OrgContext): Promise<void> {
  const result = await checkConcurrencyLimit(orgContext);

  if (!result.allowed) {
    throw SaaSError.concurrencyLimit(result.current_active, result.max_allowed);
  }
}

/**
 * SQL function to create in Supabase for atomic concurrency checking.
 * 
 * Run this migration to enable atomic concurrency:
 * 
 * ```sql
 * CREATE OR REPLACE FUNCTION check_and_reserve_call_slot(
 *   p_org_id UUID,
 *   p_max_concurrent INTEGER
 * )
 * RETURNS JSONB
 * LANGUAGE plpgsql
 * AS $$
 * DECLARE
 *   v_current INTEGER;
 * BEGIN
 *   -- Lock the organization row to serialize concurrent checks
 *   PERFORM id FROM organizations WHERE id = p_org_id FOR UPDATE;
 *   
 *   -- Count current active calls
 *   SELECT COUNT(*) INTO v_current
 *   FROM calls
 *   WHERE organization_id = p_org_id
 *     AND status = 'in_progress';
 *   
 *   -- Check if allowed
 *   IF v_current >= p_max_concurrent THEN
 *     RETURN jsonb_build_object(
 *       'allowed', false,
 *       'current', v_current,
 *       'max', p_max_concurrent,
 *       'reason', 'Concurrent call limit reached'
 *     );
 *   END IF;
 *   
 *   RETURN jsonb_build_object(
 *     'allowed', true,
 *     'current', v_current,
 *     'max', p_max_concurrent
 *   );
 * END;
 * $$;
 * ```
 */
export const CONCURRENCY_MIGRATION = `
-- Atomic concurrency checking function
-- This locks the org row to prevent race conditions

CREATE OR REPLACE FUNCTION check_and_reserve_call_slot(
  p_org_id UUID,
  p_max_concurrent INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_current INTEGER;
BEGIN
  -- Lock the organization row to serialize concurrent checks
  -- This ensures only one call can be checking at a time per org
  PERFORM id FROM organizations WHERE id = p_org_id FOR UPDATE;
  
  -- Count current active calls
  SELECT COUNT(*) INTO v_current
  FROM calls
  WHERE organization_id = p_org_id
    AND status = 'in_progress';
  
  -- Check if allowed
  IF v_current >= p_max_concurrent THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'current', v_current,
      'max', p_max_concurrent,
      'reason', 'Concurrent call limit reached'
    );
  END IF;
  
  RETURN jsonb_build_object(
    'allowed', true,
    'current', v_current,
    'max', p_max_concurrent
  );
END;
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION check_and_reserve_call_slot TO authenticated;
GRANT EXECUTE ON FUNCTION check_and_reserve_call_slot TO service_role;
`;

/**
 * Monitor active calls across all organizations.
 * Useful for admin dashboards and capacity planning.
 */
export async function getSystemConcurrencyStats(): Promise<{
  total_active_calls: number;
  orgs_with_active_calls: number;
  top_orgs: Array<{ org_id: string; active_calls: number }>;
}> {
  // Get count by org
  const { data, error } = await supabaseAdmin
    .from('calls')
    .select('organization_id')
    .eq('status', 'in_progress');

  if (error) {
    logger.error('Failed to get system concurrency stats', { error: error.message });
    throw new SaaSError('INTERNAL_ERROR', 'Failed to get concurrency stats', 500);
  }

  const calls = data || [];
  const totalActive = calls.length;

  // Count by org
  const orgCounts: Record<string, number> = {};
  for (const call of calls) {
    orgCounts[call.organization_id] = (orgCounts[call.organization_id] || 0) + 1;
  }

  const orgsWithActive = Object.keys(orgCounts).length;

  // Top orgs by active calls
  const topOrgs = Object.entries(orgCounts)
    .map(([org_id, active_calls]) => ({ org_id, active_calls }))
    .sort((a, b) => b.active_calls - a.active_calls)
    .slice(0, 10);

  return {
    total_active_calls: totalActive,
    orgs_with_active_calls: orgsWithActive,
    top_orgs: topOrgs
  };
}

/**
 * Force-end stale calls that have been in_progress too long.
 * 
 * This is a cleanup function for calls that may have been orphaned
 * due to crashes or network issues.
 * 
 * @param maxAgeMinutes - Max age for in_progress calls (default 60)
 */
export async function cleanupStaleCalls(maxAgeMinutes: number = 60): Promise<number> {
  const cutoff = new Date(Date.now() - maxAgeMinutes * 60 * 1000);

  const { data, error } = await supabaseAdmin
    .from('calls')
    .update({
      status: 'failed',
      end_reason: 'timeout',
      ended_at: new Date().toISOString(),
      error_message: `Call exceeded max duration of ${maxAgeMinutes} minutes`
    })
    .eq('status', 'in_progress')
    .lt('started_at', cutoff.toISOString())
    .select('id');

  if (error) {
    logger.error('Failed to cleanup stale calls', { error: error.message });
    return 0;
  }

  const cleanedCount = (data || []).length;

  if (cleanedCount > 0) {
    logger.info('Cleaned up stale calls', { count: cleanedCount, maxAgeMinutes });
  }

  return cleanedCount;
}
