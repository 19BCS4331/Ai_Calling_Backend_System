import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import type { User as SupabaseUser } from '@supabase/supabase-js';
import { useOrganizationStore } from './organization';

interface User {
  id: string;
  email: string;
  name: string;
}

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  initialize: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  signup: (name: string, email: string, password: string) => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
}

const mapSupabaseUser = (supabaseUser: SupabaseUser): User => ({
  id: supabaseUser.id,
  email: supabaseUser.email || '',
  name: supabaseUser.user_metadata?.name || supabaseUser.user_metadata?.full_name || supabaseUser.email?.split('@')[0] || '',
});

export const useAuthStore = create<AuthState>()((set) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,
  error: null,

  initialize: async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      
      if (session?.user) {
        set({ 
          user: mapSupabaseUser(session.user), 
          isAuthenticated: true, 
          isLoading: false 
        });
        
        // Fetch user's organizations
        useOrganizationStore.getState().fetchUserOrganizations();
      } else {
        set({ user: null, isAuthenticated: false, isLoading: false });
      }

      // Listen for auth changes
      supabase.auth.onAuthStateChange((_event, session) => {
        if (session?.user) {
          set({ 
            user: mapSupabaseUser(session.user), 
            isAuthenticated: true 
          });
          
          // Fetch organizations on auth state change
          useOrganizationStore.getState().fetchUserOrganizations();
        } else {
          set({ user: null, isAuthenticated: false });
        }
      });
    } catch (error) {
      console.error('Auth initialization error:', error);
      set({ user: null, isAuthenticated: false, isLoading: false });
    }
  },

  login: async (email: string, password: string) => {
    set({ isLoading: true, error: null });
    
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      set({ isLoading: false, error: error.message });
      throw error;
    }

    if (data.user) {
      set({ 
        user: mapSupabaseUser(data.user), 
        isAuthenticated: true, 
        isLoading: false 
      });
    }
  },

  signup: async (name: string, email: string, password: string) => {
    set({ isLoading: true, error: null });

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          name,
          full_name: name,
        },
      },
    });

    if (error) {
      set({ isLoading: false, error: error.message });
      throw error;
    }

    if (data.user) {
      set({ 
        user: mapSupabaseUser(data.user), 
        isAuthenticated: true, 
        isLoading: false 
      });
      
      // Don't fetch organizations yet - user needs to complete onboarding
    }
  },

  loginWithGoogle: async () => {
    set({ isLoading: true, error: null });

    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/onboarding`,
      },
    });

    if (error) {
      set({ isLoading: false, error: error.message });
      throw error;
    }
  },

  logout: async () => {
    set({ isLoading: true });
    
    const { error } = await supabase.auth.signOut();
    
    if (error) {
      console.error('Logout error:', error);
    }
    
    set({ user: null, isAuthenticated: false, isLoading: false });
  },

  resetPassword: async (email: string) => {
    set({ isLoading: true, error: null });

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });

    if (error) {
      set({ isLoading: false, error: error.message });
      throw error;
    }

    set({ isLoading: false });
  },
}));
