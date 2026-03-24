import { useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  Clock, CheckCircle, Phone,
  DollarSign, PhoneIncoming, PhoneOutgoing, Globe, Loader2,
  Calendar
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useOrganizationStore } from '../../store/organization';
import { useUsage } from '../../hooks/useUsage';
import { Select } from '../../components/ui/Select';

interface CallAggregates {
  totalCalls: number;
  completedCalls: number;
  failedCalls: number;
  totalDurationSeconds: number;
  totalCostCents: number;
  totalUserCostCents: number;
  avgLatencyMs: number | null;
  inbound: number;
  outbound: number;
  web: number;
}

export function Analytics() {
  const { currentOrganization } = useOrganizationStore();
  const { dailyUsage, isLoading: usageLoading } = useUsage();
  const [range, setRange] = useState<'7' | '14' | '30'>('30');
  const [aggregates, setAggregates] = useState<CallAggregates | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Fetch call aggregates from calls table
  useEffect(() => {
    if (!currentOrganization) return;

    const fetchAggregates = async () => {
      setIsLoading(true);
      try {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - parseInt(range));

        const { data, error } = await supabase
          .from('calls')
          .select('status, direction, duration_seconds, cost_total_cents, cost_user_cents, latency_first_response_ms')
          .eq('organization_id', currentOrganization.id)
          .gte('started_at', startDate.toISOString());

        if (error) throw error;

        const agg: CallAggregates = {
          totalCalls: data?.length || 0,
          completedCalls: data?.filter(c => c.status === 'completed').length || 0,
          failedCalls: data?.filter(c => c.status === 'failed').length || 0,
          totalDurationSeconds: data?.reduce((s, c) => s + (c.duration_seconds || 0), 0) || 0,
          totalCostCents: data?.reduce((s, c) => s + (c.cost_total_cents || 0), 0) || 0,
          totalUserCostCents: data?.reduce((s, c) => s + (c.cost_user_cents || 0), 0) || 0,
          avgLatencyMs: null,
          inbound: data?.filter(c => c.direction === 'inbound').length || 0,
          outbound: data?.filter(c => c.direction === 'outbound').length || 0,
          web: data?.filter(c => c.direction === 'web').length || 0,
        };

        const latencies = data?.map(c => c.latency_first_response_ms).filter(Boolean) as number[];
        if (latencies.length > 0) {
          agg.avgLatencyMs = Math.round(latencies.reduce((s, l) => s + l, 0) / latencies.length);
        }

        setAggregates(agg);
      } catch (err) {
        console.error('Failed to fetch call aggregates:', err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchAggregates();
  }, [currentOrganization, range]);

  // Filter daily usage to match selected range
  const filteredDaily = useMemo(() => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - parseInt(range));
    const cutoffStr = cutoff.toISOString().split('T')[0];
    return dailyUsage.filter(d => d.date >= cutoffStr);
  }, [dailyUsage, range]);

  // Compute chart max for scaling
  const maxCalls = useMemo(() => Math.max(...filteredDaily.map(d => d.total_calls), 1), [filteredDaily]);
  const maxCost = useMemo(() => Math.max(...filteredDaily.map(d => d.total_cost_cents), 1), [filteredDaily]);

  const successRate = aggregates && aggregates.totalCalls > 0
    ? Math.round((aggregates.completedCalls / aggregates.totalCalls) * 100)
    : 0;

  const avgDuration = aggregates && aggregates.completedCalls > 0
    ? Math.round(aggregates.totalDurationSeconds / aggregates.completedCalls)
    : 0;

  const totalMinutes = aggregates ? Math.ceil(aggregates.totalDurationSeconds / 60) : 0;
  const totalUserCost = aggregates ? (aggregates.totalUserCostCents / 100) : 0;

  const loading = isLoading || usageLoading;

  if (loading && !aggregates) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 text-purple-500 animate-spin" />
      </div>
    );
  }

  const metricCards = [
    {
      label: 'Total Calls',
      value: aggregates?.totalCalls.toLocaleString() || '0',
      icon: Phone,
      gradient: 'from-purple-500 to-pink-500',
    },
    {
      label: 'Success Rate',
      value: `${successRate}%`,
      icon: CheckCircle,
      gradient: 'from-green-500 to-emerald-500',
    },
    {
      label: 'Avg First Response',
      value: aggregates?.avgLatencyMs ? `${(aggregates.avgLatencyMs / 1000).toFixed(1)}s` : '—',
      icon: Clock,
      gradient: 'from-blue-500 to-cyan-500',
    },
    {
      label: 'Total Cost',
      value: `$${totalUserCost.toFixed(2)}`,
      icon: DollarSign,
      gradient: 'from-orange-500 to-amber-500',
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-1">Analytics</h1>
          <p className="text-gray-500 dark:text-white/50">Track your voice agent performance</p>
        </div>
        <Select
          value={range}
          onChange={(v) => setRange(v as '7' | '14' | '30')}
          options={[
            { value: '7', label: 'Last 7 days' },
            { value: '14', label: 'Last 14 days' },
            { value: '30', label: 'Last 30 days' },
          ]}
          className="w-full sm:w-44"
          searchable={false}
        />
      </div>

      {/* Metrics Grid */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {metricCards.map((metric, i) => (
          <motion.div
            key={metric.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
            className="relative overflow-hidden bg-white border border-gray-200 dark:bg-white/[0.02] dark:border-white/5 rounded-2xl p-5 shadow-sm dark:shadow-none"
          >
            <div className={`absolute top-0 right-0 w-20 h-20 bg-gradient-to-br ${metric.gradient} opacity-10 blur-2xl`} />
            <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${metric.gradient} flex items-center justify-center mb-3`}>
              <metric.icon size={20} className="text-white" />
            </div>
            <p className="text-2xl font-bold text-gray-900 dark:text-white mb-1">{metric.value}</p>
            <p className="text-sm text-gray-500 dark:text-white/50">{metric.label}</p>
          </motion.div>
        ))}
      </div>

      {/* Charts Row */}
      <div className="grid lg:grid-cols-2 gap-6">
        {/* Call Volume Chart */}
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          className="bg-white border border-gray-200 dark:bg-white/[0.02] dark:border-white/5 rounded-2xl p-6 shadow-sm dark:shadow-none"
        >
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Call Volume</h2>
            <span className="text-sm text-gray-400 dark:text-white/40">{totalMinutes} min total</span>
          </div>
          {filteredDaily.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-gray-300 dark:text-white/30 text-sm">
              No data for this period
            </div>
          ) : (
            <>
              <div className="h-48 flex items-end gap-1">
                {filteredDaily.map((day, i) => {
                  const pct = (day.total_calls / maxCalls) * 100;
                  return (
                    <div key={day.date} className="flex-1 group relative flex flex-col items-center justify-end h-full">
                      <motion.div
                        initial={{ height: 0 }}
                        animate={{ height: `${Math.max(pct, 2)}%` }}
                        transition={{ delay: 0.1 + i * 0.03, duration: 0.4 }}
                        className="w-full bg-gradient-to-t from-purple-500 to-pink-500 rounded-t-sm opacity-80 hover:opacity-100 transition-opacity cursor-pointer min-h-[2px]"
                      />
                      {/* Tooltip */}
                      <div className="absolute bottom-full mb-2 hidden group-hover:block z-10">
                        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-white/10 rounded-lg px-3 py-2 text-xs whitespace-nowrap shadow-xl">
                          <p className="text-gray-900 dark:text-white font-medium">{day.date}</p>
                          <p className="text-gray-500 dark:text-white/60">{day.total_calls} calls · {day.total_minutes} min</p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="flex justify-between mt-3 text-xs text-gray-400 dark:text-white/40">
                <span>{filteredDaily[0]?.date?.slice(5)}</span>
                <span>{filteredDaily[filteredDaily.length - 1]?.date?.slice(5)}</span>
              </div>
            </>
          )}
        </motion.div>

        {/* Cost Trend Chart */}
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          className="bg-white border border-gray-200 dark:bg-white/[0.02] dark:border-white/5 rounded-2xl p-6 shadow-sm dark:shadow-none"
        >
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Daily Cost</h2>
            <span className="text-sm text-gray-400 dark:text-white/40">${totalUserCost.toFixed(2)} total</span>
          </div>
          {filteredDaily.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-gray-300 dark:text-white/30 text-sm">
              No data for this period
            </div>
          ) : (
            <>
              <div className="h-48 flex items-end gap-1">
                {filteredDaily.map((day, i) => {
                  const pct = (day.total_cost_cents / maxCost) * 100;
                  return (
                    <div key={day.date} className="flex-1 group relative flex flex-col items-center justify-end h-full">
                      <motion.div
                        initial={{ height: 0 }}
                        animate={{ height: `${Math.max(pct, 2)}%` }}
                        transition={{ delay: 0.1 + i * 0.03, duration: 0.4 }}
                        className="w-full bg-gradient-to-t from-blue-500 to-cyan-500 rounded-t-sm opacity-80 hover:opacity-100 transition-opacity cursor-pointer min-h-[2px]"
                      />
                      <div className="absolute bottom-full mb-2 hidden group-hover:block z-10">
                        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-white/10 rounded-lg px-3 py-2 text-xs whitespace-nowrap shadow-xl">
                          <p className="text-gray-900 dark:text-white font-medium">{day.date}</p>
                          <p className="text-gray-500 dark:text-white/60">${(day.total_cost_cents / 100).toFixed(2)} cost</p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="flex justify-between mt-3 text-xs text-white/40">
                <span>{filteredDaily[0]?.date?.slice(5)}</span>
                <span>{filteredDaily[filteredDaily.length - 1]?.date?.slice(5)}</span>
              </div>
            </>
          )}
        </motion.div>
      </div>

      {/* Call Direction Breakdown + Quick Stats */}
      <div className="grid lg:grid-cols-3 gap-6">
        {/* Direction Breakdown */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white border border-gray-200 dark:bg-white/[0.02] dark:border-white/5 rounded-2xl p-6 shadow-sm dark:shadow-none"
        >
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Call Breakdown</h2>
          <div className="space-y-4">
            {[
              { label: 'Web', count: aggregates?.web || 0, icon: Globe, color: 'bg-blue-500', textColor: 'text-blue-400' },
              { label: 'Inbound', count: aggregates?.inbound || 0, icon: PhoneIncoming, color: 'bg-green-500', textColor: 'text-green-400' },
              { label: 'Outbound', count: aggregates?.outbound || 0, icon: PhoneOutgoing, color: 'bg-purple-500', textColor: 'text-purple-400' },
            ].map((item) => {
              const pct = aggregates && aggregates.totalCalls > 0
                ? Math.round((item.count / aggregates.totalCalls) * 100)
                : 0;
              return (
                <div key={item.label} className="flex items-center gap-3">
                  <item.icon size={16} className={item.textColor} />
                  <div className="flex-1">
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-gray-600 dark:text-white/70">{item.label}</span>
                      <span className="text-gray-900 dark:text-white font-medium">{item.count} <span className="text-gray-400 dark:text-white/40 text-xs">({pct}%)</span></span>
                    </div>
                    <div className="h-1.5 bg-gray-100 dark:bg-white/5 rounded-full overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${pct}%` }}
                        transition={{ duration: 0.5 }}
                        className={`h-full ${item.color} rounded-full`}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </motion.div>

        {/* Quick Stats */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="lg:col-span-2 bg-white border border-gray-200 dark:bg-white/[0.02] dark:border-white/5 rounded-2xl p-6 shadow-sm dark:shadow-none"
        >
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Performance Summary</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="p-4 bg-gray-50 border border-gray-100 dark:bg-white/[0.02] dark:border-white/5 rounded-xl">
              <p className="text-sm text-gray-500 dark:text-white/50 mb-1">Avg Call Duration</p>
              <p className="text-xl font-bold text-gray-900 dark:text-white">
                {Math.floor(avgDuration / 60)}:{(avgDuration % 60).toString().padStart(2, '0')}
              </p>
            </div>
            <div className="p-4 bg-gray-50 border border-gray-100 dark:bg-white/[0.02] dark:border-white/5 rounded-xl">
              <p className="text-sm text-gray-500 dark:text-white/50 mb-1">Total Minutes</p>
              <p className="text-xl font-bold text-gray-900 dark:text-white">{totalMinutes.toLocaleString()}</p>
            </div>
            <div className="p-4 bg-gray-50 border border-gray-100 dark:bg-white/[0.02] dark:border-white/5 rounded-xl">
              <p className="text-sm text-gray-500 dark:text-white/50 mb-1">Completed Calls</p>
              <p className="text-xl font-bold text-gray-900 dark:text-white">{aggregates?.completedCalls.toLocaleString() || 0}</p>
            </div>
            <div className="p-4 bg-gray-50 border border-gray-100 dark:bg-white/[0.02] dark:border-white/5 rounded-xl">
              <p className="text-sm text-gray-500 dark:text-white/50 mb-1">Failed Calls</p>
              <p className="text-xl font-bold text-gray-900 dark:text-white">{aggregates?.failedCalls.toLocaleString() || 0}</p>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Daily Breakdown Table */}
      {filteredDaily.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white border border-gray-200 dark:bg-white/[0.02] dark:border-white/5 rounded-2xl overflow-hidden shadow-sm dark:shadow-none"
        >
          <div className="p-6 pb-4">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Daily Breakdown</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100 dark:border-white/5 bg-gray-50 dark:bg-white/[0.02]">
                  <th className="text-left text-xs font-medium text-gray-400 dark:text-white/40 uppercase tracking-wider p-4">Date</th>
                  <th className="text-left text-xs font-medium text-gray-400 dark:text-white/40 uppercase tracking-wider p-4">Calls</th>
                  <th className="text-left text-xs font-medium text-gray-400 dark:text-white/40 uppercase tracking-wider p-4">Minutes</th>
                  <th className="text-left text-xs font-medium text-gray-400 dark:text-white/40 uppercase tracking-wider p-4">Web</th>
                  <th className="text-left text-xs font-medium text-gray-400 dark:text-white/40 uppercase tracking-wider p-4">Inbound</th>
                  <th className="text-left text-xs font-medium text-gray-400 dark:text-white/40 uppercase tracking-wider p-4">Cost</th>
                </tr>
              </thead>
              <tbody>
                {[...filteredDaily].reverse().map((day) => (
                  <tr key={day.date} className="border-b border-gray-100 dark:border-white/5 hover:bg-gray-50 dark:hover:bg-white/[0.02] transition-colors">
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        <Calendar size={14} className="text-gray-300 dark:text-white/30" />
                        <span className="text-gray-900 dark:text-white text-sm">{day.date}</span>
                      </div>
                    </td>
                    <td className="p-4 text-gray-900 dark:text-white font-medium">{day.total_calls}</td>
                    <td className="p-4 text-gray-500 dark:text-white/60">{day.total_minutes}</td>
                    <td className="p-4 text-blue-500 dark:text-blue-400">{day.web_calls ?? '—'}</td>
                    <td className="p-4 text-green-500 dark:text-green-400">{day.inbound_calls ?? '—'}</td>
                    <td className="p-4 text-gray-500 dark:text-white/60 font-mono">${(day.total_cost_cents / 100).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </motion.div>
      )}
    </div>
  );
}
