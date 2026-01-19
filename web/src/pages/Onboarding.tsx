import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Building2, Zap, Check, ArrowRight, ArrowLeft } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/auth';
import { useOrganizationStore } from '../store/organization';

export function Onboarding() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const { fetchUserOrganizations, organizations } = useOrganizationStore();
  
  const [step, setStep] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  
  const [orgName, setOrgName] = useState('');
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);

  // Check if user already has an organization and redirect to dashboard
  useEffect(() => {
    const checkExistingOrganization = async () => {
      if (!user?.id) return;
      
      await fetchUserOrganizations();
    };

    checkExistingOrganization();
  }, [user?.id, fetchUserOrganizations]);

  // Redirect if user already has organizations
  useEffect(() => {
    if (organizations.length > 0) {
      navigate('/dashboard', { replace: true });
    }
  }, [organizations, navigate]);

  const plans = [
    {
      id: 'free',
      name: 'Trial',
      price: 0,
      minutes: 5,
      description: 'Perfect for testing',
      features: ['5 free minutes', '1 AI agent', 'Basic analytics', 'Email support'],
    },
    {
      id: 'starter',
      name: 'Starter',
      price: 79,
      minutes: 500,
      description: 'For small teams',
      features: ['500 minutes/month', '3 AI agents', 'Full analytics', '1 phone number', 'API access'],
    },
    {
      id: 'growth',
      name: 'Growth',
      price: 349,
      minutes: 2500,
      description: 'For growing businesses',
      features: ['2500 minutes/month', '10 AI agents', 'Advanced analytics', 'Webhooks', 'Priority support'],
    },
  ];

  const handleCreateOrganization = async () => {
    if (!orgName.trim()) {
      setError('Please enter an organization name');
      return;
    }

    if (!selectedPlan) {
      setError('Please select a plan');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      // Verify user is authenticated
      const { data: { session } } = await supabase.auth.getSession();
      if (!session || !user?.id) {
        throw new Error('Not authenticated. Please log in again.');
      }

      // Get the selected plan ID
      const { data: planData, error: planError } = await supabase
        .from('plans')
        .select('id')
        .eq('tier', selectedPlan)
        .single();

      if (planError) throw planError;

      // Create organization slug
      const slug = orgName
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '') + '-' + Math.random().toString(36).substring(2, 10);

      // Call the database function to create organization with subscription
      const { data, error } = await supabase.rpc('create_organization_with_subscription', {
        p_user_id: user.id,
        p_org_name: orgName,
        p_org_slug: slug,
        p_plan_id: planData.id,
      });

      if (error) throw error;

      // Refresh organizations
      await fetchUserOrganizations();

      // Navigate to dashboard
      navigate('/dashboard');
    } catch (err) {
      console.error('Onboarding error:', err);
      setError(err instanceof Error ? err.message : 'Failed to create organization');
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center p-6">
      <div className="w-full max-w-4xl">
        {/* Progress indicator */}
        <div className="flex items-center justify-center mb-12">
          <div className="flex items-center gap-4">
            {[1, 2].map((s) => (
              <div key={s} className="flex items-center gap-4">
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center font-medium transition-all ${
                    step >= s
                      ? 'bg-gradient-to-r from-purple-600 to-purple-500 text-white'
                      : 'bg-white/5 text-white/30'
                  }`}
                >
                  {step > s ? <Check size={20} /> : s}
                </div>
                {s < 2 && (
                  <div
                    className={`w-16 h-0.5 transition-all ${
                      step > s ? 'bg-purple-500' : 'bg-white/10'
                    }`}
                  />
                )}
              </div>
            ))}
          </div>
        </div>

        <AnimatePresence mode="wait">
          {step === 1 && (
            <motion.div
              key="step1"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="bg-white/[0.02] border border-white/10 rounded-2xl p-8"
            >
              <div className="flex items-center gap-3 mb-6">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
                  <Building2 size={24} className="text-white" />
                </div>
                <div>
                  <h1 className="text-2xl font-bold text-white">Create your organization</h1>
                  <p className="text-white/50">Let's get you set up with VocaCore AI</p>
                </div>
              </div>

              <div className="space-y-6">
                <div>
                  <label className="block text-sm text-white/60 mb-2">Organization name</label>
                  <input
                    type="text"
                    value={orgName}
                    onChange={(e) => setOrgName(e.target.value)}
                    placeholder="e.g., Acme Inc"
                    className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/30 focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/20 transition-all"
                  />
                </div>

                {error && (
                  <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl">
                    <p className="text-red-400 text-sm text-center">{error}</p>
                  </div>
                )}

                <button
                  onClick={() => {
                    if (!orgName.trim()) {
                      setError('Please enter an organization name');
                      return;
                    }
                    setError('');
                    setStep(2);
                  }}
                  className="w-full py-3 bg-gradient-to-r from-purple-600 to-purple-500 rounded-xl font-medium text-white hover:from-purple-500 hover:to-purple-400 transition-all duration-300 shadow-lg shadow-purple-500/25 flex items-center justify-center gap-2"
                >
                  Continue
                  <ArrowRight size={18} />
                </button>
              </div>
            </motion.div>
          )}

          {step === 2 && (
            <motion.div
              key="step2"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="bg-white/[0.02] border border-white/10 rounded-2xl p-8"
            >
              <div className="flex items-center gap-3 mb-6">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
                  <Zap size={24} className="text-white" />
                </div>
                <div>
                  <h1 className="text-2xl font-bold text-white">Choose your plan</h1>
                  <p className="text-white/50">Select the plan that fits your needs</p>
                </div>
              </div>

              <div className="grid md:grid-cols-3 gap-4 mb-6">
                {plans.map((plan) => (
                  <motion.button
                    key={plan.id}
                    onClick={() => setSelectedPlan(plan.id)}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    className={`p-6 rounded-xl border-2 transition-all text-left ${
                      selectedPlan === plan.id
                        ? 'border-purple-500 bg-purple-500/10'
                        : 'border-white/10 bg-white/[0.02] hover:border-white/20'
                    }`}
                  >
                    <div className="flex items-start justify-between mb-4">
                      <div>
                        <h3 className="text-lg font-bold text-white">{plan.name}</h3>
                        <p className="text-sm text-white/50">{plan.description}</p>
                      </div>
                      {selectedPlan === plan.id && (
                        <div className="w-6 h-6 rounded-full bg-purple-500 flex items-center justify-center">
                          <Check size={14} className="text-white" />
                        </div>
                      )}
                    </div>

                    <div className="mb-4">
                      <span className="text-3xl font-bold text-white">
                        ${plan.price}
                      </span>
                      <span className="text-white/50 text-sm">/month</span>
                    </div>

                    <ul className="space-y-2">
                      {plan.features.map((feature) => (
                        <li key={feature} className="flex items-center gap-2 text-sm text-white/60">
                          <Check size={14} className="text-purple-400" />
                          {feature}
                        </li>
                      ))}
                    </ul>
                  </motion.button>
                ))}
              </div>

              {error && (
                <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl mb-6">
                  <p className="text-red-400 text-sm text-center">{error}</p>
                </div>
              )}

              <div className="flex gap-4">
                <button
                  onClick={() => setStep(1)}
                  disabled={isLoading}
                  className="px-6 py-3 bg-white/5 border border-white/10 rounded-xl font-medium text-white hover:bg-white/10 transition-all flex items-center gap-2"
                >
                  <ArrowLeft size={18} />
                  Back
                </button>
                <button
                  onClick={handleCreateOrganization}
                  disabled={isLoading || !selectedPlan}
                  className="flex-1 py-3 bg-gradient-to-r from-purple-600 to-purple-500 rounded-xl font-medium text-white hover:from-purple-500 hover:to-purple-400 transition-all duration-300 shadow-lg shadow-purple-500/25 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {isLoading ? (
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <>
                      Get Started
                      <ArrowRight size={18} />
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
