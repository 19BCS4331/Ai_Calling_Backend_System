import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

export interface ProviderModel {
  id: string;
  provider_id: string;
  model_id: string;
  display_name: string;
  description: string | null;
  cost_input_per_1m_tokens: number;
  cost_output_per_1m_tokens: number;
  cost_per_minute_cents: number;
  cost_per_1k_chars_cents: number;
  context_window: number | null;
  max_output_tokens: number | null;
  supports_tool_calling: boolean;
  supports_streaming: boolean;
  is_default: boolean;
  is_active: boolean;
  sort_order: number;
  // Joined from providers
  provider_slug?: string;
  provider_type?: string;
}

export function useProviderModels() {
  const [models, setModels] = useState<ProviderModel[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchModels();
  }, []);

  const fetchModels = async () => {
    try {
      setIsLoading(true);
      const { data, error } = await supabase
        .from('provider_models')
        .select(`
          *,
          providers!inner ( slug, type )
        `)
        .eq('is_active', true)
        .order('sort_order', { ascending: true });

      if (error) throw error;

      const mapped = (data || []).map((m: any) => ({
        ...m,
        provider_slug: m.providers?.slug,
        provider_type: m.providers?.type,
      }));

      setModels(mapped);
    } catch (err) {
      console.error('Failed to fetch provider models:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch models');
    } finally {
      setIsLoading(false);
    }
  };

  const getModelsForProvider = (providerSlug: string) => {
    return models.filter(m => m.provider_slug === providerSlug);
  };

  const getDefaultModel = (providerSlug: string): string | null => {
    const providerModels = getModelsForProvider(providerSlug);
    const defaultModel = providerModels.find(m => m.is_default);
    return defaultModel?.model_id || providerModels[0]?.model_id || null;
  };

  return {
    models,
    isLoading,
    error,
    getModelsForProvider,
    getDefaultModel,
  };
}
