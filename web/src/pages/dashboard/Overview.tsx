import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { 
  Phone, PhoneIncoming, PhoneOutgoing, Clock, 
  Zap, ArrowUpRight, ArrowDownRight,
  Activity, Mic, BarChart3
} from 'lucide-react';
import { VoiceDemo } from '../../components/voice/VoiceDemo';
import { useAuthStore } from '../../store/auth';
import { useOrganizationStore } from '../../store/organization';
import { useCalls } from '../../hooks/useCalls';
import { useUsage } from '../../hooks/useUsage';
import { useAgents } from '../../hooks/useAgents';

interface DashboardStats {
  totalCalls: number;
  inboundCalls: number;
  outboundCalls: number;
  avgDuration: string;
  minutesUsed: number;
  minutesRemaining: number;
  activeCalls: number;
  maxConcurrent: number;
}

export function Overview() {
  useAuthStore();
  const { currentSubscription } = useOrganizationStore();
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
    maxConcurrent: 5
  });

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

    console.log("Current subscription plan: ", currentSubscription)

    setStats({
      totalCalls,
      inboundCalls,
      outboundCalls,
      avgDuration: formatDuration(avgDurationSeconds),
      minutesUsed,
      minutesRemaining,
      activeCalls,
      maxConcurrent
    });
  }, [calls, currentUsage, currentSubscription]);

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
      change: '+12%', 
      changeType: 'positive',
      gradient: 'from-blue-500 to-cyan-500'
    },
    { 
      icon: PhoneIncoming, 
      label: 'Inbound', 
      value: stats.inboundCalls.toLocaleString(), 
      change: '+8%', 
      changeType: 'positive',
      gradient: 'from-green-500 to-emerald-500'
    },
    { 
      icon: PhoneOutgoing, 
      label: 'Outbound', 
      value: stats.outboundCalls.toLocaleString(), 
      change: '+18%', 
      changeType: 'positive',
      gradient: 'from-purple-500 to-pink-500'
    },
    { 
      icon: Clock, 
      label: 'Avg Duration', 
      value: stats.avgDuration, 
      change: '-5%', 
      changeType: 'negative',
      gradient: 'from-orange-500 to-red-500'
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
                <div className={`flex items-center gap-1 text-xs font-medium ${
                  stat.changeType === 'positive' ? 'text-green-400' : 'text-red-400'
                }`}>
                  {stat.changeType === 'positive' ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
                  {stat.change}
                </div>
              </div>
              <p className="text-2xl font-bold text-white mb-1">{stat.value}</p>
              <p className="text-sm text-white/40">{stat.label}</p>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Usage Bar */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
        className="bg-white/[0.02] border border-white/5 rounded-2xl p-6"
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
              <Zap size={20} className="text-white" />
            </div>
            <div>
              <h3 className="text-white font-medium">Monthly Usage</h3>
              <p className="text-sm text-white/40">{stats.minutesUsed} of {stats.minutesUsed + stats.minutesRemaining} minutes used</p>
            </div>
          </div>
          <button className="px-4 py-2 bg-purple-500/10 border border-purple-500/20 rounded-lg text-purple-400 text-sm hover:bg-purple-500/20 transition-colors">
            Upgrade Plan
          </button>
        </div>
        
        <div className="h-3 bg-white/5 rounded-full overflow-hidden">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${(stats.minutesUsed / (stats.minutesUsed + stats.minutesRemaining)) * 100}%` }}
            transition={{ duration: 1, ease: 'easeOut' }}
            className="h-full bg-gradient-to-r from-purple-500 to-pink-500 rounded-full"
          />
        </div>
        
        <div className="flex justify-between mt-2 text-xs text-white/40">
          <span>{stats.minutesUsed} minutes used</span>
          <span>{stats.minutesRemaining} minutes remaining</span>
        </div>
      </motion.div>

      {/* Main Content Grid */}
      <div className="grid lg:grid-cols-3 gap-6">
        {/* Voice Agent Demo */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="lg:col-span-2"
        >
          <div className="flex items-center gap-2 mb-4">
            <Mic size={20} className="text-purple-400" />
            <h2 className="text-lg font-semibold text-white">Live Voice Agent</h2>
          </div>
          <VoiceDemo />
        </motion.div>

        {/* Recent Calls */}
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
                    : 'bg-purple-500/10 border border-purple-500/20'
                }`}>
                  {call.direction === 'inbound' ? (
                    <PhoneIncoming size={14} className="text-green-400" />
                  ) : (
                    <PhoneOutgoing size={14} className="text-purple-400" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
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
          <select className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-purple-500/50">
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
          </select>
        </div>
        
        {/* Simple bar chart visualization */}
        <div className="h-48 flex items-end justify-between gap-2">
          {[65, 45, 80, 55, 90, 70, 85].map((height, i) => (
            <motion.div
              key={i}
              initial={{ height: 0 }}
              animate={{ height: `${height}%` }}
              transition={{ delay: 0.9 + i * 0.1, duration: 0.5 }}
              className="flex-1 bg-gradient-to-t from-purple-500 to-pink-500 rounded-t-lg opacity-80 hover:opacity-100 transition-opacity cursor-pointer"
            />
          ))}
        </div>
        <div className="flex justify-between mt-4 text-xs text-white/40">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => (
            <span key={day}>{day}</span>
          ))}
        </div>
      </motion.div>
    </div>
  );
}
