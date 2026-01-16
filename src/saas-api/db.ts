/**
 * Supabase Database Client
 * 
 * Provides two clients:
 * 1. `supabaseAdmin` - Service role client for admin operations (bypasses RLS)
 * 2. `createUserClient` - Creates a client scoped to a user's JWT (respects RLS)
 * 
 * IMPORTANT: Use admin client ONLY for:
 * - Background jobs
 * - System operations (billing, usage aggregation)
 * - Operations that need cross-org access
 * 
 * For user-facing APIs, ALWAYS use the user-scoped client.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Validate required environment variables at startup
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL) {
  throw new Error('SUPABASE_URL environment variable is required');
}

if (!SUPABASE_ANON_KEY) {
  throw new Error('SUPABASE_ANON_KEY environment variable is required');
}

if (!SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('SUPABASE_SERVICE_ROLE_KEY environment variable is required');
}

/**
 * Admin client with service role key.
 * BYPASSES RLS - use with extreme caution.
 * 
 * Use cases:
 * - Creating initial user records after auth signup
 * - Background billing calculations
 * - System-wide usage aggregation
 * - Cross-org operations (admin dashboards)
 */
export const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

/**
 * Create a Supabase client scoped to a specific user's JWT.
 * This client RESPECTS RLS policies.
 * 
 * @param accessToken - The user's JWT from Supabase Auth
 * @returns Supabase client that operates as the authenticated user
 */
export function createUserClient(accessToken: string): SupabaseClient {
  return createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}

/**
 * Verify a JWT and extract the user ID.
 * Does NOT make a database call - just verifies the token signature.
 * 
 * @param accessToken - JWT to verify
 * @returns User ID if valid, null if invalid
 */
export async function verifyToken(accessToken: string): Promise<string | null> {
  try {
    const { data, error } = await supabaseAdmin.auth.getUser(accessToken);
    
    if (error || !data.user) {
      return null;
    }
    
    return data.user.id;
  } catch {
    return null;
  }
}

/**
 * Get the public Supabase URL for client-side use.
 */
export function getSupabaseUrl(): string {
  return SUPABASE_URL!;
}

/**
 * Get the anon key for client-side use.
 */
export function getSupabaseAnonKey(): string {
  return SUPABASE_ANON_KEY!;
}
