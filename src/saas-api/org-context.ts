/**
 * Organization Context Module
 * 
 * Resolves and validates organization context for requests.
 * 
 * SECURITY PRINCIPLES:
 * 1. NEVER trust client-provided org_id without validation
 * 2. Always verify user has membership in the requested org
 * 3. Role-based access control is enforced here
 * 4. Cross-org access is impossible through this module
 */

import { Request, Response, NextFunction } from 'express';
import { supabaseAdmin } from './db';
import {
  AuthContext,
  OrgContext,
  Organization,
  OrganizationMember,
  Subscription,
  Plan,
  OrgRole,
  SaaSError
} from './types';
import { createLogger } from '../utils/logger';

const logger = createLogger('saas-org-context');

// Extend Express Request to include org context
declare global {
  namespace Express {
    interface Request {
      org?: OrgContext;
    }
  }
}

/**
 * Role hierarchy for permission checks.
 * Lower number = more permissions.
 */
const ROLE_HIERARCHY: Record<OrgRole, number> = {
  owner: 0,
  admin: 1,
  member: 2,
  viewer: 3
};

/**
 * Check if a role has at least the required permission level.
 */
export function hasRole(userRole: OrgRole, requiredRole: OrgRole): boolean {
  return ROLE_HIERARCHY[userRole] <= ROLE_HIERARCHY[requiredRole];
}

/**
 * Fetch organization by ID.
 */
async function fetchOrganization(orgId: string): Promise<Organization | null> {
  const { data, error } = await supabaseAdmin
    .from('organizations')
    .select('*')
    .eq('id', orgId)
    .single();

  if (error) {
    logger.debug('Organization not found', { orgId, error: error.message });
    return null;
  }

  return data as Organization;
}

/**
 * Fetch active subscription for an organization.
 * Returns null if no active subscription exists.
 */
async function fetchActiveSubscription(orgId: string): Promise<Subscription | null> {
  const { data, error } = await supabaseAdmin
    .from('subscriptions')
    .select('*')
    .eq('organization_id', orgId)
    .in('status', ['active', 'trialing'])
    .single();

  if (error) {
    // No subscription is valid state (free tier or not yet subscribed)
    logger.debug('No active subscription', { orgId });
    return null;
  }

  return data as Subscription;
}

/**
 * Fetch plan by ID.
 */
async function fetchPlan(planId: string): Promise<Plan | null> {
  const { data, error } = await supabaseAdmin
    .from('plans')
    .select('*')
    .eq('id', planId)
    .single();

  if (error) {
    logger.error('Plan not found', { planId, error: error.message });
    return null;
  }

  return data as Plan;
}

/**
 * Fetch the free plan (fallback for orgs without subscription).
 */
async function fetchFreePlan(): Promise<Plan | null> {
  const { data, error } = await supabaseAdmin
    .from('plans')
    .select('*')
    .eq('slug', 'free')
    .single();

  if (error) {
    logger.error('Free plan not found', { error: error.message });
    return null;
  }

  return data as Plan;
}

/**
 * Resolve full organization context.
 * 
 * This function:
 * 1. Validates user has membership in the org
 * 2. Fetches organization details
 * 3. Fetches active subscription (if any)
 * 4. Fetches plan details
 * 
 * @param auth - Authenticated user context
 * @param orgId - Organization ID to resolve
 * @returns Full org context
 * @throws SaaSError if user doesn't have access
 */
export async function resolveOrgContext(
  auth: AuthContext,
  orgId: string
): Promise<OrgContext> {
  // Step 1: Find user's membership in this org
  // CRITICAL: This prevents cross-org access
  const membership = auth.memberships.find(m => m.organization_id === orgId);

  if (!membership) {
    logger.warn('Cross-org access attempt blocked', {
      userId: auth.user.id,
      attemptedOrgId: orgId
    });
    throw SaaSError.forbidden('You do not have access to this organization');
  }

  // Step 2: Fetch organization (should always exist if membership exists)
  const organization = await fetchOrganization(orgId);

  if (!organization) {
    // This shouldn't happen - indicates data integrity issue
    logger.error('Organization not found for valid membership', { orgId });
    throw SaaSError.notFound('Organization');
  }

  // Step 3: Fetch subscription and plan
  const subscription = await fetchActiveSubscription(orgId);
  let plan: Plan | null = null;

  if (subscription) {
    plan = await fetchPlan(subscription.plan_id);
  } else {
    // No subscription - use free plan
    plan = await fetchFreePlan();
  }

  return {
    ...auth,
    organization,
    membership,
    subscription,
    plan
  };
}

/**
 * Express middleware to resolve organization context.
 * 
 * Expects org_id in:
 * 1. Route params (e.g., /orgs/:orgId/...)
 * 2. Query string (e.g., ?org_id=...)
 * 3. Request body (for POST/PUT)
 * 
 * Attaches `req.org` with full organization context.
 * 
 * IMPORTANT: This middleware MUST come after authMiddleware.
 */
export function orgContextMiddleware(
  paramName: string = 'orgId'
) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.auth) {
        throw SaaSError.unauthorized('Authentication required');
      }

      // Extract org ID from multiple sources
      const orgId = 
        req.params[paramName] || 
        req.query.org_id as string ||
        req.body?.organization_id;

      if (!orgId) {
        throw SaaSError.validation('Organization ID is required');
      }

      // Validate UUID format to prevent injection
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(orgId)) {
        throw SaaSError.validation('Invalid organization ID format');
      }

      const orgContext = await resolveOrgContext(req.auth, orgId);
      req.org = orgContext;

      logger.debug('Org context resolved', {
        userId: req.auth.user.id,
        orgId: orgContext.organization.id,
        role: orgContext.membership.role,
        plan: orgContext.plan?.name
      });

      next();
    } catch (error) {
      if (error instanceof SaaSError) {
        res.status(error.statusCode).json(error.toJSON());
      } else {
        logger.error('Org context middleware error', { error });
        res.status(500).json({ 
          error: { code: 'INTERNAL_ERROR', message: 'Failed to resolve organization' } 
        });
      }
    }
  };
}

/**
 * Require a minimum role for the current request.
 * Use as middleware after orgContextMiddleware.
 * 
 * @param requiredRole - Minimum role required
 */
export function requireRole(requiredRole: OrgRole) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.org) {
      const error = SaaSError.forbidden('Organization context required');
      res.status(error.statusCode).json(error.toJSON());
      return;
    }

    if (!hasRole(req.org.membership.role, requiredRole)) {
      const error = SaaSError.forbidden(
        `This action requires ${requiredRole} role or higher`
      );
      res.status(error.statusCode).json(error.toJSON());
      return;
    }

    next();
  };
}

/**
 * Require an active subscription (not free tier).
 * Use as middleware after orgContextMiddleware.
 */
export function requireActiveSubscription(
  req: Request, 
  res: Response, 
  next: NextFunction
): void {
  if (!req.org) {
    const error = SaaSError.forbidden('Organization context required');
    res.status(error.statusCode).json(error.toJSON());
    return;
  }

  if (!req.org.subscription) {
    const error = SaaSError.subscriptionInactive('incomplete');
    res.status(error.statusCode).json(error.toJSON());
    return;
  }

  const { status } = req.org.subscription;
  if (status !== 'active' && status !== 'trialing') {
    const error = SaaSError.subscriptionInactive(status);
    res.status(error.statusCode).json(error.toJSON());
    return;
  }

  next();
}

/**
 * Check if user can perform an action based on role.
 * Does not throw - returns boolean.
 */
export function canPerformAction(
  orgContext: OrgContext,
  requiredRole: OrgRole
): boolean {
  return hasRole(orgContext.membership.role, requiredRole);
}

/**
 * Get all organizations a user can access.
 * Useful for organization switcher UI.
 */
export async function getUserOrganizations(
  auth: AuthContext
): Promise<Array<Organization & { role: OrgRole }>> {
  if (auth.memberships.length === 0) {
    return [];
  }

  const orgIds = auth.memberships.map(m => m.organization_id);

  const { data, error } = await supabaseAdmin
    .from('organizations')
    .select('*')
    .in('id', orgIds);

  if (error) {
    logger.error('Failed to fetch user organizations', { error: error.message });
    throw new SaaSError('INTERNAL_ERROR', 'Failed to fetch organizations', 500);
  }

  // Attach role to each org
  return (data || []).map(org => {
    const membership = auth.memberships.find(m => m.organization_id === org.id)!;
    return {
      ...org,
      role: membership.role
    };
  }) as Array<Organization & { role: OrgRole }>;
}
