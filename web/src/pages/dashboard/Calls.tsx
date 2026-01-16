import { useState } from 'react';
import { motion } from 'framer-motion';
import { Phone, PhoneIncoming, PhoneOutgoing, Search, Play, Download, Clock, TrendingUp } from 'lucide-react';

const calls = [
  { id: '1', number: '+91 98765 43210', name: 'Rahul Sharma', duration: '4:32', type: 'inbound', status: 'completed', date: '2026-01-14 10:30', cost: 0.45 },
  { id: '2', number: '+91 87654 32109', name: 'Priya Patel', duration: '2:15', type: 'outbound', status: 'completed', date: '2026-01-14 09:45', cost: 0.28 },
  { id: '3', number: '+91 76543 21098', name: 'Amit Kumar', duration: '1:45', type: 'inbound', status: 'missed', date: '2026-01-14 09:20', cost: 0 },
  { id: '4', number: '+91 65432 10987', name: 'Sneha Reddy', duration: '5:20', type: 'inbound', status: 'completed', date: '2026-01-13 16:30', cost: 0.62 },
  { id: '5', number: '+91 54321 09876', name: 'Vikram Singh', duration: '3:10', type: 'outbound', status: 'completed', date: '2026-01-13 15:15', cost: 0.38 },
  { id: '6', number: '+91 43210 98765', name: 'Anita Desai', duration: '6:45', type: 'inbound', status: 'completed', date: '2026-01-13 14:00', cost: 0.78 },
];

export function Calls() {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');

  const filteredCalls = calls.filter(call => {
    const matchesSearch = call.name.toLowerCase().includes(search.toLowerCase()) ||
                         call.number.includes(search);
    const matchesFilter = filter === 'all' || call.type === filter;
    return matchesSearch && matchesFilter;
  });

  // Stats calculations
  const totalCalls = calls.length;
  const completedCalls = calls.filter(c => c.status === 'completed').length;
  const totalCost = calls.reduce((sum, c) => sum + c.cost, 0);

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
            <p className="text-sm text-white/40">Total Calls</p>
          </div>
        </div>
        <div className="bg-white/[0.02] border border-white/5 rounded-xl p-4 flex items-center gap-4">
          <div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center">
            <TrendingUp size={18} className="text-green-400" />
          </div>
          <div>
            <p className="text-2xl font-bold text-white">{Math.round((completedCalls / totalCalls) * 100)}%</p>
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
            placeholder="Search by name or number..."
            className="input-field pl-11"
          />
        </div>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="input-field w-full sm:w-40"
        >
          <option value="all">All Calls</option>
          <option value="inbound">Inbound</option>
          <option value="outbound">Outbound</option>
        </select>
      </div>

      {/* Calls Table */}
      <div className="bg-white/[0.02] border border-white/5 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/5 bg-white/[0.02]">
                <th className="text-left text-xs font-medium text-white/40 uppercase tracking-wider p-4">Type</th>
                <th className="text-left text-xs font-medium text-white/40 uppercase tracking-wider p-4">Contact</th>
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
                  transition={{ delay: i * 0.05 }}
                  className="border-b border-white/5 hover:bg-white/[0.02] transition-colors"
                >
                  <td className="p-4">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                      call.type === 'inbound' 
                        ? 'bg-green-500/10 border border-green-500/20' 
                        : 'bg-purple-500/10 border border-purple-500/20'
                    }`}>
                      {call.type === 'inbound' ? (
                        <PhoneIncoming size={14} className="text-green-400" />
                      ) : (
                        <PhoneOutgoing size={14} className="text-purple-400" />
                      )}
                    </div>
                  </td>
                  <td className="p-4">
                    <p className="text-white font-medium">{call.name}</p>
                    <p className="text-sm text-white/40">{call.number}</p>
                  </td>
                  <td className="p-4 text-white/60 font-mono">{call.duration}</td>
                  <td className="p-4">
                    <span className={`text-xs px-2.5 py-1 rounded-full border ${
                      call.status === 'completed' 
                        ? 'bg-green-500/10 text-green-400 border-green-500/20' 
                        : call.status === 'missed' 
                        ? 'bg-red-500/10 text-red-400 border-red-500/20' 
                        : 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20'
                    }`}>
                      {call.status}
                    </span>
                  </td>
                  <td className="p-4 text-white/60 font-mono">${call.cost.toFixed(2)}</td>
                  <td className="p-4 text-white/40 text-sm">{call.date}</td>
                  <td className="p-4">
                    <div className="flex gap-1">
                      <button className="p-2 text-white/40 hover:text-purple-400 hover:bg-purple-500/10 rounded-lg transition-colors">
                        <Play size={16} />
                      </button>
                      <button className="p-2 text-white/40 hover:text-purple-400 hover:bg-purple-500/10 rounded-lg transition-colors">
                        <Download size={16} />
                      </button>
                    </div>
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
