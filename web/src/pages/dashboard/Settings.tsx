import { useState } from 'react';
import { motion } from 'framer-motion';
import { Key, Bell, Shield, Save, Check } from 'lucide-react';
import { TelephonySettings } from '../../components/settings/TelephonySettings';

export function Settings() {
  const [apiKeys, setApiKeys] = useState({
    sarvam: localStorage.getItem('vocaai_sarvam_key') || '',
    gemini: localStorage.getItem('vocaai_gemini_key') || '',
    cartesia: localStorage.getItem('vocaai_cartesia_key') || '',
  });
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    localStorage.setItem('vocaai_sarvam_key', apiKeys.sarvam);
    localStorage.setItem('vocaai_gemini_key', apiKeys.gemini);
    localStorage.setItem('vocaai_cartesia_key', apiKeys.cartesia);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-1">Settings</h1>
        <p className="text-gray-500 dark:text-white/50">Manage your account and API configurations</p>
      </div>

      {/* API Keys */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white border border-gray-200 dark:bg-white/[0.02] dark:border-white/5 rounded-2xl p-6 shadow-sm dark:shadow-none"
      >
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center">
            <Key size={20} className="text-white" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">API Keys</h2>
            <p className="text-sm text-gray-500 dark:text-white/50">Configure your provider API keys</p>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm text-gray-600 dark:text-white/60 mb-2">Sarvam API Key (STT/TTS)</label>
            <input
              type="password"
              value={apiKeys.sarvam}
              onChange={(e) => setApiKeys(k => ({ ...k, sarvam: e.target.value }))}
              className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/20 dark:bg-white/5 dark:border-white/10 dark:text-white dark:placeholder-white/30 transition-all"
              placeholder="sk_..."
            />
          </div>

          <div>
            <label className="block text-sm text-gray-600 dark:text-white/60 mb-2">Gemini API Key (LLM)</label>
            <input
              type="password"
              value={apiKeys.gemini}
              onChange={(e) => setApiKeys(k => ({ ...k, gemini: e.target.value }))}
              className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/20 dark:bg-white/5 dark:border-white/10 dark:text-white dark:placeholder-white/30 transition-all"
              placeholder="AIza..."
            />
          </div>

          <div>
            <label className="block text-sm text-gray-600 dark:text-white/60 mb-2">Cartesia API Key (Optional TTS)</label>
            <input
              type="password"
              value={apiKeys.cartesia}
              onChange={(e) => setApiKeys(k => ({ ...k, cartesia: e.target.value }))}
              className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/20 dark:bg-white/5 dark:border-white/10 dark:text-white dark:placeholder-white/30 transition-all"
              placeholder="sk_cart_..."
            />
          </div>

          <button 
            onClick={handleSave}
            className="px-6 py-2.5 bg-gradient-to-r from-purple-600 to-purple-500 rounded-xl font-medium text-white hover:from-purple-500 hover:to-purple-400 transition-all duration-300 shadow-lg shadow-purple-500/25 flex items-center gap-2"
          >
            {saved ? <Check size={18} /> : <Save size={18} />}
            {saved ? 'Saved!' : 'Save API Keys'}
          </button>
        </div>
      </motion.div>

      {/* Telephony Integration */}
      <TelephonySettings />

      {/* Notifications */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="bg-white border border-gray-200 dark:bg-white/[0.02] dark:border-white/5 rounded-2xl p-6 shadow-sm dark:shadow-none"
      >
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
            <Bell size={20} className="text-white" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Notifications</h2>
            <p className="text-sm text-gray-500 dark:text-white/50">Manage notification preferences</p>
          </div>
        </div>

        <div className="space-y-4">
          {notifications.map((item) => (
            <div key={item.id} className="flex items-center justify-between p-4 bg-gray-50 border border-gray-100 dark:bg-white/[0.02] dark:border-white/5 rounded-xl">
              <div>
                <p className="text-gray-900 dark:text-white font-medium">{item.label}</p>
                <p className="text-sm text-gray-500 dark:text-white/50">{item.description}</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" defaultChecked={item.enabled} className="sr-only peer" />
                <div className="w-11 h-6 bg-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-500"></div>
              </label>
            </div>
          ))}
        </div>
      </motion.div>

      {/* Security */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="bg-white border border-gray-200 dark:bg-white/[0.02] dark:border-white/5 rounded-2xl p-6 shadow-sm dark:shadow-none"
      >
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-green-500 to-emerald-500 flex items-center justify-center">
            <Shield size={20} className="text-white" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Security</h2>
            <p className="text-sm text-gray-500 dark:text-white/50">Account security settings</p>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm text-gray-600 dark:text-white/60 mb-2">Current Password</label>
            <input 
              type="password" 
              className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/20 dark:bg-white/5 dark:border-white/10 dark:text-white dark:placeholder-white/30 transition-all" 
              placeholder="••••••••" 
            />
          </div>
          <div>
            <label className="block text-sm text-gray-600 dark:text-white/60 mb-2">New Password</label>
            <input 
              type="password" 
              className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/20 dark:bg-white/5 dark:border-white/10 dark:text-white dark:placeholder-white/30 transition-all" 
              placeholder="••••••••" 
            />
          </div>
          <button className="px-6 py-2.5 bg-gray-100 border border-gray-200 dark:bg-white/5 dark:border-white/10 rounded-xl font-medium text-gray-700 dark:text-white hover:bg-gray-200 dark:hover:bg-white/10 transition-all">
            Update Password
          </button>
        </div>
      </motion.div>
    </div>
  );
}

const notifications = [
  { id: 'calls', label: 'Call Alerts', description: 'Get notified for missed calls', enabled: true },
  { id: 'reports', label: 'Daily Reports', description: 'Receive daily performance summaries', enabled: true },
  { id: 'updates', label: 'Product Updates', description: 'News about new features', enabled: false },
];
