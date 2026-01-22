import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Phone, Check, AlertCircle, Loader2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useOrganizationStore } from '../../store/organization';
import { useToast } from '../../hooks/useToast';

interface PlivoStatus {
  connected: boolean;
  appId: string | null;
  authId: string | null;
  numberCount: number;
}

export function TelephonySettings() {
  const [authId, setAuthId] = useState('');
  const [authToken, setAuthToken] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isFetching, setIsFetching] = useState(true);
  const [status, setStatus] = useState<PlivoStatus | null>(null);
  const { currentOrganization } = useOrganizationStore();
  const toast = useToast();

  useEffect(() => {
    fetchStatus();
  }, [currentOrganization]);

  const fetchStatus = async () => {
    if (!currentOrganization) return;

    try {
      setIsFetching(true);
      const { data: { session } } = await supabase.auth.getSession();
      
      const response = await fetch(
        `/api/v1/orgs/${currentOrganization.id}/telephony/plivo/status`,
        {
          headers: {
            'Authorization': `Bearer ${session?.access_token}`,
            'Content-Type': 'application/json'
          }
        }
      );

      if (response.ok) {
        const data = await response.json();
        setStatus(data);
      }
    } catch (error) {
      console.error('Failed to fetch Plivo status:', error);
    } finally {
      setIsFetching(false);
    }
  };

  const handleConnect = async () => {
    if (!authId || !authToken) {
      toast.error('Please enter both Auth ID and Auth Token');
      return;
    }

    if (!currentOrganization) {
      toast.error('No organization selected');
      return;
    }

    try {
      setIsLoading(true);
      const { data: { session } } = await supabase.auth.getSession();

      const response = await fetch(
        `/api/v1/orgs/${currentOrganization.id}/telephony/plivo/connect`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session?.access_token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ authId, authToken })
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to connect Plivo account');
      }

      const result = await response.json();
      toast.success(result.message || 'Plivo account connected successfully');
      
      // Clear form
      setAuthId('');
      setAuthToken('');
      
      // Refresh status
      await fetchStatus();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to connect Plivo account');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDisconnect = async () => {
    if (!currentOrganization) return;

    try {
      setIsLoading(true);
      const { data: { session } } = await supabase.auth.getSession();

      const response = await fetch(
        `/api/v1/orgs/${currentOrganization.id}/telephony/plivo/disconnect`,
        {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${session?.access_token}`,
            'Content-Type': 'application/json'
          }
        }
      );

      if (!response.ok) {
        throw new Error('Failed to disconnect Plivo account');
      }

      toast.success('Plivo account disconnected successfully');
      await fetchStatus();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to disconnect Plivo account');
    } finally {
      setIsLoading(false);
    }
  };

  if (isFetching) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 text-purple-500 animate-spin" />
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white/[0.02] border border-white/5 rounded-2xl p-6"
    >
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-green-500 to-emerald-500 flex items-center justify-center">
          <Phone size={20} className="text-white" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-white">Plivo Integration</h2>
          <p className="text-sm text-white/50">Connect your Plivo account for phone calling</p>
        </div>
      </div>

      {status?.connected ? (
        <div className="space-y-4">
          <div className="p-4 bg-green-500/10 border border-green-500/20 rounded-xl">
            <div className="flex items-start gap-3">
              <Check size={20} className="text-green-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-white font-medium mb-1">Connected</p>
                <p className="text-sm text-white/60">
                  Account: <span className="font-mono">{status.authId}</span>
                </p>
                <p className="text-sm text-white/60">
                  Application ID: <span className="font-mono">{status.appId}</span>
                </p>
                <p className="text-sm text-white/60">
                  Phone Numbers: {status.numberCount}
                </p>
              </div>
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => window.location.href = '/dashboard/phone-numbers'}
              className="px-4 py-2 bg-purple-600 hover:bg-purple-500 rounded-lg text-white font-medium transition-colors"
            >
              Manage Numbers
            </button>
            <button
              onClick={handleDisconnect}
              disabled={isLoading}
              className="px-4 py-2 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 rounded-lg text-red-400 font-medium transition-colors disabled:opacity-50"
            >
              {isLoading ? 'Disconnecting...' : 'Disconnect'}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="p-4 bg-blue-500/10 border border-blue-500/20 rounded-xl">
            <div className="flex items-start gap-3">
              <AlertCircle size={20} className="text-blue-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-white font-medium mb-1">Not Connected</p>
                <p className="text-sm text-white/60">
                  Connect your Plivo account to enable phone calling features.
                </p>
              </div>
            </div>
          </div>

          <div>
            <label className="block text-sm text-white/60 mb-2">Plivo Auth ID</label>
            <input
              type="text"
              value={authId}
              onChange={(e) => setAuthId(e.target.value)}
              className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/30 focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/20 transition-all"
              placeholder="MAXXXXXXXXXXXXXXXXXX"
            />
          </div>

          <div>
            <label className="block text-sm text-white/60 mb-2">Plivo Auth Token</label>
            <input
              type="password"
              value={authToken}
              onChange={(e) => setAuthToken(e.target.value)}
              className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/30 focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/20 transition-all"
              placeholder="••••••••••••••••••••"
            />
          </div>

          <button
            onClick={handleConnect}
            disabled={isLoading || !authId || !authToken}
            className="px-6 py-2.5 bg-gradient-to-r from-purple-600 to-purple-500 rounded-xl font-medium text-white hover:from-purple-500 hover:to-purple-400 transition-all duration-300 shadow-lg shadow-purple-500/25 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {isLoading ? (
              <>
                <Loader2 size={18} className="animate-spin" />
                Connecting...
              </>
            ) : (
              <>
                <Check size={18} />
                Connect Plivo Account
              </>
            )}
          </button>

          <p className="text-xs text-white/40">
            Find your Auth ID and Auth Token in your{' '}
            <a
              href="https://console.plivo.com/dashboard/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-purple-400 hover:underline"
            >
              Plivo Console
            </a>
          </p>
        </div>
      )}
    </motion.div>
  );
}
