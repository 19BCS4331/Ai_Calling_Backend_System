import { motion } from 'framer-motion';
import { BarChart3, TrendingUp, Clock, CheckCircle } from 'lucide-react';

const metrics = [
  { label: 'Success Rate', value: '94.2%', icon: CheckCircle, color: 'neon-green' },
  { label: 'Avg Response Time', value: '1.2s', icon: Clock, color: 'neon-blue' },
  { label: 'Customer Satisfaction', value: '4.8/5', icon: TrendingUp, color: 'neon-purple' },
  { label: 'Calls Handled', value: '12,456', icon: BarChart3, color: 'neon-pink' },
];

export function Analytics() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white mb-1">Analytics</h1>
        <p className="text-white/60">Track your voice agent performance</p>
      </div>

      {/* Metrics Grid */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {metrics.map((metric, i) => (
          <motion.div
            key={metric.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
            className="glass-card p-5"
          >
            <div className={`w-10 h-10 rounded-xl bg-${metric.color}/10 flex items-center justify-center mb-3`}>
              <metric.icon size={20} className={`text-${metric.color}`} />
            </div>
            <p className="text-2xl font-bold text-white mb-1">{metric.value}</p>
            <p className="text-sm text-white/50">{metric.label}</p>
          </motion.div>
        ))}
      </div>

      {/* Charts Placeholder */}
      <div className="grid lg:grid-cols-2 gap-6">
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          className="glass-card p-6"
        >
          <h2 className="text-lg font-semibold text-white mb-4">Call Volume Trend</h2>
          <div className="h-64 flex items-center justify-center border border-dashed border-white/10 rounded-xl">
            <div className="text-center">
              <BarChart3 size={40} className="text-white/20 mx-auto mb-3" />
              <p className="text-white/40">Chart visualization coming soon</p>
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          className="glass-card p-6"
        >
          <h2 className="text-lg font-semibold text-white mb-4">Response Time Distribution</h2>
          <div className="h-64 flex items-center justify-center border border-dashed border-white/10 rounded-xl">
            <div className="text-center">
              <Clock size={40} className="text-white/20 mx-auto mb-3" />
              <p className="text-white/40">Chart visualization coming soon</p>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Top Queries */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-card p-6"
      >
        <h2 className="text-lg font-semibold text-white mb-4">Top Customer Queries</h2>
        <div className="space-y-3">
          {topQueries.map((query, i) => (
            <div key={i} className="flex items-center gap-4 p-3 bg-dark-800/30 rounded-xl">
              <span className="text-white/40 w-6 text-center">{i + 1}</span>
              <div className="flex-1">
                <p className="text-white">{query.text}</p>
              </div>
              <div className="text-right">
                <p className="text-white font-medium">{query.count}</p>
                <p className="text-xs text-white/50">queries</p>
              </div>
            </div>
          ))}
        </div>
      </motion.div>
    </div>
  );
}

const topQueries = [
  { text: 'Check account balance', count: 1234 },
  { text: 'Payment status inquiry', count: 987 },
  { text: 'Loan application status', count: 756 },
  { text: 'Update contact information', count: 543 },
  { text: 'Request callback', count: 321 },
];
