import { motion } from 'framer-motion';
import { BarChart3, TrendingUp, Clock, CheckCircle } from 'lucide-react';

const metrics = [
  { label: 'Success Rate', value: '94.2%', icon: CheckCircle, gradient: 'from-green-500 to-emerald-500' },
  { label: 'Avg Response Time', value: '1.2s', icon: Clock, gradient: 'from-blue-500 to-cyan-500' },
  { label: 'Customer Satisfaction', value: '4.8/5', icon: TrendingUp, gradient: 'from-purple-500 to-pink-500' },
  { label: 'Calls Handled', value: '12,456', icon: BarChart3, gradient: 'from-orange-500 to-amber-500' },
];

export function Analytics() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white mb-1">Analytics</h1>
        <p className="text-white/50">Track your voice agent performance</p>
      </div>

      {/* Metrics Grid */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {metrics.map((metric, i) => (
          <motion.div
            key={metric.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
            className="relative overflow-hidden bg-white/[0.02] border border-white/5 rounded-2xl p-5"
          >
            <div className={`absolute top-0 right-0 w-20 h-20 bg-gradient-to-br ${metric.gradient} opacity-10 blur-2xl`} />
            <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${metric.gradient} flex items-center justify-center mb-3`}>
              <metric.icon size={20} className="text-white" />
            </div>
            <p className="text-2xl font-bold text-white mb-1">{metric.value}</p>
            <p className="text-sm text-white/50">{metric.label}</p>
          </motion.div>
        ))}
      </div>

      {/* Charts */}
      <div className="grid lg:grid-cols-2 gap-6">
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          className="bg-white/[0.02] border border-white/5 rounded-2xl p-6"
        >
          <h2 className="text-lg font-semibold text-white mb-4">Call Volume Trend</h2>
          <div className="h-48 flex items-end justify-between gap-2">
            {[45, 65, 55, 80, 70, 90, 75].map((height, i) => (
              <motion.div
                key={i}
                initial={{ height: 0 }}
                animate={{ height: `${height}%` }}
                transition={{ delay: 0.3 + i * 0.1, duration: 0.5 }}
                className="flex-1 bg-gradient-to-t from-purple-500 to-pink-500 rounded-t-lg opacity-80 hover:opacity-100 transition-opacity cursor-pointer"
              />
            ))}
          </div>
          <div className="flex justify-between mt-3 text-xs text-white/40">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => (
              <span key={day}>{day}</span>
            ))}
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          className="bg-white/[0.02] border border-white/5 rounded-2xl p-6"
        >
          <h2 className="text-lg font-semibold text-white mb-4">Response Time Distribution</h2>
          <div className="h-48 flex items-end justify-between gap-3">
            {[
              { label: '<0.5s', value: 35 },
              { label: '0.5-1s', value: 45 },
              { label: '1-2s', value: 15 },
              { label: '>2s', value: 5 },
            ].map((item, i) => (
              <div key={i} className="flex-1 flex flex-col items-center">
                <motion.div
                  initial={{ height: 0 }}
                  animate={{ height: `${item.value * 2}%` }}
                  transition={{ delay: 0.3 + i * 0.1, duration: 0.5 }}
                  className="w-full bg-gradient-to-t from-blue-500 to-cyan-500 rounded-t-lg opacity-80"
                />
                <span className="text-xs text-white/40 mt-2">{item.label}</span>
              </div>
            ))}
          </div>
        </motion.div>
      </div>

      {/* Top Queries */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white/[0.02] border border-white/5 rounded-2xl p-6"
      >
        <h2 className="text-lg font-semibold text-white mb-4">Top Customer Queries</h2>
        <div className="space-y-3">
          {topQueries.map((query, i) => (
            <div key={i} className="flex items-center gap-4 p-3 bg-white/[0.02] border border-white/5 rounded-xl hover:bg-white/[0.04] transition-colors">
              <span className="w-8 h-8 rounded-lg bg-purple-500/10 flex items-center justify-center text-purple-400 text-sm font-medium">{i + 1}</span>
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
