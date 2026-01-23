import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { 
  Phone, PhoneIncoming, PhoneOutgoing, Clock, 
  Activity, BarChart3,
  Globe, DollarSign, CheckCircle, Users
} from 'lucide-react';
import { Select } from '../../components/ui/Select';
import { CreditBalance } from '../../components/CreditBalance';
import { useAuthStore } from '../../store/auth';
import { useOrganizationStore } from '../../store/organization';
import { useCalls } from '../../hooks/useCalls';
import { useUsage } from '../../hooks/useUsage';
import { useAgents } from '../../hooks/useAgents';
import { supabase } from '../../lib/supabase';

interface DashboardStats {
  totalCalls: number;
  inboundCalls: number;
  outboundCalls: number;
  avgDuration: string;
  minutesUsed: number;
  minutesRemaining: number;
  activeCalls: number;
  maxConcurrent: number;
  successRate: number;
  totalCost: number;
  activeAgents: number;
}

interface CallVolumeData {
  date: string;
  count: number;
}

export function Overview() {
  useAuthStore();
  const { currentSubscription, currentOrganization } = useOrganizationStore();
  const { calls } = useCalls();
  const { currentUsage } = useUsage();
  const { agents: _agents } = useAgents();
  
  const [stats, setStats] = useState<DashboardStats>({
    totalCalls: 0,
    inboundCalls: 0,
    outboundCalls: 0,
    avgDuration: '0:00',
    minutesUsed: 0,
    minutesRemaining: 0,
    activeCalls: 0,
    maxConcurrent: 5,
    successRate: 0,
    totalCost: 0,
    activeAgents: 0
  });
  const [timeRange, setTimeRange] = useState('7');
  const [callVolumeData, setCallVolumeData] = useState<CallVolumeData[]>([]);

  useEffect(() => {
    if (!calls.length && !currentUsage) {
      return;
    }

    const totalCalls = currentUsage?.total_calls || 0;
    const inboundCalls = calls.filter(c => c.direction === 'inbound').length;
    const outboundCalls = calls.filter(c => c.direction === 'outbound').length;
    const activeCalls = calls.filter(c => c.status === 'in_progress' || c.status === 'ringing').length;
    
    const completedCalls = calls.filter(c => c.duration_seconds && c.duration_seconds > 0);
    const avgDurationSeconds = completedCalls.length > 0
      ? Math.floor(completedCalls.reduce((sum, c) => sum + (c.duration_seconds || 0), 0) / completedCalls.length)
      : 0;
    
    const minutesUsed = Math.floor((currentUsage?.total_minutes || 0));
    const includedMinutes = currentSubscription?.plans?.included_minutes || 500;
    const minutesRemaining = Math.max(0, includedMinutes - minutesUsed);
    const maxConcurrent = currentSubscription?.plans?.max_concurrent_calls || 5;

    // Calculate success rate
    const successfulCalls = calls.filter(c => c.status === 'completed').length;
    const successRate = totalCalls > 0 ? Math.round((successfulCalls / totalCalls) * 100) : 0;

    // Calculate total cost - use user-facing cost, fallback to internal cost components
    const totalCost = calls.reduce((sum, c) => {
      // Use cost_user_cents if available (what we charge the user)
      // Otherwise fallback to sum of internal cost components
      const callCost = (c as any).cost_user_cents || 
                       ((c.cost_telephony_cents || 0) + (c.cost_stt_cents || 0) + 
                        (c.cost_tts_cents || 0) + (c.cost_llm_cents || 0));
      return sum + (callCost / 100);
    }, 0);

    // Count active agents (agents with at least one call)
    const agentsWithCalls = new Set(calls.map(c => c.agent_id).filter(Boolean));
    const activeAgents = agentsWithCalls.size;

    setStats({
      totalCalls,
      inboundCalls,
      outboundCalls,
      avgDuration: formatDuration(avgDurationSeconds),
      minutesUsed,
      minutesRemaining,
      activeCalls,
      maxConcurrent,
      successRate,
      totalCost,
      activeAgents
    });
  }, [calls, currentUsage, currentSubscription]);

  // Fetch call volume data based on time range
  useEffect(() => {
    if (!currentOrganization?.id) return;

    const fetchCallVolumeData = async () => {
      const days = parseInt(timeRange);
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      try {
        const { data, error } = await supabase
          .from('calls')
          .select('started_at')
          .eq('organization_id', currentOrganization.id)
          .gte('started_at', startDate.toISOString())
          .order('started_at', { ascending: true });

        if (error) throw error;

        // Group calls by date
        const volumeMap = new Map<string, number>();
        
        // Initialize all dates in range with 0
        for (let i = 0; i < days; i++) {
          const date = new Date();
          date.setDate(date.getDate() - (days - 1 - i));
          const dateStr = date.toISOString().split('T')[0];
          volumeMap.set(dateStr, 0);
        }

        // Count calls per date
        data?.forEach(call => {
          if (call.started_at) {
            const dateStr = call.started_at.split('T')[0];
            volumeMap.set(dateStr, (volumeMap.get(dateStr) || 0) + 1);
          }
        });

        // Convert to array format
        const volumeData: CallVolumeData[] = Array.from(volumeMap.entries()).map(([date, count]) => ({
          date,
          count
        }));

        setCallVolumeData(volumeData);
      } catch (err) {
        console.error('Error fetching call volume data:', err);
      }
    };

    fetchCallVolumeData();
  }, [currentOrganization?.id, timeRange]);

  const formatDuration = (seconds?: number) => {
    if (!seconds) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const statCards = [
    { 
      icon: Phone, 
      label: 'Total Calls', 
      value: stats.totalCalls.toLocaleString(), 
      gradient: 'from-blue-500 to-cyan-500'
    },
    { 
      icon: CheckCircle, 
      label: 'Success Rate', 
      value: `${stats.successRate}%`, 
      gradient: 'from-green-500 to-emerald-500'
    },
    { 
      icon: Clock, 
      label: 'Avg Duration', 
      value: stats.avgDuration, 
      gradient: 'from-purple-500 to-pink-500'
    },
    { 
      icon: DollarSign, 
      label: 'Total Cost', 
      value: `$${stats.totalCost.toFixed(2)}`, 
      gradient: 'from-orange-500 to-red-500'
    },
    { 
      icon: PhoneIncoming, 
      label: 'Inbound', 
      value: stats.inboundCalls.toLocaleString(), 
      gradient: 'from-cyan-500 to-blue-500'
    },
    { 
      icon: PhoneOutgoing, 
      label: 'Outbound', 
      value: stats.outboundCalls.toLocaleString(), 
      gradient: 'from-pink-500 to-rose-500'
    },
    { 
      icon: Users, 
      label: 'Active Agents', 
      value: stats.activeAgents.toLocaleString(), 
      gradient: 'from-indigo-500 to-purple-500'
    },
    { 
      icon: Activity, 
      label: 'Active Calls', 
      value: stats.activeCalls.toLocaleString(), 
      gradient: 'from-emerald-500 to-teal-500'
    },
  ];

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white mb-1">Dashboard</h1>
          <p className="text-white/50">Monitor your AI voice agent performance</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-4 py-2 bg-green-500/10 border border-green-500/20 rounded-xl">
            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
            <span className="text-sm text-green-400">{stats.activeCalls} active calls</span>
          </div>
        </div>
      </div>

      {/* Credit Balance (Trial Users) */}
      <CreditBalance />

      {/* Stats Grid */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
            className="relative overflow-hidden bg-white/[0.02] border border-white/5 rounded-2xl p-5 hover:bg-white/[0.04] transition-all duration-300"
          >
            {/* Gradient accent */}
            <div className={`absolute top-0 right-0 w-24 h-24 bg-gradient-to-br ${stat.gradient} opacity-10 blur-2xl`} />
            
            <div className="relative">
              <div className="flex items-start justify-between mb-3">
                <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${stat.gradient} flex items-center justify-center`}>
                  <stat.icon size={20} className="text-white" />
                </div>
              </div>
              <p className="text-2xl font-bold text-white mb-1">{stat.value}</p>
              <p className="text-sm text-white/40">{stat.label}</p>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Recent Calls */}
      <div className="grid lg:grid-cols-1 gap-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6 }}
        >
          <div className="flex items-center gap-2 mb-4">
            <Activity size={20} className="text-purple-400" />
            <h2 className="text-lg font-semibold text-white">Recent Calls</h2>
          </div>
          <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-4 space-y-3">
            {calls.length === 0 ? (
              <div className="text-center py-8 text-white/40">
                <Phone size={32} className="mx-auto mb-2 opacity-50" />
                <p className="text-sm">No calls yet</p>
              </div>
            ) : (
              calls.slice(0, 5).map((call, i) => (
              <motion.div
                key={call.id}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.7 + i * 0.1 }}
                className="flex items-center gap-3 p-3 bg-white/[0.02] border border-white/5 rounded-xl hover:bg-white/[0.04] transition-colors"
              >
                <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
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
                <div className="flex-1 min-w-0">
                  {call.direction === 'web' && (
                    <p className="text-xs text-white/40">Web Call</p>
                  )}
                  <p className="text-sm text-white truncate">
                    {call.from_number || call.to_number}
                  </p>
                  <p className="text-xs text-white/40">{formatDuration(call.duration_seconds || undefined)}</p>
                </div>
                <span className={`text-xs px-2 py-1 rounded-full ${
                  call.status === 'completed' 
                    ? 'bg-green-500/10 text-green-400 border border-green-500/20' 
                    : call.status === 'in_progress'
                    ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                    : 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20'
                }`}>
                  {call.status === 'in_progress' ? 'active' : call.status}
                </span>
              </motion.div>
            ))
            )}
          </div>
        </motion.div>
      </div>

      {/* Performance Chart */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.8 }}
        className="bg-white/[0.02] border border-white/5 rounded-2xl p-6"
      >
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <BarChart3 size={20} className="text-purple-400" />
            <h2 className="text-lg font-semibold text-white">Call Volume</h2>
          </div>
          <Select
            value={timeRange}
            onChange={setTimeRange}
            options={[
              { value: '7', label: 'Last 7 days' },
              { value: '30', label: 'Last 30 days' },
              { value: '90', label: 'Last 90 days' }
            ]}
            className="w-40"
            searchable={false}
          />
        </div>
        
        {/* Bar chart visualization with real data */}
        {callVolumeData.length > 0 ? (
          <>
            <div className="h-48 flex items-end justify-between gap-2">
              {callVolumeData.map((dataPoint, i) => {
                const maxCount = Math.max(...callVolumeData.map(d => d.count), 1);
                const heightPercent = (dataPoint.count / maxCount) * 100;
                
                return (
                  <motion.div
                    key={dataPoint.date}
                    initial={{ height: 0 }}
                    animate={{ height: `${heightPercent}%` }}
                    transition={{ delay: 0.9 + i * 0.05, duration: 0.5 }}
                    className="relative flex-1 bg-gradient-to-t from-purple-500 to-pink-500 rounded-t-lg opacity-80 hover:opacity-100 transition-opacity cursor-pointer group"
                    title={`${dataPoint.count} calls`}
                  >
                    {/* Tooltip on hover */}
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-black/90 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
                      {dataPoint.count} calls
                    </div>
                  </motion.div>
                );
              })}
            </div>
            <div className="flex justify-between mt-4 text-xs text-white/40">
              {callVolumeData.map((dataPoint) => {
                const date = new Date(dataPoint.date);
                const label = parseInt(timeRange) <= 7 
                  ? date.toLocaleDateString('en-US', { weekday: 'short' })
                  : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                return <span key={dataPoint.date} className="truncate">{label}</span>;
              })}
            </div>
          </>
        ) : (
          <div className="h-48 flex items-center justify-center text-white/40">
            <div className="text-center">
              <BarChart3 size={32} className="mx-auto mb-2 opacity-50" />
              <p className="text-sm">No call data available</p>
            </div>
          </div>
        )}
      </motion.div>
    </div>
  );
}
