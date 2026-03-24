import { useState } from 'react';
import { motion } from 'framer-motion';
import { 
  Mail, Phone, MapPin, Send, CheckCircle, Loader2, 
  MessageSquare, Clock, Globe, ArrowRight
} from 'lucide-react';
import { Navbar } from '../components/layout/Navbar';
import { Link } from 'react-router-dom';
import VocaCoreAILogo from '../assets/VocaCore-final-square.png';

const SAAS_API_URL = import.meta.env.VITE_SAAS_API_URL || 'http://localhost:3001';

const fadeInUp = {
  initial: { opacity: 0, y: 30 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.6 }
};

const stagger = {
  animate: { transition: { staggerChildren: 0.1 } }
};

const contactInfo = [
  {
    icon: Mail,
    label: 'Email',
    value: 'support@vocacore.com',
    href: 'mailto:support@vocacore.com',
    color: 'from-purple-500 to-pink-500'
  },
  {
    icon: Phone,
    label: 'Phone',
    value: '+91 9773100410',
    href: 'tel:+919773100410',
    color: 'from-blue-500 to-cyan-500'
  },
  {
    icon: MapPin,
    label: 'Office',
    value: 'Mumbai, India',
    href: '#',
    color: 'from-green-500 to-emerald-500'
  },
  {
    icon: Clock,
    label: 'Hours',
    value: 'Mon–Fri, 9AM–6PM IST',
    href: '#',
    color: 'from-orange-500 to-amber-500'
  }
];

const topics = [
  { value: 'general', label: 'General Inquiry' },
  { value: 'demo', label: 'Request a Demo' },
  { value: 'pricing', label: 'Pricing & Plans' },
  { value: 'enterprise', label: 'Enterprise Solutions' },
  { value: 'partnership', label: 'Partnership' },
  { value: 'support', label: 'Technical Support' },
  { value: 'other', label: 'Other' }
];

export function Contact() {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    company: '',
    topic: 'general',
    message: ''
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch(`${SAAS_API_URL}/api/v1/contact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to send message');
      }

      setIsSubmitted(true);
      setFormData({ name: '', email: '', company: '', topic: 'general', message: '' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const updateField = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-purple-50/80 via-white to-white dark:from-[#0a0a0f] dark:via-[#0a0a0f] dark:to-[#0a0a0f]">
      <Navbar />

      {/* Hero */}
      <section className="relative pt-32 pb-16 overflow-hidden">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-0 left-1/4 w-[600px] h-[400px] bg-purple-400/20 dark:bg-purple-600/10 rounded-full blur-[140px]" />
          <div className="absolute bottom-0 right-1/4 w-[400px] h-[400px] bg-pink-300/15 dark:bg-pink-500/10 rounded-full blur-[130px]" />
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 relative z-10">
          <motion.div
            initial="initial"
            animate="animate"
            variants={stagger}
            className="text-center mb-16"
          >
            <motion.span
              variants={fadeInUp}
              className="inline-flex items-center gap-2 px-4 py-1.5 bg-purple-500/10 border border-purple-500/20 rounded-full text-sm text-purple-600 dark:text-purple-300 mb-6"
            >
              <MessageSquare size={16} />
              Get in Touch
            </motion.span>
            <motion.h1
              variants={fadeInUp}
              className="text-4xl sm:text-5xl lg:text-6xl font-bold text-gray-900 dark:text-white mb-6"
            >
              Let's <span className="bg-gradient-to-r from-purple-500 via-pink-500 to-purple-500 bg-clip-text text-transparent">Talk</span>
            </motion.h1>
            <motion.p
              variants={fadeInUp}
              className="text-lg sm:text-xl text-gray-500 dark:text-white/50 max-w-2xl mx-auto"
            >
              Have a question, need a demo, or want to explore enterprise solutions? We'd love to hear from you.
            </motion.p>
          </motion.div>

          {/* Contact Info Cards */}
          <motion.div
            initial="initial"
            animate="animate"
            variants={stagger}
            className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-20"
          >
            {contactInfo.map((info) => (
              <motion.a
                key={info.label}
                href={info.href}
                variants={fadeInUp}
                whileHover={{ y: -4 }}
                className="group relative p-5 rounded-2xl border border-gray-100 dark:border-white/5 bg-white/80 dark:bg-white/[0.02] backdrop-blur-sm hover:shadow-lg hover:shadow-purple-500/5 transition-all duration-300"
              >
                <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${info.color} flex items-center justify-center mb-3`}>
                  <info.icon size={20} className="text-white" />
                </div>
                <p className="text-xs text-gray-400 dark:text-white/40 mb-1">{info.label}</p>
                <p className="text-sm font-medium text-gray-900 dark:text-white group-hover:text-purple-600 dark:group-hover:text-purple-400 transition-colors">
                  {info.value}
                </p>
              </motion.a>
            ))}
          </motion.div>

          {/* Main Content */}
          <div className="grid lg:grid-cols-5 gap-12 lg:gap-16">
            {/* Left — Form */}
            <motion.div
              initial={{ opacity: 0, x: -30 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.6, delay: 0.2 }}
              className="lg:col-span-3"
            >
              <div className="relative rounded-3xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/[0.03] p-8 sm:p-10 backdrop-blur-sm">
                {/* Decorative */}
                <div className="absolute top-0 right-0 w-48 h-48 bg-purple-400/10 dark:bg-purple-500/5 rounded-full blur-[80px]" />

                {isSubmitted ? (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="relative z-10 text-center py-12"
                  >
                    <div className="w-20 h-20 rounded-full bg-green-500/10 border border-green-500/20 flex items-center justify-center mx-auto mb-6">
                      <CheckCircle size={40} className="text-green-500" />
                    </div>
                    <h3 className="text-2xl font-bold text-gray-900 dark:text-white mb-3">Message Sent!</h3>
                    <p className="text-gray-500 dark:text-white/50 mb-8 max-w-sm mx-auto">
                      Thanks for reaching out. We'll get back to you within 24 hours.
                    </p>
                    <button
                      onClick={() => setIsSubmitted(false)}
                      className="px-6 py-3 bg-gradient-to-r from-purple-600 to-purple-500 rounded-xl text-white font-medium hover:from-purple-500 hover:to-purple-400 transition-all shadow-lg shadow-purple-500/25"
                    >
                      Send Another Message
                    </button>
                  </motion.div>
                ) : (
                  <form onSubmit={handleSubmit} className="relative z-10 space-y-5">
                    <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">Send us a message</h2>

                    {error && (
                      <motion.div
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-600 dark:text-red-400 text-sm"
                      >
                        {error}
                      </motion.div>
                    )}

                    <div className="grid sm:grid-cols-2 gap-5">
                      <div>
                        <label className="block text-sm font-medium text-gray-600 dark:text-white/60 mb-2">
                          Full Name <span className="text-red-400">*</span>
                        </label>
                        <input
                          type="text"
                          required
                          value={formData.name}
                          onChange={(e) => updateField('name', e.target.value)}
                          placeholder="John Doe"
                          className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:border-purple-500/50 focus:ring-2 focus:ring-purple-500/20 dark:bg-white/5 dark:border-white/10 dark:text-white dark:placeholder-white/30 transition-all"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-600 dark:text-white/60 mb-2">
                          Email <span className="text-red-400">*</span>
                        </label>
                        <input
                          type="email"
                          required
                          value={formData.email}
                          onChange={(e) => updateField('email', e.target.value)}
                          placeholder="john@company.com"
                          className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:border-purple-500/50 focus:ring-2 focus:ring-purple-500/20 dark:bg-white/5 dark:border-white/10 dark:text-white dark:placeholder-white/30 transition-all"
                        />
                      </div>
                    </div>

                    <div className="grid sm:grid-cols-2 gap-5">
                      <div>
                        <label className="block text-sm font-medium text-gray-600 dark:text-white/60 mb-2">
                          Company
                        </label>
                        <input
                          type="text"
                          value={formData.company}
                          onChange={(e) => updateField('company', e.target.value)}
                          placeholder="Acme Inc."
                          className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:border-purple-500/50 focus:ring-2 focus:ring-purple-500/20 dark:bg-white/5 dark:border-white/10 dark:text-white dark:placeholder-white/30 transition-all"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-600 dark:text-white/60 mb-2">
                          Topic <span className="text-red-400">*</span>
                        </label>
                        <select
                          required
                          value={formData.topic}
                          onChange={(e) => updateField('topic', e.target.value)}
                          className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 focus:outline-none focus:border-purple-500/50 focus:ring-2 focus:ring-purple-500/20 dark:bg-white/5 dark:border-white/10 dark:text-white transition-all appearance-none cursor-pointer"
                        >
                          {topics.map((t) => (
                            <option key={t.value} value={t.value} className="dark:bg-gray-900">{t.label}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-600 dark:text-white/60 mb-2">
                        Message <span className="text-red-400">*</span>
                      </label>
                      <textarea
                        required
                        rows={5}
                        value={formData.message}
                        onChange={(e) => updateField('message', e.target.value)}
                        placeholder="Tell us about your needs..."
                        className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:border-purple-500/50 focus:ring-2 focus:ring-purple-500/20 dark:bg-white/5 dark:border-white/10 dark:text-white dark:placeholder-white/30 transition-all resize-none"
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={isSubmitting}
                      className="w-full py-3.5 bg-gradient-to-r from-purple-600 to-purple-500 rounded-xl text-white font-medium hover:from-purple-500 hover:to-purple-400 transition-all shadow-lg shadow-purple-500/25 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                      {isSubmitting ? (
                        <>
                          <Loader2 size={18} className="animate-spin" />
                          Sending...
                        </>
                      ) : (
                        <>
                          <Send size={18} />
                          Send Message
                        </>
                      )}
                    </button>

                    <p className="text-xs text-gray-400 dark:text-white/30 text-center">
                      We typically respond within 24 hours.
                    </p>
                  </form>
                )}
              </div>
            </motion.div>

            {/* Right — Sidebar */}
            <motion.div
              initial={{ opacity: 0, x: 30 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.6, delay: 0.4 }}
              className="lg:col-span-2 space-y-6"
            >
              {/* Quick Actions */}
              <div className="rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/[0.03] p-6">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Quick Actions</h3>
                <div className="space-y-3">
                  <Link
                    to="/signup"
                    className="group flex items-center justify-between p-3 rounded-xl bg-purple-500/10 border border-purple-500/20 hover:bg-purple-500/15 transition-all"
                  >
                    <div className="flex items-center gap-3">
                      <Globe size={18} className="text-purple-500" />
                      <span className="text-sm font-medium text-gray-900 dark:text-white">Start Free Trial</span>
                    </div>
                    <ArrowRight size={16} className="text-purple-400 group-hover:translate-x-1 transition-transform" />
                  </Link>
                  <a
                    href="/#demo"
                    className="group flex items-center justify-between p-3 rounded-xl bg-gray-50 dark:bg-white/5 border border-gray-100 dark:border-white/5 hover:bg-gray-100 dark:hover:bg-white/10 transition-all"
                  >
                    <div className="flex items-center gap-3">
                      <Phone size={18} className="text-blue-500" />
                      <span className="text-sm font-medium text-gray-900 dark:text-white">Try Live Demo</span>
                    </div>
                    <ArrowRight size={16} className="text-gray-400 dark:text-white/40 group-hover:translate-x-1 transition-transform" />
                  </a>
                </div>
              </div>

              {/* FAQ teaser */}
              <div className="rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/[0.03] p-6">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Common Questions</h3>
                <div className="space-y-4">
                  {[
                    { q: 'How long is the free trial?', a: '14 days with full access to all features.' },
                    { q: 'Do I need a credit card?', a: 'No credit card required to start your trial.' },
                    { q: 'What languages are supported?', a: '10+ Indian languages plus English.' },
                    { q: 'Can I bring my own API keys?', a: 'Yes, BYOK is supported for all providers.' }
                  ].map((faq, i) => (
                    <div key={i} className="pb-4 border-b border-gray-100 dark:border-white/5 last:border-0 last:pb-0">
                      <p className="text-sm font-medium text-gray-900 dark:text-white mb-1">{faq.q}</p>
                      <p className="text-xs text-gray-500 dark:text-white/40">{faq.a}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Social proof */}
              <div className="rounded-2xl border border-purple-500/20 bg-gradient-to-br from-purple-50 to-pink-50 dark:from-purple-900/10 dark:to-pink-900/10 p-6">
                <p className="text-sm text-gray-500 dark:text-white/50 italic mb-4">
                  "VocaCore AI reduced our call center costs by 60% while improving customer satisfaction. The setup was incredibly easy."
                </p>
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white text-xs font-bold">
                    R
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-900 dark:text-white">Rajesh Kumar</p>
                    <p className="text-xs text-gray-400 dark:text-white/40">CTO, FinServe India</p>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-100 dark:border-white/5 py-12 px-6 mt-16">
        <div className="max-w-7xl mx-auto">
          <div className="flex flex-col md:flex-row justify-between items-center gap-4">
            <div className="flex items-center gap-2">
              <img src={VocaCoreAILogo} alt="VocaCore AI" className="w-7 h-7 rounded-lg object-contain" />
              <span className="font-bold text-gray-900 dark:text-white">VocaCore AI</span>
            </div>
            <p className="text-gray-400 dark:text-white/40 text-sm">
              © 2026 VocaCore AI. All rights reserved.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
