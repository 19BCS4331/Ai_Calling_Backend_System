import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

export interface Provider {
  id: string;
  type: 'stt' | 'tts' | 'llm' | 'telephony';
  name: string;
  slug: string;
  display_name: string;
  description: string;
  is_active: boolean;
  is_premium: boolean;
  logo_url?: string;
}

export function useProviders() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchProviders();
  }, []);

  const fetchProviders = async () => {
    try {
      setIsLoading(true);
      const { data, error } = await supabase
        .from('providers')
        .select('*')
        .eq('is_active', true)
        .order('display_name');

      if (error) throw error;
      setProviders(data as Provider[]);
    } catch (err) {
      console.error('Failed to fetch providers:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch providers');
    } finally {
      setIsLoading(false);
    }
  };

  const getProvidersByType = (type: Provider['type']) => {
    return providers.filter(p => p.type === type);
  };

  return {
    providers,
    isLoading,
    error,
    getProvidersByType,
  };
}
