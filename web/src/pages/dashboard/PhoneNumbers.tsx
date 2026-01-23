import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Phone, RefreshCw, Unlink, Loader2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useOrganizationStore } from '../../store/organization';
import { useToast } from '../../hooks/useToast';
import { saasApi, saasEndpoints } from '../../lib/api';

interface PhoneNumber {
  id: string;
  phone_number: string;
  country_code: string;
  agent_id: string | null;
  capabilities: {
    voice: boolean;
    sms: boolean;
  };
  agent?: {
    id: string;
    name: string;
    slug: string;
  };
}

interface Agent {
  id: string;
  name: string;
  slug: string;
  status: string;
}

export function PhoneNumbers() {
  const [phoneNumbers, setPhoneNumbers] = useState<PhoneNumber[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [linkingNumberId, setLinkingNumberId] = useState<string | null>(null);
  const { currentOrganization } = useOrganizationStore();
  const toast = useToast();

  useEffect(() => {
    if (currentOrganization) {
      fetchPhoneNumbers();
      fetchAgents();
    }
  }, [currentOrganization]);

  const fetchPhoneNumbers = async () => {
    if (!currentOrganization) return;

    try {
      const { data: { session } } = await supabase.auth.getSession();
      
      const data = await saasApi.get<{ phone_numbers: PhoneNumber[] }>(
        saasEndpoints.phoneNumbers(currentOrganization.id),
        session?.access_token
      );
      
      setPhoneNumbers(data.phone_numbers || []);
    } catch (error) {
      console.error('Failed to fetch phone numbers:', error);
      toast.error('Failed to load phone numbers');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchAgents = async () => {
    if (!currentOrganization) return;

    try {
      const { data: { session } } = await supabase.auth.getSession();
      
      const data = await saasApi.get<{ data: Agent[] }>(
        saasEndpoints.agents(currentOrganization.id),
        session?.access_token
      );
      
      // API returns { data: [...], pagination: {...} }
      setAgents(data.data || []);
    } catch (error) {
      console.error('Failed to fetch agents:', error);
    }
  };

  const handleSync = async () => {
    if (!currentOrganization) return;

    try {
      setIsSyncing(true);
      const { data: { session } } = await supabase.auth.getSession();

      const result = await saasApi.post<{ message: string }>(
        saasEndpoints.phoneNumbersSync(currentOrganization.id),
        undefined,
        session?.access_token
      );
      
      toast.success(result.message);
      await fetchPhoneNumbers();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to sync phone numbers');
    } finally {
      setIsSyncing(false);
    }
  };

  const handleLinkAgent = async (numberId: string, agentId: string) => {
    if (!currentOrganization) return;

    try {
      setLinkingNumberId(numberId);
      const { data: { session } } = await supabase.auth.getSession();

      await saasApi.post(
        saasEndpoints.phoneNumberLink(currentOrganization.id, numberId),
        { agent_id: agentId },
        session?.access_token
      );
      
      toast.success('Agent linked successfully');
      await fetchPhoneNumbers();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to link agent');
    } finally {
      setLinkingNumberId(null);
    }
  };

  const handleUnlink = async (numberId: string) => {
    if (!currentOrganization) return;

    try {
      setLinkingNumberId(numberId);
      const { data: { session } } = await supabase.auth.getSession();

      await saasApi.delete(
        saasEndpoints.phoneNumberLink(currentOrganization.id, numberId),
        session?.access_token
      );
      
      toast.success('Agent unlinked successfully');
      await fetchPhoneNumbers();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to unlink agent');
    } finally {
      setLinkingNumberId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 text-purple-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white mb-1">Phone Numbers</h1>
          <p className="text-white/50">Manage your phone numbers and link them to agents</p>
        </div>
        <button
          onClick={handleSync}
          disabled={isSyncing}
          className="px-4 py-2 bg-gradient-to-r from-purple-600 to-purple-500 rounded-lg font-medium text-white hover:from-purple-500 hover:to-purple-400 transition-all duration-300 flex items-center gap-2 disabled:opacity-50"
        >
          {isSyncing ? (
            <>
              <Loader2 size={18} className="animate-spin" />
              Syncing...
            </>
          ) : (
            <>
              <RefreshCw size={18} />
              Sync from Plivo
            </>
          )}
        </button>
      </div>

      {phoneNumbers.length === 0 ? (
        <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-12 text-center">
          <Phone size={48} className="mx-auto text-white/20 mb-4" />
          <h3 className="text-lg font-semibold text-white mb-2">No Phone Numbers</h3>
          <p className="text-white/50 mb-6">
            Connect your Plivo account in Settings and sync your phone numbers to get started.
          </p>
          <button
            onClick={() => window.location.href = '/dashboard/settings'}
            className="px-6 py-2.5 bg-purple-600 hover:bg-purple-500 rounded-lg text-white font-medium transition-colors"
          >
            Go to Settings
          </button>
        </div>
      ) : (
        <div className="grid gap-4">
          {phoneNumbers.map((number, i) => (
            <motion.div
              key={number.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className="bg-white/[0.02] border border-white/5 rounded-xl p-6 hover:bg-white/[0.04] transition-colors"
            >
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <Phone size={20} className="text-purple-400" />
                    <h3 className="text-lg font-semibold text-white">{number.phone_number}</h3>
                    <span className="px-2 py-1 bg-white/5 rounded text-xs text-white/60">
                      {number.country_code}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 text-sm text-white/50">
                    <span>Voice: {number.capabilities.voice ? '✓' : '✗'}</span>
                    <span>SMS: {number.capabilities.sms ? '✓' : '✗'}</span>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  {number.agent ? (
                    <>
                      <div className="px-4 py-2.5 bg-green-500/10 border border-green-500/20 rounded-xl">
                        <p className="text-xs text-green-400 mb-0.5">Linked to</p>
                        <p className="text-sm font-medium text-white">{number.agent.name}</p>
                      </div>
                      <button
                        onClick={() => handleUnlink(number.id)}
                        disabled={linkingNumberId === number.id}
                        className="p-2.5 text-red-400 hover:bg-red-500/10 rounded-xl transition-colors disabled:opacity-50 border border-transparent hover:border-red-500/20"
                        title="Unlink agent"
                      >
                        {linkingNumberId === number.id ? (
                          <Loader2 size={18} className="animate-spin" />
                        ) : (
                          <Unlink size={18} />
                        )}
                      </button>
                    </>
                  ) : (
                    <div className="flex items-center gap-2">
                      {linkingNumberId === number.id ? (
                        <div className="flex items-center gap-2 px-4 py-2.5 bg-purple-500/10 border border-purple-500/20 rounded-xl">
                          <Loader2 size={18} className="text-purple-400 animate-spin" />
                          <span className="text-sm text-white">Linking...</span>
                        </div>
                      ) : agents.filter(a => a.status === 'active').length === 0 ? (
                        <div className="px-4 py-2.5 bg-yellow-500/10 border border-yellow-500/20 rounded-xl">
                          <p className="text-sm text-yellow-400">No active agents</p>
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {agents
                            .filter(a => a.status === 'active')
                            .map(agent => (
                              <button
                                key={agent.id}
                                onClick={() => handleLinkAgent(number.id, agent.id)}
                                className="px-4 py-2.5 bg-white/5 hover:bg-purple-500/20 border border-white/10 hover:border-purple-500/50 rounded-xl text-sm text-white font-medium transition-all duration-200 hover:shadow-lg hover:shadow-purple-500/20"
                              >
                                Link to {agent.name}
                              </button>
                            ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
