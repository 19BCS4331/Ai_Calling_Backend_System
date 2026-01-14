import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface User {
  id: string;
  email: string;
  name: string;
  apiKey: string;
}

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (name: string, email: string, password: string) => Promise<void>;
  logout: () => void;
  setApiKey: (apiKey: string) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      isAuthenticated: false,
      isLoading: false,

      login: async (email: string, _password: string) => {
        set({ isLoading: true });
        // Simulate API call - in production, call actual auth endpoint
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        const user: User = {
          id: crypto.randomUUID(),
          email,
          name: email.split('@')[0],
          apiKey: localStorage.getItem('vocaai_api_key') || '',
        };
        
        set({ user, isAuthenticated: true, isLoading: false });
      },

      signup: async (name: string, email: string, _password: string) => {
        set({ isLoading: true });
        // Simulate API call
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        const user: User = {
          id: crypto.randomUUID(),
          email,
          name,
          apiKey: '',
        };
        
        set({ user, isAuthenticated: true, isLoading: false });
      },

      logout: () => {
        set({ user: null, isAuthenticated: false });
      },

      setApiKey: (apiKey: string) => {
        const currentUser = get().user;
        if (currentUser) {
          localStorage.setItem('vocaai_api_key', apiKey);
          set({ user: { ...currentUser, apiKey } });
        }
      },
    }),
    {
      name: 'vocaai-auth',
      partialize: (state) => ({ user: state.user, isAuthenticated: state.isAuthenticated }),
    }
  )
);
