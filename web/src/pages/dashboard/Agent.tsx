import { motion } from 'framer-motion';
import { Bot, Save } from 'lucide-react';
import { VoiceDemo } from '../../components/voice/VoiceDemo';
import { Button } from '../../components/ui/Button';

export function Agent() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white mb-1">Voice Agent</h1>
        <p className="text-white/60">Configure and test your AI voice agent</p>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Configuration */}
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          className="glass-card p-6 space-y-5"
        >
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-neon-purple/10 flex items-center justify-center">
              <Bot size={20} className="text-neon-purple" />
            </div>
            <h2 className="text-lg font-semibold text-white">Agent Configuration</h2>
          </div>

          <div>
            <label className="block text-sm text-white/70 mb-2">Agent Name</label>
            <input
              type="text"
              defaultValue="Customer Support Agent"
              className="input-field"
            />
          </div>

          <div>
            <label className="block text-sm text-white/70 mb-2">Language</label>
            <select className="input-field">
              <option value="en-IN">English (India)</option>
              <option value="hi-IN">Hindi</option>
              <option value="ta-IN">Tamil</option>
              <option value="te-IN">Telugu</option>
              <option value="bn-IN">Bengali</option>
              <option value="mr-IN">Marathi</option>
            </select>
          </div>

          <div>
            <label className="block text-sm text-white/70 mb-2">Voice</label>
            <select className="input-field">
              <option value="anushka">Anushka (Female)</option>
              <option value="vidya">Vidya (Female)</option>
              <option value="abhilash">Abhilash (Male)</option>
              <option value="karun">Karun (Male)</option>
            </select>
          </div>

          <div>
            <label className="block text-sm text-white/70 mb-2">System Prompt</label>
            <textarea
              rows={6}
              className="input-field resize-none"
              defaultValue="You are a helpful AI assistant for customer support. Be friendly, professional, and concise. Help customers with their queries efficiently."
            />
          </div>

          <div className="flex gap-3">
            <Button className="flex-1">
              <Save size={18} className="mr-2" />
              Save Changes
            </Button>
            <Button variant="secondary">Reset</Button>
          </div>
        </motion.div>

        {/* Live Test */}
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
        >
          <h2 className="text-lg font-semibold text-white mb-4">Live Test</h2>
          <VoiceDemo />
        </motion.div>
      </div>
    </div>
  );
}
