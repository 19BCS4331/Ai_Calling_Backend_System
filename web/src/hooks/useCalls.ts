import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useOrganizationStore } from '../store/organization';

export interface Call {
  id: string;
  organization_id: string;
  agent_id: string | null;
  phone_number_id: string | null;
  direction: 'inbound' | 'outbound' | 'web';
  status: 'queued' | 'ringing' | 'in_progress' | 'completed' | 'failed' | 'busy' | 'no_answer' | 'canceled';
  from_number: string | null;
  to_number: string | null;
  duration_seconds: number | null;
  recording_url: string | null;
  cost_telephony_cents: number;
  cost_stt_cents: number;
  cost_tts_cents: number;
  cost_llm_cents: number;
  metadata: Record<string, any>;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
  updated_at: string;
}

export function useCalls() {
  const [calls, setCalls] = useState<Call[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { currentOrganization } = useOrganizationStore();

  const fetchCalls = async (limit = 50) => {
    if (!currentOrganization) {
      setCalls([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const { data, error: fetchError } = await supabase
        .from('calls')
        .select('*')
        .eq('organization_id', currentOrganization.id)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (fetchError) throw fetchError;

      setCalls(data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch calls');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchCalls();
  }, [currentOrganization?.id]);

  return {
    calls,
    isLoading,
    error,
    fetchCalls,
  };
}
