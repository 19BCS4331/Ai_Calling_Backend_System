import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useOrganizationStore } from '../store/organization';

export interface UsageStats {
  total_minutes: number;
  total_calls: number;
  total_cost_cents: number;
  period_start: string;
  period_end: string;
}

export interface DailyUsage {
  date: string;
  total_calls: number;
  total_minutes: number;
  total_cost_cents: number;
  successful_calls: number;
  failed_calls: number;
}

export function useUsage() {
  const [currentUsage, setCurrentUsage] = useState<UsageStats | null>(null);
  const [dailyUsage, setDailyUsage] = useState<DailyUsage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { currentOrganization } = useOrganizationStore();

  const fetchCurrentUsage = async () => {
    if (!currentOrganization) {
      setCurrentUsage(null);
      return;
    }

    try {
      const { data, error: fetchError } = await supabase
        .from('v_organization_current_usage')
        .select('*')
        .eq('organization_id', currentOrganization.id)
        .single();

      if (fetchError && fetchError.code !== 'PGRST116') throw fetchError;

      setCurrentUsage(data || {
        total_minutes: 0,
        total_calls: 0,
        total_cost_cents: 0,
        period_start: new Date().toISOString(),
        period_end: new Date().toISOString(),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch current usage');
    }
  };

  const fetchDailyUsage = async (days = 30) => {
    if (!currentOrganization) {
      setDailyUsage([]);
      return;
    }

    try {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const { data, error: fetchError } = await supabase
        .from('usage_daily_summary')
        .select('*')
        .eq('organization_id', currentOrganization.id)
        .gte('date', startDate.toISOString().split('T')[0])
        .order('date', { ascending: true });

      if (fetchError) throw fetchError;

      setDailyUsage(data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch daily usage');
    }
  };

  const fetchAll = async () => {
    setIsLoading(true);
    setError(null);

    await Promise.all([
      fetchCurrentUsage(),
      fetchDailyUsage(),
    ]);

    setIsLoading(false);
  };

  useEffect(() => {
    fetchAll();
  }, [currentOrganization?.id]);

  return {
    currentUsage,
    dailyUsage,
    isLoading,
    error,
    refetch: fetchAll,
  };
}
