/**
 * Authentication Module
 * 
 * Handles JWT verification and user context resolution.
 * 
 * SECURITY PRINCIPLES:
 * 1. All tokens are verified against Supabase Auth
 * 2. User data is fetched from our users table (not just JWT claims)
 * 3. Organization memberships are resolved server-side
 * 4. Never trust client-provided user_id or org_id
 */

import { Request, Response, NextFunction } from 'express';
import { supabaseAdmin, verifyToken, createUserClient } from './db';
import { 
  AuthContext, 
  User, 
  OrganizationMember, 
  SaaSError 
} from './types';
import { createLogger } from '../utils/logger';

const logger = createLogger('saas-auth');

// Extend Express Request to include auth context
declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
      userClient?: ReturnType<typeof createUserClient>;
    }
  }
}

/**
 * Extract Bearer token from Authorization header.
 */
function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader) return null;
  
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
    return null;
  }
  
  return parts[1];
}

/**
 * Fetch user record from our users table.
 * This ensures we have the full user profile, not just JWT claims.
 */
async function fetchUser(userId: string): Promise<User | null> {
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('*')
    .eq('id', userId)
    .single();
  
  if (error) {
    // User might not exist in our table yet (first login)
    logger.debug('User not found in users table', { userId, error: error.message });
    return null;
  }
  
  return data as User;
}

/**
 * Create user record on first login.
 * Called when Supabase Auth has the user but our users table doesn't.
 */
async function createUserRecord(
  userId: string, 
  email: string,
  metadata?: Record<string, unknown>
): Promise<User> {
  const { data, error } = await supabaseAdmin
    .from('users')
    .insert({
      id: userId,
      email,
      full_name: metadata?.full_name as string || null,
      avatar_url: metadata?.avatar_url as string || null,
      email_verified: true, // They authenticated, so email is verified
      metadata: metadata || {}
    })
    .select()
    .single();
  
  if (error) {
    logger.error('Failed to create user record', { userId, error: error.message });
    throw new SaaSError('INTERNAL_ERROR', 'Failed to create user record', 500);
  }
  
  logger.info('Created new user record', { userId, email });
  return data as User;
}

/**
 * Fetch all organization memberships for a user.
 * Used to determine which organizations the user can access.
 */
async function fetchMemberships(userId: string): Promise<OrganizationMember[]> {
  const { data, error } = await supabaseAdmin
    .from('organization_members')
    .select('*')
    .eq('user_id', userId);
  
  if (error) {
    logger.error('Failed to fetch memberships', { userId, error: error.message });
    throw new SaaSError('INTERNAL_ERROR', 'Failed to fetch memberships', 500);
  }
  
  return (data || []) as OrganizationMember[];
}

/**
 * Resolve full auth context from a JWT.
 * 
 * This function:
 * 1. Verifies the JWT with Supabase Auth
 * 2. Fetches (or creates) the user record
 * 3. Fetches all organization memberships
 * 
 * @param accessToken - JWT from Authorization header
 * @returns Full auth context or null if invalid
 */
export async function resolveAuthContext(accessToken: string): Promise<AuthContext | null> {
  // Step 1: Verify JWT and get user from Supabase Auth
  const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(accessToken);
  
  if (authError || !authData.user) {
    logger.debug('JWT verification failed', { error: authError?.message });
    return null;
  }
  
  const authUser = authData.user;
  
  // Step 2: Fetch or create user in our users table
  let user = await fetchUser(authUser.id);
  
  if (!user) {
    // First login - create user record
    user = await createUserRecord(
      authUser.id,
      authUser.email!,
      authUser.user_metadata
    );
  }
  
  // Step 3: Fetch organization memberships
  const memberships = await fetchMemberships(user.id);
  
  return {
    user,
    memberships
  };
}

/**
 * Express middleware for authentication.
 * 
 * Attaches `req.auth` with the authenticated user context.
 * Also attaches `req.userClient` - a Supabase client scoped to the user.
 * 
 * Usage:
 * ```
 * app.use('/api', authMiddleware);
 * 
 * app.get('/api/me', (req, res) => {
 *   res.json(req.auth!.user);
 * });
 * ```
 */
export async function authMiddleware(
  req: Request, 
  res: Response, 
  next: NextFunction
): Promise<void> {
  try {
    const token = extractBearerToken(req.headers.authorization);
    
    if (!token) {
      throw SaaSError.unauthorized('Missing authorization header');
    }
    
    const authContext = await resolveAuthContext(token);
    
    if (!authContext) {
      throw SaaSError.unauthorized('Invalid or expired token');
    }
    
    // Attach context to request
    req.auth = authContext;
    req.userClient = createUserClient(token);
    
    // Log authenticated request (without sensitive data)
    logger.debug('Authenticated request', {
      userId: authContext.user.id,
      email: authContext.user.email,
      orgCount: authContext.memberships.length
    });
    
    next();
  } catch (error) {
    if (error instanceof SaaSError) {
      res.status(error.statusCode).json(error.toJSON());
    } else {
      logger.error('Auth middleware error', { error });
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Authentication failed' } });
    }
  }
}

/**
 * Optional auth middleware - doesn't fail if no token provided.
 * Useful for endpoints that have different behavior for authenticated vs anonymous.
 */
export async function optionalAuthMiddleware(
  req: Request, 
  res: Response, 
  next: NextFunction
): Promise<void> {
  try {
    const token = extractBearerToken(req.headers.authorization);
    
    if (token) {
      const authContext = await resolveAuthContext(token);
      if (authContext) {
        req.auth = authContext;
        req.userClient = createUserClient(token);
      }
    }
    
    next();
  } catch (error) {
    // Log but don't fail - just proceed without auth
    logger.debug('Optional auth failed', { error });
    next();
  }
}

/**
 * Require authentication - use after optionalAuthMiddleware if you need
 * to conditionally require auth.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.auth) {
    const error = SaaSError.unauthorized();
    res.status(error.statusCode).json(error.toJSON());
    return;
  }
  next();
}

/**
 * Check if user has any organization membership.
 * Useful for onboarding flows.
 */
export function hasAnyOrganization(auth: AuthContext): boolean {
  return auth.memberships.length > 0;
}

/**
 * Get user's default organization (first one they're a member of).
 * Returns null if user has no organizations.
 */
export function getDefaultOrgId(auth: AuthContext): string | null {
  if (auth.memberships.length === 0) return null;
  
  // Prefer orgs where user is owner, then admin, then member
  const roleOrder: Record<string, number> = { owner: 0, admin: 1, member: 2, viewer: 3 };
  
  const sorted = [...auth.memberships].sort((a, b) => {
    return (roleOrder[a.role] || 99) - (roleOrder[b.role] || 99);
  });
  
  return sorted[0].organization_id;
}
