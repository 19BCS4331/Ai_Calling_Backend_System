import { useState } from 'react';
import { motion } from 'framer-motion';
import { Key, Bell, Shield, Save } from 'lucide-react';
import { Button } from '../../components/ui/Button';

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
        <h1 className="text-2xl font-bold text-white mb-1">Settings</h1>
        <p className="text-white/60">Manage your account and API configurations</p>
      </div>

      {/* API Keys */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-card p-6"
      >
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-neon-blue/10 flex items-center justify-center">
            <Key size={20} className="text-neon-blue" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-white">API Keys</h2>
            <p className="text-sm text-white/50">Configure your provider API keys</p>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm text-white/70 mb-2">Sarvam API Key (STT/TTS)</label>
            <input
              type="password"
              value={apiKeys.sarvam}
              onChange={(e) => setApiKeys(k => ({ ...k, sarvam: e.target.value }))}
              className="input-field"
              placeholder="sk_..."
            />
          </div>

          <div>
            <label className="block text-sm text-white/70 mb-2">Gemini API Key (LLM)</label>
            <input
              type="password"
              value={apiKeys.gemini}
              onChange={(e) => setApiKeys(k => ({ ...k, gemini: e.target.value }))}
              className="input-field"
              placeholder="AIza..."
            />
          </div>

          <div>
            <label className="block text-sm text-white/70 mb-2">Cartesia API Key (Optional TTS)</label>
            <input
              type="password"
              value={apiKeys.cartesia}
              onChange={(e) => setApiKeys(k => ({ ...k, cartesia: e.target.value }))}
              className="input-field"
              placeholder="sk_cart_..."
            />
          </div>

          <Button onClick={handleSave}>
            <Save size={18} className="mr-2" />
            {saved ? 'Saved!' : 'Save API Keys'}
          </Button>
        </div>
      </motion.div>

      {/* Notifications */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="glass-card p-6"
      >
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-neon-purple/10 flex items-center justify-center">
            <Bell size={20} className="text-neon-purple" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-white">Notifications</h2>
            <p className="text-sm text-white/50">Manage notification preferences</p>
          </div>
        </div>

        <div className="space-y-4">
          {notifications.map((item) => (
            <div key={item.id} className="flex items-center justify-between p-3 bg-dark-800/30 rounded-xl">
              <div>
                <p className="text-white font-medium">{item.label}</p>
                <p className="text-sm text-white/50">{item.description}</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" defaultChecked={item.enabled} className="sr-only peer" />
                <div className="w-11 h-6 bg-dark-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-neon-blue"></div>
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
        className="glass-card p-6"
      >
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-neon-green/10 flex items-center justify-center">
            <Shield size={20} className="text-neon-green" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-white">Security</h2>
            <p className="text-sm text-white/50">Account security settings</p>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm text-white/70 mb-2">Current Password</label>
            <input type="password" className="input-field" placeholder="••••••••" />
          </div>
          <div>
            <label className="block text-sm text-white/70 mb-2">New Password</label>
            <input type="password" className="input-field" placeholder="••••••••" />
          </div>
          <Button variant="secondary">Update Password</Button>
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
