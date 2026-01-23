import { create } from 'zustand';
import { supabase } from '../lib/supabase';

export interface Organization {
  id: string;
  name: string;
  slug: string;
  billing_email?: string;
  stripe_customer_id?: string;
  razorpay_customer_id?: string;
  created_at: string;
  updated_at: string;
}

export interface OrganizationMember {
  id: string;
  organization_id: string;
  user_id: string;
  role: 'owner' | 'admin' | 'member' | 'viewer';
  created_at: string;
}

export interface Subscription {
  id: string;
  organization_id: string;
  plan_id: string;
  status: 'trialing' | 'active' | 'past_due' | 'canceled' | 'paused' | 'incomplete';
  current_period_start: string;
  current_period_end: string;
  billing_interval: 'monthly' | 'yearly';
  plans?: {
    id: string;
    name: string;
    tier: 'free' | 'starter' | 'growth' | 'scale' | 'enterprise';
    included_minutes: number;
    max_concurrent_calls: number;
    overage_rate_cents: number;
  };
}

interface OrganizationState {
  currentOrganization: Organization | null;
  organizations: Organization[];
  currentSubscription: Subscription | null;
  isLoading: boolean;
  error: string | null;
  lastFetchedAt: number | null;
  lastSubscriptionFetchedAt: number | null;
  
  fetchUserOrganizations: (force?: boolean) => Promise<void>;
  setCurrentOrganization: (orgId: string) => Promise<void>;
  fetchCurrentSubscription: (orgId: string, force?: boolean) => Promise<void>;
  updateOrganization: (orgId: string, data: Partial<Organization>) => Promise<void>;
}

// Cache TTL: 5 minutes
const CACHE_TTL = 5 * 60 * 1000;

export const useOrganizationStore = create<OrganizationState>((set, get) => ({
  currentOrganization: null,
  organizations: [],
  currentSubscription: null,
  isLoading: false,
  error: null,
  lastFetchedAt: null,
  lastSubscriptionFetchedAt: null,

  fetchUserOrganizations: async (force = false) => {
    const state = get();
    const now = Date.now();
    
    // Skip if data is fresh (within cache TTL) and not forced
    if (!force && state.lastFetchedAt && (now - state.lastFetchedAt) < CACHE_TTL && state.organizations.length > 0) {
      return;
    }

    set({ isLoading: true, error: null });
    
    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        throw new Error('Not authenticated');
      }

      const { data: members, error: membersError } = await supabase
        .from('organization_members')
        .select(`
          organization_id,
          role,
          organizations (
            id,
            name,
            slug,
            billing_email,
            stripe_customer_id,
            razorpay_customer_id,
            created_at,
            updated_at
          )
        `)
        .eq('user_id', user.id);

      if (membersError) throw membersError;

      const orgs = members?.map(m => m.organizations as any).filter(Boolean) as Organization[] || [];
      
      set({ 
        organizations: orgs,
        currentOrganization: orgs[0] || null,
        isLoading: false,
        lastFetchedAt: Date.now()
      });

      if (orgs[0]) {
        get().fetchCurrentSubscription(orgs[0].id);
      }
    } catch (error) {
      set({ 
        error: error instanceof Error ? error.message : 'Failed to fetch organizations',
        isLoading: false 
      });
    }
  },

  setCurrentOrganization: async (orgId: string) => {
    const org = get().organizations.find(o => o.id === orgId);
    
    if (org) {
      set({ currentOrganization: org });
      await get().fetchCurrentSubscription(orgId);
    }
  },

  fetchCurrentSubscription: async (orgId: string, force = false) => {
    const state = get();
    const now = Date.now();
    
    // Skip if data is fresh (within cache TTL) and not forced
    if (!force && state.lastSubscriptionFetchedAt && (now - state.lastSubscriptionFetchedAt) < CACHE_TTL && state.currentSubscription) {
      return;
    }

    try {
      const { data, error } = await supabase
        .from('subscriptions')
        .select(`
          id,
          organization_id,
          plan_id,
          status,
          current_period_start,
          current_period_end,
          billing_interval,
          plans (
            id,
            name,
            tier,
            included_minutes,
            max_concurrent_calls,
            overage_rate_cents
          )
        `)
        .eq('organization_id', orgId)
        .eq('status', 'active')
        .single();

      if (error && error.code !== 'PGRST116') throw error;

      set({ 
        currentSubscription: data as Subscription | null,
        lastSubscriptionFetchedAt: Date.now()
      });
    } catch (error) {
      console.error('Failed to fetch subscription:', error);
    }
  },

  updateOrganization: async (orgId: string, data: Partial<Organization>) => {
    set({ isLoading: true, error: null });
    
    try {
      const { error } = await supabase
        .from('organizations')
        .update(data)
        .eq('id', orgId);

      if (error) throw error;

      await get().fetchUserOrganizations();
    } catch (error) {
      set({ 
        error: error instanceof Error ? error.message : 'Failed to update organization',
        isLoading: false 
      });
    }
  },
}));
