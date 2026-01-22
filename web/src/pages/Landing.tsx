import { useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { 
  Zap, Phone, Bot, BarChart3, Globe, Shield, 
  Headphones, Building2, Wallet, Clock, ArrowRight,
  ChevronDown, Play, Check, X, Calculator, Minus, Plus
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { Navbar } from '../components/layout/Navbar';
import { VoiceDemo } from '../components/voice/VoiceDemo';
import { GlowingEffect } from '../components/ui/GlowingEffect';
import VocaCoreAILogo from '../assets/VocaCore-final-square.png';

const fadeInUp = {
  initial: { opacity: 0, y: 30 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.6 }
};

const stagger = {
  animate: { transition: { staggerChildren: 0.1 } }
};

export function Landing() {
  const [minutes, setMinutes] = useState(1000);
  const [billingInterval, setBillingInterval] = useState<'monthly' | 'yearly'>('monthly');
  const [titleNumber, setTitleNumber] = useState(0);

  // Animated rotating words for hero
  const heroWords = useMemo(
    () => ["Sales Calls", "Support Calls", "Appointment Booking", "Lead Qualification", "Payment Reminders"],
    []
  );

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      if (titleNumber === heroWords.length - 1) {
        setTitleNumber(0);
      } else {
        setTitleNumber(titleNumber + 1);
      }
    }, 2500);
    return () => clearTimeout(timeoutId);
  }, [titleNumber, heroWords]);

  // Calculate costs based on minutes
  const calculateCost = (planMinutes: number, planPrice: number, overageRate: number) => {
    if (minutes <= planMinutes) return planPrice;
    const overage = (minutes - planMinutes) * overageRate;
    return planPrice + overage;
  };

  const plans = [
    {
      name: 'Free',
      price: 0,
      priceYearly: 0,
      minutes: 50,
      overageRate: 0,
      features: ['50 minutes/month', '1 AI agent', 'Basic analytics', 'Email support', 'Web calls only'],
      notIncluded: ['Phone numbers', 'API access', 'Custom voices', 'Priority support'],
      cta: 'Start Free',
      popular: false
    },
    {
      name: 'Starter',
      price: 79,
      priceYearly: 790,
      minutes: 500,
      overageRate: 0.18,
      features: ['500 minutes/month', '3 AI agents', 'Full analytics', '1 phone number', 'API access', 'Email + chat support'],
      notIncluded: ['Custom voices', 'Priority support'],
      cta: 'Get Started',
      popular: false
    },
    {
      name: 'Growth',
      price: 349,
      priceYearly: 3490,
      minutes: 2500,
      overageRate: 0.16,
      features: ['2,500 minutes/month', '10 AI agents', 'Advanced analytics', '5 phone numbers', 'Custom voices', 'Priority support', 'Webhook integrations'],
      notIncluded: [],
      cta: 'Get Started',
      popular: true
    },
    {
      name: 'Scale',
      price: 1299,
      priceYearly: 12990,
      minutes: 10000,
      overageRate: 0.14,
      features: ['10,000 minutes/month', 'Unlimited agents', 'Enterprise analytics', '20 phone numbers', 'Custom voices', 'Dedicated support', 'SLA guarantee', 'SSO & SAML'],
      notIncluded: [],
      cta: 'Contact Sales',
      popular: false
    }
  ];

  return (
    <div className="min-h-screen bg-[#0a0a0f]">
      <Navbar />

      {/* Hero Section */}
      <section className="relative min-h-screen flex items-center pt-20 overflow-hidden">
        {/* Enhanced gradient background */}
        <div className="absolute inset-0">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[600px] bg-purple-600/20 rounded-full blur-[150px]" />
          <div className="absolute top-1/3 left-1/4 w-[400px] h-[400px] bg-purple-500/15 rounded-full blur-[120px]" />
          <div className="absolute bottom-1/4 right-1/4 w-[500px] h-[500px] bg-pink-500/10 rounded-full blur-[130px]" />
          {/* Grid pattern overlay */}
          <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.05)_1px,transparent_1px)] bg-[size:64px_64px]" />
        </div>
        
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-12 sm:py-16 md:py-20 text-center relative z-10">
          <motion.div
            initial="initial"
            animate="animate"
            variants={stagger}
          >
            {/* Badge */}
            <motion.div variants={fadeInUp} className="mb-6 sm:mb-8">
              <span className="inline-flex items-center gap-2 px-3 sm:px-4 py-1.5 sm:py-2 bg-purple-500/10 border border-purple-500/20 rounded-full text-xs sm:text-sm text-purple-300">
                <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                Now in Beta — 10+ Languages Supported
              </span>
            </motion.div>

            <motion.h1 
              variants={fadeInUp} 
              className="text-3xl sm:text-4xl md:text-5xl lg:text-7xl font-bold leading-tight mb-6 sm:mb-8 tracking-tight"
            >
              <span className="text-white">AI Voice Agents for</span>
              <span className="relative inline-flex w-full justify-center overflow-hidden h-[45px] sm:h-[55px] md:h-[70px] lg:h-[100px] mt-2 sm:mt-4 md:mt-6">
                {heroWords.map((word, index) => (
                  <motion.span
                    key={index}
                    className="absolute font-bold bg-gradient-to-r from-purple-400 via-pink-400 to-purple-400 bg-clip-text text-transparent whitespace-nowrap text-[1.75rem] sm:text-4xl md:text-5xl lg:text-7xl"
                    initial={{ opacity: 0, y: -100 }}
                    transition={{ type: "spring", stiffness: 50 }}
                    animate={
                      titleNumber === index
                        ? { y: 0, opacity: 1 }
                        : { y: titleNumber > index ? -150 : 150, opacity: 0 }
                    }
                  >
                    {word}
                  </motion.span>
                ))}
              </span>
            </motion.h1>

            <motion.p variants={fadeInUp} className="text-base sm:text-xl md:text-2xl text-white/60 mb-3 sm:mb-4 max-w-3xl mx-auto px-2">
              Deploy human-like voice AI that handles thousands of calls simultaneously.
            </motion.p>
            <motion.p variants={fadeInUp} className="text-sm sm:text-lg text-white/40 mb-8 sm:mb-10 max-w-2xl mx-auto px-2">
              Sub-second latency. 10+ Indian languages. Enterprise-grade reliability.
            </motion.p>

            <motion.div variants={fadeInUp} className="flex flex-col sm:flex-row gap-3 sm:gap-4 justify-center mb-10 sm:mb-12 px-4 sm:px-0">
              <Link to="/signup" className="w-full sm:w-auto">
                <button className="btn-primary w-full sm:w-auto flex items-center justify-center gap-2 py-3.5 sm:py-3">
                  Start Free Trial
                  <ArrowRight size={18} />
                </button>
              </Link>
              <a href="#demo" className="w-full sm:w-auto">
                <button className="btn-secondary w-full sm:w-auto flex items-center justify-center gap-2 py-3.5 sm:py-3">
                  <Play size={16} />
                  Try Live Demo
                </button>
              </a>
            </motion.div>

            {/* Social proof stats */}
            <motion.div 
              variants={fadeInUp}
              className="grid grid-cols-2 sm:flex sm:flex-wrap justify-center gap-4 sm:gap-8 md:gap-12 pt-6 sm:pt-8 border-t border-white/5"
            >
              <div className="text-center">
                <p className="text-xl sm:text-2xl md:text-3xl font-bold text-white">500ms</p>
                <p className="text-xs sm:text-sm text-white/40">Avg Response</p>
              </div>
              <div className="text-center">
                <p className="text-xl sm:text-2xl md:text-3xl font-bold text-white">99.9%</p>
                <p className="text-xs sm:text-sm text-white/40">Uptime SLA</p>
              </div>
              <div className="text-center">
                <p className="text-xl sm:text-2xl md:text-3xl font-bold text-white">10+</p>
                <p className="text-xs sm:text-sm text-white/40">Languages</p>
              </div>
              <div className="text-center">
                <p className="text-xl sm:text-2xl md:text-3xl font-bold text-white">1M+</p>
                <p className="text-xs sm:text-sm text-white/40">Calls Handled</p>
              </div>
            </motion.div>

            {/* Scroll indicator - hidden on mobile */}
            <motion.div 
              variants={fadeInUp}
              className="mt-10 sm:mt-16 hidden sm:block"
            >
              <a href="#demo" className="inline-flex items-center justify-center w-10 h-10 rounded-full border border-white/10 text-white/30 hover:text-white/60 hover:border-white/30 transition-all animate-bounce">
                <ChevronDown size={20} />
              </a>
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* Live Demo Section */}
      <section id="demo" className="py-24 px-6 relative">
        <div className="max-w-7xl mx-auto grid lg:grid-cols-2 gap-16 items-center">
          {/* Left: Content */}
          <motion.div
            initial={{ opacity: 0, x: -30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
          >
            <span className="inline-block px-3 py-1 bg-green-500/10 border border-green-500/20 rounded-full text-green-400 text-sm mb-6">
              Live Demo
            </span>
            <h2 className="text-3xl md:text-5xl font-light text-white mb-4">
              Can't believe? <span className="text-purple-400 font-medium">Try NOW</span> a free test call
            </h2>
            <p className="text-white/50 mb-4">
              Curious how our AI agents work?
            </p>
            <p className="text-white/60 mb-6">
              Get a hands-on experience by trying a free demo call. Fill in your details, and our AI representative will call you instantly.
            </p>
            <p className="text-white/40 text-sm">
              Agent is trained to discuss about VocaCore AI services and book appointments.
            </p>
          </motion.div>

          {/* Right: Demo Card */}
          <motion.div
            initial={{ opacity: 0, x: 30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            className="lg:pl-8"
          >
            <VoiceDemo className="max-w-md mx-auto lg:mx-0 lg:ml-auto" />
          </motion.div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="py-24 px-6">
        <div className="max-w-7xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-16"
          >
            <h2 className="text-3xl md:text-5xl font-light mb-4">
              <span className="text-white">Everything You Need for </span>
              <span className="text-purple-400">Voice AI</span>
            </h2>
            <p className="text-white/50 max-w-2xl mx-auto">
              A complete platform for building, deploying, and managing AI voice agents at scale.
            </p>
          </motion.div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((feature, i) => (
              <motion.div
                key={feature.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
                className="relative rounded-2xl border border-white/5 p-[2px]"
              >
                <GlowingEffect
                  spread={40}
                  glow={true}
                  disabled={false}
                  proximity={64}
                  inactiveZone={0.01}
                  borderWidth={2}
                  variant="purple"
                />
                <div className="relative h-full rounded-[14px] bg-[#0a0a0f] p-6">
                  <div className="w-12 h-12 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center mb-4">
                    <feature.icon size={24} className="text-purple-400" />
                  </div>
                  <h3 className="text-lg font-medium text-white mb-2">{feature.title}</h3>
                  <p className="text-white/50 text-sm">{feature.description}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Use Cases Section */}
      <section id="usecases" className="py-24 px-6 relative overflow-hidden">
        {/* Background elements */}
        <div className="absolute inset-0">
          <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-purple-600/10 rounded-full blur-[150px]" />
          <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-pink-500/10 rounded-full blur-[120px]" />
        </div>
        
        <div className="max-w-7xl mx-auto relative z-10">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-16"
          >
            <span className="inline-block px-4 py-1.5 bg-purple-500/10 border border-purple-500/20 rounded-full text-sm text-purple-300 mb-6">
              Industry Solutions
            </span>
            <h2 className="text-3xl md:text-5xl font-bold mb-4">
              <span className="text-white">Built for </span>
              <span className="bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">Every Industry</span>
            </h2>
            <p className="text-white/50 max-w-2xl mx-auto text-lg">
              Deploy voice agents tailored to your specific business needs and watch your efficiency soar.
            </p>
          </motion.div>

          <div className="grid md:grid-cols-2 gap-8">
            {useCases.map((useCase, i) => (
              <motion.div
                key={useCase.title}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.15 }}
                className="group relative"
              >
                <div className={`relative rounded-2xl border ${useCase.borderColor} bg-[#0a0a0f]/80 backdrop-blur-sm p-8 h-full transition-all duration-300 hover:border-opacity-50`}>
                  {/* Gradient background on hover */}
                  <div className={`absolute inset-0 rounded-2xl bg-gradient-to-br ${useCase.gradient} opacity-0 group-hover:opacity-100 transition-opacity duration-300`} />
                  
                  <div className="relative z-10">
                    {/* Header */}
                    <div className="flex items-start justify-between mb-6">
                      <div className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${useCase.gradient} flex items-center justify-center`}>
                        <useCase.icon size={28} className="text-white" />
                      </div>
                      <div className="text-right">
                        <p className="text-3xl font-bold text-white">{useCase.stats.value}</p>
                        <p className="text-xs text-white/40">{useCase.stats.label}</p>
                      </div>
                    </div>
                    
                    {/* Content */}
                    <h3 className="text-2xl font-semibold text-white mb-3">{useCase.title}</h3>
                    <p className="text-white/60 mb-6 leading-relaxed">{useCase.description}</p>
                    
                    {/* Features grid */}
                    <div className="grid grid-cols-2 gap-2">
                      {useCase.features.map((feature, idx) => (
                        <div key={idx} className="flex items-center gap-2 text-sm text-white/50">
                          <div className="w-1.5 h-1.5 rounded-full bg-purple-400" />
                          {feature}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>

          {/* Bottom CTA */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mt-12"
          >
            <p className="text-white/40 mb-4">Don't see your industry?</p>
            <Link to="/signup">
              <button className="btn-ghost text-purple-400 hover:text-purple-300">
                Contact us for custom solutions →
              </button>
            </Link>
          </motion.div>
        </div>
      </section>

      {/* Pricing Section */}
      <section id="pricing" className="py-24 px-6">
        <div className="max-w-7xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-12"
          >
            <h2 className="text-3xl md:text-5xl font-light mb-4">
              <span className="text-white">Simple, Transparent </span>
              <span className="text-purple-400">Pricing</span>
            </h2>
            <p className="text-white/50 max-w-2xl mx-auto mb-8">
              Start free, scale as you grow. No hidden fees, no surprises.
            </p>

            {/* Billing Toggle */}
            <div className="inline-flex items-center gap-4 p-1 bg-white/5 rounded-full">
              <button
                onClick={() => setBillingInterval('monthly')}
                className={`px-6 py-2 rounded-full text-sm font-medium transition-all ${
                  billingInterval === 'monthly' 
                    ? 'bg-purple-500 text-white' 
                    : 'text-white/60 hover:text-white'
                }`}
              >
                Monthly
              </button>
              <button
                onClick={() => setBillingInterval('yearly')}
                className={`px-6 py-2 rounded-full text-sm font-medium transition-all flex items-center gap-2 ${
                  billingInterval === 'yearly' 
                    ? 'bg-purple-500 text-white' 
                    : 'text-white/60 hover:text-white'
                }`}
              >
                Yearly
                <span className="text-xs bg-green-500/20 text-green-400 px-2 py-0.5 rounded-full">
                  Save 17%
                </span>
              </button>
            </div>
          </motion.div>

          {/* Pricing Cards */}
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 mb-16">
            {plans.map((plan, i) => (
              <motion.div
                key={plan.name}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
                className={`relative p-6 rounded-2xl border ${
                  plan.popular 
                    ? 'bg-gradient-to-b from-purple-500/10 to-transparent border-purple-500/30' 
                    : 'bg-white/[0.02] border-white/5'
                }`}
              >
                {plan.popular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-purple-500 rounded-full text-xs font-medium text-white">
                    Most Popular
                  </div>
                )}
                <h3 className="text-xl font-medium text-white mb-2">{plan.name}</h3>
                <div className="mb-6">
                  <span className="text-4xl font-bold text-white">
                    ${billingInterval === 'yearly' ? Math.round(plan.priceYearly / 12) : plan.price}
                  </span>
                  <span className="text-white/50">/month</span>
                  {billingInterval === 'yearly' && plan.price > 0 && (
                    <p className="text-sm text-white/40 mt-1">
                      ${plan.priceYearly} billed annually
                    </p>
                  )}
                </div>
                <ul className="space-y-3 mb-6">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2 text-sm text-white/70">
                      <Check size={16} className="text-green-400 mt-0.5 flex-shrink-0" />
                      {feature}
                    </li>
                  ))}
                  {plan.notIncluded.map((feature) => (
                    <li key={feature} className="flex items-start gap-2 text-sm text-white/30">
                      <X size={16} className="text-white/20 mt-0.5 flex-shrink-0" />
                      {feature}
                    </li>
                  ))}
                </ul>
                <Link to="/signup">
                  <button className={`w-full py-3 rounded-xl font-medium transition-all ${
                    plan.popular
                      ? 'btn-primary'
                      : 'btn-secondary'
                  }`}>
                    {plan.cta}
                  </button>
                </Link>
              </motion.div>
            ))}
          </div>

          {/* Pricing Calculator */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="relative max-w-5xl mx-auto"
          >
            {/* Calculator Header */}
            <div className="text-center mb-10">
              <span className="inline-flex items-center gap-2 px-4 py-1.5 bg-purple-500/10 border border-purple-500/20 rounded-full text-sm text-purple-300 mb-4">
                <Calculator size={16} />
                Cost Estimator
              </span>
              <h3 className="text-2xl md:text-3xl font-bold text-white mb-2">Calculate Your Monthly Cost</h3>
              <p className="text-white/50">Slide to estimate based on your expected call volume</p>
            </div>

            {/* Main Calculator Card */}
            <div className="relative rounded-3xl border border-white/10 bg-gradient-to-b from-white/[0.03] to-transparent p-8 md:p-12">
              {/* Decorative elements */}
              <div className="absolute top-0 right-0 w-64 h-64 bg-purple-500/10 rounded-full blur-[100px]" />
              <div className="absolute bottom-0 left-0 w-48 h-48 bg-pink-500/10 rounded-full blur-[80px]" />
              
              <div className="relative z-10">
                {/* Minutes Display */}
                <div className="text-center mb-8">
                  <p className="text-white/50 text-sm mb-2">Expected minutes per month</p>
                  <div className="flex items-center justify-center gap-4">
                    <button
                      onClick={() => setMinutes(Math.max(0, minutes - 500))}
                      className="w-12 h-12 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center hover:bg-white/10 transition-all"
                    >
                      <Minus size={20} className="text-white/60" />
                    </button>
                    <div className="min-w-[200px]">
                      <span className="text-5xl md:text-6xl font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
                        {minutes.toLocaleString()}
                      </span>
                      <p className="text-white/40 text-sm mt-1">minutes</p>
                    </div>
                    <button
                      onClick={() => setMinutes(Math.min(20000, minutes + 500))}
                      className="w-12 h-12 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center hover:bg-white/10 transition-all"
                    >
                      <Plus size={20} className="text-white/60" />
                    </button>
                  </div>
                </div>

                {/* Slider */}
                <div className="mb-10 px-4">
                  <input
                    type="range"
                    min="0"
                    max="20000"
                    step="100"
                    value={minutes}
                    onChange={(e) => setMinutes(parseInt(e.target.value))}
                    className="w-full h-2 bg-white/10 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-6 [&::-webkit-slider-thumb]:h-6 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-gradient-to-r [&::-webkit-slider-thumb]:from-purple-500 [&::-webkit-slider-thumb]:to-pink-500 [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:shadow-lg [&::-webkit-slider-thumb]:shadow-purple-500/30"
                  />
                  <div className="flex justify-between mt-2 text-xs text-white/30">
                    <span>0</span>
                    <span>5,000</span>
                    <span>10,000</span>
                    <span>15,000</span>
                    <span>20,000</span>
                  </div>
                </div>

                {/* Plan Comparison */}
                <div className="grid md:grid-cols-3 gap-4">
                  {plans.slice(1).map((plan) => {
                    const cost = calculateCost(plan.minutes, plan.price, plan.overageRate);
                    const isRecommended = minutes <= plan.minutes * 1.2 && minutes > (plans[plans.indexOf(plan) - 1]?.minutes || 0);
                    const savings = plan.price > 0 ? Math.round(((minutes * 0.20) - cost) / (minutes * 0.20) * 100) : 0;
                    
                    return (
                      <div 
                        key={plan.name}
                        className={`relative p-6 rounded-2xl border transition-all duration-300 ${
                          isRecommended 
                            ? 'bg-gradient-to-b from-purple-500/20 to-purple-500/5 border-purple-500/40 scale-105' 
                            : 'bg-white/[0.02] border-white/10 hover:border-white/20'
                        }`}
                      >
                        {isRecommended && (
                          <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-gradient-to-r from-purple-500 to-pink-500 rounded-full text-xs font-medium text-white whitespace-nowrap">
                            ✨ Best Value
                          </div>
                        )}
                        <p className="text-sm text-white/50 mb-1">{plan.name}</p>
                        <p className="text-3xl font-bold text-white mb-1">${Math.round(cost)}</p>
                        <p className="text-xs text-white/40 mb-3">per month</p>
                        
                        <div className="pt-3 border-t border-white/10">
                          <div className="flex justify-between text-xs mb-1">
                            <span className="text-white/40">Included</span>
                            <span className="text-white/60">{plan.minutes.toLocaleString()} min</span>
                          </div>
                          {minutes > plan.minutes && (
                            <div className="flex justify-between text-xs mb-1">
                              <span className="text-white/40">Overage</span>
                              <span className="text-orange-400">{(minutes - plan.minutes).toLocaleString()} min</span>
                            </div>
                          )}
                          {savings > 0 && minutes > 100 && (
                            <div className="flex justify-between text-xs">
                              <span className="text-white/40">vs PAYG</span>
                              <span className="text-green-400">Save {savings}%</span>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Quick Select */}
                <div className="flex flex-wrap justify-center gap-2 mt-8">
                  <span className="text-white/40 text-sm mr-2">Quick select:</span>
                  {[500, 1000, 2500, 5000, 10000].map((val) => (
                    <button
                      key={val}
                      onClick={() => setMinutes(val)}
                      className={`px-4 py-1.5 rounded-full text-sm transition-all ${
                        minutes === val 
                          ? 'bg-purple-500 text-white' 
                          : 'bg-white/5 text-white/50 hover:bg-white/10 hover:text-white'
                      }`}
                    >
                      {val.toLocaleString()}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-24 px-6 relative overflow-hidden">
        {/* Background */}
        <div className="absolute inset-0">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[400px] bg-purple-600/20 rounded-full blur-[150px]" />
        </div>

        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="relative max-w-6xl mx-auto"
        >
          <div className="relative rounded-3xl border border-purple-500/20 bg-gradient-to-br from-purple-900/20 via-[#0a0a0f] to-pink-900/20 p-12 md:p-16 overflow-hidden">
            {/* Grid pattern */}
            <div className="absolute inset-0 bg-[linear-gradient(rgba(168,85,247,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(168,85,247,0.03)_1px,transparent_1px)] bg-[size:32px_32px]" />
            
            {/* Glowing orbs */}
            <div className="absolute top-0 left-1/4 w-32 h-32 bg-purple-500/30 rounded-full blur-[60px]" />
            <div className="absolute bottom-0 right-1/4 w-40 h-40 bg-pink-500/20 rounded-full blur-[80px]" />
            
            <div className="relative z-10 text-center">
              {/* Badge */}
              <div className="inline-flex items-center gap-2 px-4 py-2 bg-green-500/10 border border-green-500/20 rounded-full text-sm text-green-400 mb-8">
                <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                Limited Time: 14-Day Free Trial
              </div>

              <h2 className="text-4xl md:text-5xl lg:text-6xl font-bold text-white mb-6 leading-tight">
                Ready to Scale Your<br />
                <span className="bg-gradient-to-r from-purple-400 via-pink-400 to-purple-400 bg-clip-text text-transparent">
                  Customer Conversations?
                </span>
              </h2>
              
              <p className="text-xl text-white/50 mb-10 max-w-2xl mx-auto">
                Join 500+ businesses already using VocaCore AI to handle millions of customer calls with AI that sounds human.
              </p>

              {/* CTA Buttons */}
              <div className="flex flex-col sm:flex-row gap-4 justify-center mb-12">
                <Link to="/signup">
                  <button className="btn-primary text-lg px-10 py-4 flex items-center gap-3">
                    Start Free Trial
                    <ArrowRight size={20} />
                  </button>
                </Link>
                <a href="#demo">
                  <button className="btn-secondary text-lg px-10 py-4 flex items-center gap-3">
                    <Play size={18} />
                    Watch Demo
                  </button>
                </a>
              </div>

              {/* Trust indicators */}
              <div className="flex flex-wrap justify-center gap-8 pt-8 border-t border-white/5">
                <div className="flex items-center gap-2 text-white/40 text-sm">
                  <Check size={16} className="text-green-400" />
                  No credit card required
                </div>
                <div className="flex items-center gap-2 text-white/40 text-sm">
                  <Check size={16} className="text-green-400" />
                  Setup in 5 minutes
                </div>
                <div className="flex items-center gap-2 text-white/40 text-sm">
                  <Check size={16} className="text-green-400" />
                  Cancel anytime
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/5 py-12 px-6">
        <div className="max-w-7xl mx-auto">
          <div className="grid md:grid-cols-4 gap-12 mb-12">
            <div>
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-purple-600 flex items-center justify-center">
                  <img 
                src={VocaCoreAILogo} 
                alt="VocaCore AI" 
                className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg object-contain group-hover:shadow-lg group-hover:shadow-purple-500/25 transition-shadow"
              />
                </div>
                <span className="font-bold text-white">VocaCore AI</span>
              </div>
              <p className="text-white/40 text-sm">
                The first voice AI platform that lets you duplicate yourself at scale.
              </p>
            </div>
            <div>
              <h4 className="font-medium text-white mb-4">Product</h4>
              <ul className="space-y-2 text-sm text-white/50">
                <li><a href="#features" className="hover:text-white transition-colors">Features</a></li>
                <li><a href="#pricing" className="hover:text-white transition-colors">Pricing</a></li>
                <li><a href="#usecases" className="hover:text-white transition-colors">Use Cases</a></li>
                <li><a href="#demo" className="hover:text-white transition-colors">Demo</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-medium text-white mb-4">Company</h4>
              <ul className="space-y-2 text-sm text-white/50">
                <li><a href="#" className="hover:text-white transition-colors">About</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Blog</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Careers</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Contact</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-medium text-white mb-4">Legal</h4>
              <ul className="space-y-2 text-sm text-white/50">
                <li><a href="#" className="hover:text-white transition-colors">Privacy Policy</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Terms of Service</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Security</a></li>
              </ul>
            </div>
          </div>
          <div className="pt-8 border-t border-white/5 flex flex-col md:flex-row justify-between items-center gap-4">
            <p className="text-white/40 text-sm">
              © 2026 VocaCore AI. All rights reserved.
            </p>
            <div className="flex items-center gap-4">
              <a href="#" className="text-white/40 hover:text-white transition-colors">
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M24 4.557c-.883.392-1.832.656-2.828.775 1.017-.609 1.798-1.574 2.165-2.724-.951.564-2.005.974-3.127 1.195-.897-.957-2.178-1.555-3.594-1.555-3.179 0-5.515 2.966-4.797 6.045-4.091-.205-7.719-2.165-10.148-5.144-1.29 2.213-.669 5.108 1.523 6.574-.806-.026-1.566-.247-2.229-.616-.054 2.281 1.581 4.415 3.949 4.89-.693.188-1.452.232-2.224.084.626 1.956 2.444 3.379 4.6 3.419-2.07 1.623-4.678 2.348-7.29 2.04 2.179 1.397 4.768 2.212 7.548 2.212 9.142 0 14.307-7.721 13.995-14.646.962-.695 1.797-1.562 2.457-2.549z"/></svg>
              </a>
              <a href="#" className="text-white/40 hover:text-white transition-colors">
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>
              </a>
              <a href="#" className="text-white/40 hover:text-white transition-colors">
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z"/></svg>
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

const features = [
  { icon: Phone, title: 'Telephony Integration', description: 'Connect with Plivo, Twilio, or any SIP provider. Handle inbound and outbound calls seamlessly.' },
  { icon: Bot, title: 'AI-Powered Conversations', description: 'Natural language understanding with Gemini, GPT-4, or Claude. Context-aware responses.' },
  { icon: Globe, title: '10+ Indian Languages', description: 'Support for Hindi, Tamil, Telugu, Bengali, and more with native voice quality.' },
  { icon: Zap, title: 'Sub-800ms Latency', description: 'Real-time streaming architecture for natural, responsive conversations.' },
  { icon: BarChart3, title: 'Analytics Dashboard', description: 'Track call metrics, conversation quality, and customer satisfaction in real-time.' },
  { icon: Shield, title: 'Enterprise Security', description: 'SOC 2 compliant, end-to-end encryption, and data residency options.' },
];

const useCases = [
  { 
    icon: Headphones, 
    title: 'Customer Support', 
    description: 'Automate tier-1 support with AI that understands context, resolves issues, and knows when to escalate.',
    stats: { value: '70%', label: 'Ticket Deflection' },
    features: ['FAQ handling', 'Ticket creation', 'Smart escalation', 'Sentiment analysis'],
    gradient: 'from-blue-500/20 to-cyan-500/20',
    borderColor: 'border-blue-500/20'
  },
  { 
    icon: Wallet, 
    title: 'Financial Services', 
    description: 'Streamline loan processing, KYC verification, payment collection, and account management.',
    stats: { value: '3x', label: 'Faster Processing' },
    features: ['Loan applications', 'KYC verification', 'Payment reminders', 'Account inquiries'],
    gradient: 'from-green-500/20 to-emerald-500/20',
    borderColor: 'border-green-500/20'
  },
  { 
    icon: Building2, 
    title: 'Healthcare & Clinics', 
    description: 'Handle appointment scheduling, prescription refills, and patient follow-ups with HIPAA compliance.',
    stats: { value: '85%', label: 'Booking Rate' },
    features: ['Appointment booking', 'Prescription refills', 'Follow-up calls', 'Insurance verification'],
    gradient: 'from-purple-500/20 to-pink-500/20',
    borderColor: 'border-purple-500/20'
  },
  { 
    icon: Clock, 
    title: 'Sales & Lead Gen', 
    description: 'Qualify leads, book demos, and follow up with prospects automatically around the clock.',
    stats: { value: '24/7', label: 'Availability' },
    features: ['Lead qualification', 'Demo scheduling', 'Follow-up sequences', 'CRM integration'],
    gradient: 'from-orange-500/20 to-amber-500/20',
    borderColor: 'border-orange-500/20'
  },
];
