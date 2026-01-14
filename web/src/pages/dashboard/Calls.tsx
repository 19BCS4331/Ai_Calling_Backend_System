import { useState } from 'react';
import { motion } from 'framer-motion';
import { Phone, PhoneIncoming, PhoneOutgoing, Search, Filter, Play, Download } from 'lucide-react';
import { Button } from '../../components/ui/Button';

const calls = [
  { id: '1', number: '+91 98765 43210', name: 'Rahul Sharma', duration: '4:32', type: 'inbound', status: 'completed', date: '2026-01-14 10:30' },
  { id: '2', number: '+91 87654 32109', name: 'Priya Patel', duration: '2:15', type: 'outbound', status: 'completed', date: '2026-01-14 09:45' },
  { id: '3', number: '+91 76543 21098', name: 'Amit Kumar', duration: '1:45', type: 'inbound', status: 'missed', date: '2026-01-14 09:20' },
  { id: '4', number: '+91 65432 10987', name: 'Sneha Reddy', duration: '5:20', type: 'inbound', status: 'completed', date: '2026-01-13 16:30' },
  { id: '5', number: '+91 54321 09876', name: 'Vikram Singh', duration: '3:10', type: 'outbound', status: 'completed', date: '2026-01-13 15:15' },
  { id: '6', number: '+91 43210 98765', name: 'Anita Desai', duration: '6:45', type: 'inbound', status: 'completed', date: '2026-01-13 14:00' },
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

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white mb-1">Call History</h1>
          <p className="text-white/60">View and manage your call records</p>
        </div>
        <Button>
          <Phone size={18} className="mr-2" />
          New Call
        </Button>
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
      <div className="glass-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/10">
                <th className="text-left text-sm font-medium text-white/60 p-4">Type</th>
                <th className="text-left text-sm font-medium text-white/60 p-4">Contact</th>
                <th className="text-left text-sm font-medium text-white/60 p-4">Duration</th>
                <th className="text-left text-sm font-medium text-white/60 p-4">Status</th>
                <th className="text-left text-sm font-medium text-white/60 p-4">Date</th>
                <th className="text-left text-sm font-medium text-white/60 p-4">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredCalls.map((call, i) => (
                <motion.tr
                  key={call.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: i * 0.05 }}
                  className="border-b border-white/5 hover:bg-white/5"
                >
                  <td className="p-4">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                      call.type === 'inbound' ? 'bg-neon-green/10' : 'bg-neon-purple/10'
                    }`}>
                      {call.type === 'inbound' ? (
                        <PhoneIncoming size={14} className="text-neon-green" />
                      ) : (
                        <PhoneOutgoing size={14} className="text-neon-purple" />
                      )}
                    </div>
                  </td>
                  <td className="p-4">
                    <p className="text-white font-medium">{call.name}</p>
                    <p className="text-sm text-white/50">{call.number}</p>
                  </td>
                  <td className="p-4 text-white/70">{call.duration}</td>
                  <td className="p-4">
                    <span className={`text-xs px-2.5 py-1 rounded-full ${
                      call.status === 'completed' ? 'bg-neon-green/10 text-neon-green' :
                      call.status === 'missed' ? 'bg-red-500/10 text-red-400' :
                      'bg-yellow-500/10 text-yellow-500'
                    }`}>
                      {call.status}
                    </span>
                  </td>
                  <td className="p-4 text-white/50 text-sm">{call.date}</td>
                  <td className="p-4">
                    <div className="flex gap-2">
                      <button className="p-2 text-white/50 hover:text-white hover:bg-white/5 rounded-lg">
                        <Play size={16} />
                      </button>
                      <button className="p-2 text-white/50 hover:text-white hover:bg-white/5 rounded-lg">
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
