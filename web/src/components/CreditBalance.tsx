import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Wallet, TrendingDown, AlertCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useOrganizationStore } from '../store/organization';

interface SubscriptionData {
  id: string;
  credit_balance_cents: number;
  credit_used_cents: number;
  plans: {
    name: string;
    slug: string;
    included_credit_cents: number;
    is_credit_based: boolean;
  };
}

export function CreditBalance() {
  const [subscription, setSubscription] = useState<SubscriptionData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const { currentOrganization } = useOrganizationStore();

  useEffect(() => {
    if (currentOrganization) {
      fetchSubscription();
    }
  }, [currentOrganization]);

  const fetchSubscription = async () => {
    if (!currentOrganization) return;

    try {
      setIsLoading(true);
      const { data, error } = await supabase
        .from('subscriptions')
        .select(`
          id,
          credit_balance_cents,
          credit_used_cents,
          plans (
            name,
            slug,
            included_credit_cents,
            is_credit_based
          )
        `)
        .eq('organization_id', currentOrganization.id)
        .in('status', ['active', 'trialing'])
        .single();

      if (error) throw error;
      setSubscription(data as any);
    } catch (error) {
      console.error('Failed to fetch subscription:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Only show for credit-based plans (trial)
  if (!subscription || !(subscription.plans as any)?.is_credit_based) {
    return null;
  }

  if(isLoading){
    return (
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-gradient-to-br from-purple-500/10 to-blue-500/10 border border-purple-500/20 rounded-xl p-4"
      >
        <div className="flex items-center gap-2 mb-2">
          <Wallet size={16} className="text-purple-400" />
          <span className="text-sm font-medium text-white/70">Credit Balance</span>
        </div>
        <div className="text-2xl font-bold text-white mb-1">Loading...</div>
        <div className="text-sm text-white/40">Checking your balance</div>
      </motion.div>
    );
  }

  const balance = subscription.credit_balance_cents / 100;
  const used = subscription.credit_used_cents / 100;
  const total = ((subscription.plans as any)?.included_credit_cents || 0) / 100;
  const percentUsed = total > 0 ? (used / total) * 100 : 0;
  const isLow = balance < 1; // Less than $1 remaining

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`bg-gradient-to-br ${
        isLow 
          ? 'from-red-500/10 to-orange-500/10 border-red-500/20' 
          : 'from-purple-500/10 to-blue-500/10 border-purple-500/20'
      } border rounded-xl p-4`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-lg ${
            isLow ? 'bg-red-500/20' : 'bg-purple-500/20'
          } flex items-center justify-center`}>
            {isLow ? (
              <AlertCircle size={20} className="text-red-400" />
            ) : (
              <Wallet size={20} className="text-purple-400" />
            )}
          </div>
          <div>
            <p className="text-sm text-white/60 mb-1">Trial Credit Balance</p>
            <p className="text-2xl font-bold text-white">
              ${balance.toFixed(2)}
              <span className="text-sm text-white/40 font-normal ml-2">
                of ${total.toFixed(2)}
              </span>
            </p>
          </div>
        </div>
        
        {isLow && (
          <button className="px-4 py-2 bg-gradient-to-r from-purple-600 to-purple-500 rounded-lg font-medium text-white text-sm hover:from-purple-500 hover:to-purple-400 transition-all duration-300">
            Upgrade Plan
          </button>
        )}
      </div>

      {/* Progress Bar */}
      <div className="mt-4">
        <div className="flex items-center justify-between text-xs text-white/40 mb-2">
          <span className="flex items-center gap-1">
            <TrendingDown size={12} />
            ${used.toFixed(2)} used
          </span>
          <span>{percentUsed.toFixed(0)}% consumed</span>
        </div>
        <div className="h-2 bg-white/5 rounded-full overflow-hidden">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${percentUsed}%` }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
            className={`h-full ${
              isLow 
                ? 'bg-gradient-to-r from-red-500 to-orange-500' 
                : 'bg-gradient-to-r from-purple-500 to-blue-500'
            }`}
          />
        </div>
      </div>

      {isLow && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          className="mt-3 p-3 bg-red-500/10 border border-red-500/20 rounded-lg"
        >
          <p className="text-sm text-red-400">
            ⚠️ Low balance! Your account will automatically switch to Pay-as-you-go ($0.15/min) when credit runs out.
          </p>
        </motion.div>
      )}
    </motion.div>
  );
}
