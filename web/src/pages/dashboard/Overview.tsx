import { motion } from 'framer-motion';
import { Phone, PhoneIncoming, PhoneOutgoing, Clock, TrendingUp, Users } from 'lucide-react';
import { VoiceDemo } from '../../components/voice/VoiceDemo';

const stats = [
  { icon: Phone, label: 'Total Calls', value: '1,234', change: '+12%', color: 'neon-blue' },
  { icon: PhoneIncoming, label: 'Inbound', value: '856', change: '+8%', color: 'neon-green' },
  { icon: PhoneOutgoing, label: 'Outbound', value: '378', change: '+18%', color: 'neon-purple' },
  { icon: Clock, label: 'Avg Duration', value: '3:42', change: '-5%', color: 'neon-pink' },
];

export function Overview() {
  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white mb-2">Dashboard</h1>
        <p className="text-white/60">Monitor your AI voice agent performance</p>
      </div>

      {/* Stats Grid */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
            className="glass-card p-5"
          >
            <div className="flex items-start justify-between mb-3">
              <div className={`w-10 h-10 rounded-xl bg-${stat.color}/10 flex items-center justify-center`}>
                <stat.icon size={20} className={`text-${stat.color}`} />
              </div>
              <span className={`text-xs font-medium ${stat.change.startsWith('+') ? 'text-neon-green' : 'text-red-400'}`}>
                {stat.change}
              </span>
            </div>
            <p className="text-2xl font-bold text-white mb-1">{stat.value}</p>
            <p className="text-sm text-white/50">{stat.label}</p>
          </motion.div>
        ))}
      </div>

      {/* Main Content Grid */}
      <div className="grid lg:grid-cols-3 gap-6">
        {/* Voice Agent Demo */}
        <div className="lg:col-span-2">
          <h2 className="text-lg font-semibold text-white mb-4">Live Voice Agent</h2>
          <VoiceDemo />
        </div>

        {/* Recent Activity */}
        <div>
          <h2 className="text-lg font-semibold text-white mb-4">Recent Calls</h2>
          <div className="glass-card p-4 space-y-3">
            {recentCalls.map((call, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.1 }}
                className="flex items-center gap-3 p-3 bg-dark-800/30 rounded-xl"
              >
                <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                  call.type === 'inbound' ? 'bg-neon-green/10' : 'bg-neon-purple/10'
                }`}>
                  {call.type === 'inbound' ? (
                    <PhoneIncoming size={14} className="text-neon-green" />
                  ) : (
                    <PhoneOutgoing size={14} className="text-neon-purple" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white truncate">{call.number}</p>
                  <p className="text-xs text-white/50">{call.duration}</p>
                </div>
                <span className={`text-xs px-2 py-1 rounded-full ${
                  call.status === 'completed' ? 'bg-neon-green/10 text-neon-green' : 'bg-yellow-500/10 text-yellow-500'
                }`}>
                  {call.status}
                </span>
              </motion.div>
            ))}
          </div>
        </div>
      </div>

      {/* Performance Chart Placeholder */}
      <div className="glass-card p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-white">Call Volume</h2>
          <select className="bg-dark-800/50 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white">
            <option>Last 7 days</option>
            <option>Last 30 days</option>
            <option>Last 90 days</option>
          </select>
        </div>
        <div className="h-64 flex items-center justify-center border border-dashed border-white/10 rounded-xl">
          <div className="text-center">
            <TrendingUp size={40} className="text-white/20 mx-auto mb-3" />
            <p className="text-white/40">Analytics chart coming soon</p>
          </div>
        </div>
      </div>
    </div>
  );
}

const recentCalls = [
  { number: '+91 98765 43210', duration: '4:32', type: 'inbound', status: 'completed' },
  { number: '+91 87654 32109', duration: '2:15', type: 'outbound', status: 'completed' },
  { number: '+91 76543 21098', duration: '1:45', type: 'inbound', status: 'pending' },
  { number: '+91 65432 10987', duration: '5:20', type: 'inbound', status: 'completed' },
  { number: '+91 54321 09876', duration: '3:10', type: 'outbound', status: 'completed' },
];
