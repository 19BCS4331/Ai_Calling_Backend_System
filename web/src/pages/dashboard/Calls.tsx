import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Phone, PhoneIncoming, PhoneOutgoing, Globe, Search, Play, Download, Clock, TrendingUp, Loader2, ChevronLeft, ChevronRight } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useOrganizationStore } from '../../store/organization';
import { useToast } from '../../hooks/useToast';
import { saasApi, saasEndpoints } from '../../lib/api';
import { Select } from '../../components/ui/Select';

interface Call {
  id: string;
  agent_id: string | null;
  direction: 'inbound' | 'outbound' | 'web';
  from_number: string | null;
  to_number: string | null;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number;
  status: string;
  cost_total_cents: number; // Internal cost
  cost_user_cents: number;  // User-facing cost
  recording_url: string | null;
}

interface CallStats {
  total_calls: number;
  completed_calls: number;
  failed_calls: number;
  total_minutes: number;
  total_cost_cents: number;      // Internal cost
  total_user_cost_cents: number; // User-facing cost
  avg_duration_seconds: number;
  avg_latency_ms: number | null;
  by_direction: { inbound: number; outbound: number; web: number };
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  total_pages: number;
}

export function Calls() {
  const [calls, setCalls] = useState<Call[]>([]);
  const [stats, setStats] = useState<CallStats | null>(null);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: 20, total: 0, total_pages: 0 });
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'inbound' | 'outbound' | 'web'>('all');
  const { currentOrganization } = useOrganizationStore();
  const toast = useToast();

  useEffect(() => {
    if (currentOrganization) {
      fetchCalls();
      fetchStats();
    }
  }, [currentOrganization, pagination.page, filter]);

  const fetchCalls = async () => {
    if (!currentOrganization) return;

    try {
      setIsLoading(true);
      const { data: { session } } = await supabase.auth.getSession();
      
      const params = new URLSearchParams({
        page: pagination.page.toString(),
        limit: pagination.limit.toString(),
      });
      if (filter !== 'all') {
        params.append('direction', filter);
      }
      
      const data = await saasApi.get<{ data: Call[]; pagination: Pagination }>(
        `${saasEndpoints.calls(currentOrganization.id)}?${params}`,
        session?.access_token
      );
      
      setCalls(data.data || []);
      setPagination(data.pagination);
    } catch (error) {
      console.error('Failed to fetch calls:', error);
      toast.error('Failed to load calls');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchStats = async () => {
    if (!currentOrganization) return;

    try {
      const { data: { session } } = await supabase.auth.getSession();
      
      // Get stats for last 30 days
      const endDate = new Date().toISOString();
      const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      
      const data = await saasApi.get<{ stats: CallStats }>(
        `${saasEndpoints.callStats(currentOrganization.id)}?start_date=${startDate}&end_date=${endDate}`,
        session?.access_token
      );
      
      setStats(data.stats);
    } catch (error) {
      console.error('Failed to fetch call stats:', error);
    }
  };

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const formatDate = (dateStr: string): string => {
    const date = new Date(dateStr);
    return date.toLocaleString('en-IN', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const filteredCalls = calls.filter(call => {
    if (!search) return true;
    const searchLower = search.toLowerCase();
    return (
      (call.from_number?.includes(search)) ||
      (call.to_number?.includes(search)) ||
      call.status.toLowerCase().includes(searchLower)
    );
  });

  const totalCalls = stats?.total_calls || 0;
  const successRate = totalCalls > 0 ? Math.round((stats?.completed_calls || 0) / totalCalls * 100) : 0;
  // Show user-facing cost, fallback to internal cost for backward compatibility
  const totalCost = ((stats?.total_user_cost_cents || stats?.total_cost_cents) || 0) / 100;

  if (isLoading && calls.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 text-purple-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white mb-1">Call History</h1>
          <p className="text-white/50">View and manage your call records</p>
        </div>
        <button className="px-4 py-2 bg-gradient-to-r from-purple-600 to-purple-500 rounded-lg font-medium text-white hover:from-purple-500 hover:to-purple-400 transition-all duration-300 flex items-center gap-2">
          <Phone size={18} />
          New Call
        </button>
      </div>

      {/* Stats Row */}
      <div className="grid sm:grid-cols-3 gap-4">
        <div className="bg-white/[0.02] border border-white/5 rounded-xl p-4 flex items-center gap-4">
          <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
            <Phone size={18} className="text-blue-400" />
          </div>
          <div>
            <p className="text-2xl font-bold text-white">{totalCalls}</p>
            <p className="text-sm text-white/40">Total Calls (30d)</p>
          </div>
        </div>
        <div className="bg-white/[0.02] border border-white/5 rounded-xl p-4 flex items-center gap-4">
          <div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center">
            <TrendingUp size={18} className="text-green-400" />
          </div>
          <div>
            <p className="text-2xl font-bold text-white">{successRate}%</p>
            <p className="text-sm text-white/40">Success Rate</p>
          </div>
        </div>
        <div className="bg-white/[0.02] border border-white/5 rounded-xl p-4 flex items-center gap-4">
          <div className="w-10 h-10 rounded-lg bg-purple-500/10 flex items-center justify-center">
            <Clock size={18} className="text-purple-400" />
          </div>
          <div>
            <p className="text-2xl font-bold text-white">${totalCost.toFixed(2)}</p>
            <p className="text-sm text-white/40">Total Cost</p>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/40" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by phone number..."
            className="input-field pl-11"
          />
        </div>
        <Select
          value={filter}
          onChange={(value) => setFilter(value as 'all' | 'inbound' | 'outbound' | 'web')}
          options={[
            { value: 'all', label: 'All Calls' },
            { value: 'inbound', label: 'Inbound', icon: <PhoneIncoming size={16} className="text-green-400" /> },
            { value: 'outbound', label: 'Outbound', icon: <PhoneOutgoing size={16} className="text-purple-400" /> },
            { value: 'web', label: 'Web', icon: <Globe size={16} className="text-blue-400" /> }
          ]}
          className="w-full sm:w-40"
          searchable={false}
        />
      </div>

      {/* Calls Table */}
      {filteredCalls.length === 0 ? (
        <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-12 text-center">
          <Phone size={48} className="mx-auto text-white/20 mb-4" />
          <h3 className="text-lg font-semibold text-white mb-2">No Calls Yet</h3>
          <p className="text-white/50">
            Your call history will appear here once you start making or receiving calls.
          </p>
        </div>
      ) : (
        <div className="bg-white/[0.02] border border-white/5 rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/5 bg-white/[0.02]">
                  <th className="text-left text-xs font-medium text-white/40 uppercase tracking-wider p-4">Type</th>
                  <th className="text-left text-xs font-medium text-white/40 uppercase tracking-wider p-4">From / To</th>
                  <th className="text-left text-xs font-medium text-white/40 uppercase tracking-wider p-4">Duration</th>
                  <th className="text-left text-xs font-medium text-white/40 uppercase tracking-wider p-4">Status</th>
                  <th className="text-left text-xs font-medium text-white/40 uppercase tracking-wider p-4">Cost</th>
                  <th className="text-left text-xs font-medium text-white/40 uppercase tracking-wider p-4">Date</th>
                  <th className="text-left text-xs font-medium text-white/40 uppercase tracking-wider p-4">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredCalls.map((call, i) => (
                  <motion.tr
                    key={call.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: i * 0.02 }}
                    className="border-b border-white/5 hover:bg-white/[0.02] transition-colors"
                  >
                    <td className="p-4">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                        call.direction === 'inbound' 
                          ? 'bg-green-500/10 border border-green-500/20' 
                          : call.direction === 'web'
                          ? 'bg-blue-500/10 border border-blue-500/20'
                          : 'bg-purple-500/10 border border-purple-500/20'
                      }`}>
                        {call.direction === 'inbound' ? (
                          <PhoneIncoming size={14} className="text-green-400" />
                        ) : call.direction === 'web' ? (
                          <Globe size={14} className="text-blue-400" />
                        ) : (
                          <PhoneOutgoing size={14} className="text-purple-400" />
                        )}
                      </div>
                    </td>
                    <td className="p-4">
                      <p className="text-white font-medium">{call.from_number || 'Web User'}</p>
                      <p className="text-sm text-white/40">→ {call.to_number || 'Agent'}</p>
                    </td>
                    <td className="p-4 text-white/60 font-mono">{formatDuration(call.duration_seconds)}</td>
                    <td className="p-4">
                      <span className={`text-xs px-2.5 py-1 rounded-full border ${
                        call.status === 'completed' 
                          ? 'bg-green-500/10 text-green-400 border-green-500/20' 
                          : call.status === 'failed' 
                          ? 'bg-red-500/10 text-red-400 border-red-500/20' 
                          : call.status === 'in_progress'
                          ? 'bg-blue-500/10 text-blue-400 border-blue-500/20'
                          : 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20'
                      }`}>
                        {call.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="p-4 text-white/60 font-mono">${((call.cost_user_cents || call.cost_total_cents) / 100).toFixed(2)}</td>
                    <td className="p-4 text-white/40 text-sm">{formatDate(call.started_at)}</td>
                    <td className="p-4">
                      <div className="flex gap-1">
                        {call.recording_url && (
                          <button 
                            onClick={() => window.open(call.recording_url!, '_blank')}
                            className="p-2 text-white/40 hover:text-purple-400 hover:bg-purple-500/10 rounded-lg transition-colors"
                            title="Play recording"
                          >
                            <Play size={16} />
                          </button>
                        )}
                        <button 
                          className="p-2 text-white/40 hover:text-purple-400 hover:bg-purple-500/10 rounded-lg transition-colors"
                          title="View transcript"
                        >
                          <Download size={16} />
                        </button>
                      </div>
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {pagination.total_pages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-white/5">
              <p className="text-sm text-white/40">
                Showing {((pagination.page - 1) * pagination.limit) + 1} to {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total} calls
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setPagination(p => ({ ...p, page: p.page - 1 }))}
                  disabled={pagination.page <= 1}
                  className="p-2 text-white/40 hover:text-white hover:bg-white/5 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <ChevronLeft size={18} />
                </button>
                <span className="px-3 py-2 text-sm text-white/60">
                  Page {pagination.page} of {pagination.total_pages}
                </span>
                <button
                  onClick={() => setPagination(p => ({ ...p, page: p.page + 1 }))}
                  disabled={pagination.page >= pagination.total_pages}
                  className="p-2 text-white/40 hover:text-white hover:bg-white/5 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <ChevronRight size={18} />
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
