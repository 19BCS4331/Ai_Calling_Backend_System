import { motion } from 'framer-motion';
import { 
  Zap, Phone, Bot, BarChart3, Globe, Shield, 
  Headphones, Building2, Wallet, Clock, ArrowRight,
  CheckCircle2, Sparkles
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { AnimatedBackground } from '../components/ui/AnimatedBackground';
import { Navbar } from '../components/layout/Navbar';
import { VoiceDemo } from '../components/voice/VoiceDemo';
import { Button } from '../components/ui/Button';

const fadeInUp = {
  initial: { opacity: 0, y: 30 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.6 }
};

const stagger = {
  animate: { transition: { staggerChildren: 0.1 } }
};

export function Landing() {
  return (
    <div className="min-h-screen">
      <AnimatedBackground />
      <Navbar />

      {/* Hero Section */}
      <section className="relative min-h-screen flex items-center pt-20">
        <div className="max-w-7xl mx-auto px-6 py-20 grid lg:grid-cols-2 gap-12 items-center">
          {/* Left: Content */}
          <motion.div
            initial="initial"
            animate="animate"
            variants={stagger}
            className="text-center lg:text-left"
          >
            <motion.div variants={fadeInUp} className="inline-flex items-center gap-2 px-4 py-2 bg-neon-blue/10 border border-neon-blue/30 rounded-full mb-6">
              <Sparkles size={16} className="text-neon-blue" />
              <span className="text-sm text-neon-blue">Enterprise AI Voice Platform</span>
            </motion.div>

            <motion.h1 variants={fadeInUp} className="text-4xl md:text-5xl lg:text-6xl font-bold leading-tight mb-6">
              <span className="text-white">Automate Calls with </span>
              <span className="gradient-text">AI Voice Agents</span>
            </motion.h1>

            <motion.p variants={fadeInUp} className="text-lg md:text-xl text-white/60 mb-8 max-w-xl mx-auto lg:mx-0">
              Deploy intelligent voice agents that handle customer calls 24/7. 
              Natural conversations, real-time responses, enterprise-grade reliability.
            </motion.p>

            <motion.div variants={fadeInUp} className="flex flex-col sm:flex-row gap-4 justify-center lg:justify-start">
              <Link to="/signup">
                <Button size="lg" className="w-full sm:w-auto">
                  Get Started Free
                  <ArrowRight size={18} className="ml-2" />
                </Button>
              </Link>
              <a href="#demo">
                <Button variant="secondary" size="lg" className="w-full sm:w-auto">
                  Try Live Demo
                </Button>
              </a>
            </motion.div>

            <motion.div variants={fadeInUp} className="mt-12 flex items-center gap-8 justify-center lg:justify-start text-white/50 text-sm">
              <div className="flex items-center gap-2">
                <CheckCircle2 size={16} className="text-neon-green" />
                <span>No credit card required</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 size={16} className="text-neon-green" />
                <span>10 Indian languages</span>
              </div>
            </motion.div>
          </motion.div>

          {/* Right: Voice Demo */}
          <motion.div
            initial={{ opacity: 0, x: 50 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.8, delay: 0.3 }}
            id="demo"
            className="lg:pl-8"
          >
            <VoiceDemo className="max-w-md mx-auto lg:mx-0 lg:ml-auto" />
          </motion.div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="section-padding">
        <div className="max-w-7xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-16"
          >
            <h2 className="text-3xl md:text-4xl font-bold mb-4">
              <span className="text-white">Everything You Need for </span>
              <span className="gradient-text">Voice AI</span>
            </h2>
            <p className="text-white/60 max-w-2xl mx-auto">
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
                className="glass-card p-6 card-hover"
              >
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-neon-blue/20 to-neon-purple/20 flex items-center justify-center mb-4">
                  <feature.icon size={24} className="text-neon-blue" />
                </div>
                <h3 className="text-lg font-semibold text-white mb-2">{feature.title}</h3>
                <p className="text-white/60 text-sm">{feature.description}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Use Cases Section */}
      <section id="usecases" className="section-padding bg-gradient-to-b from-transparent via-neon-blue/5 to-transparent">
        <div className="max-w-7xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-16"
          >
            <h2 className="text-3xl md:text-4xl font-bold mb-4">
              <span className="gradient-text">Use Cases</span>
            </h2>
            <p className="text-white/60 max-w-2xl mx-auto">
              Deploy voice agents across industries and transform your customer experience.
            </p>
          </motion.div>

          <div className="grid md:grid-cols-2 gap-8">
            {useCases.map((useCase, i) => (
              <motion.div
                key={useCase.title}
                initial={{ opacity: 0, x: i % 2 === 0 ? -20 : 20 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                className="glass-card p-8 flex gap-6"
              >
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-neon-purple/20 to-neon-pink/20 flex items-center justify-center flex-shrink-0">
                  <useCase.icon size={28} className="text-neon-purple" />
                </div>
                <div>
                  <h3 className="text-xl font-semibold text-white mb-2">{useCase.title}</h3>
                  <p className="text-white/60">{useCase.description}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works Section */}
      <section id="how-it-works" className="section-padding">
        <div className="max-w-7xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-16"
          >
            <h2 className="text-3xl md:text-4xl font-bold mb-4">
              <span className="text-white">How It </span>
              <span className="gradient-text">Works</span>
            </h2>
          </motion.div>

          <div className="grid md:grid-cols-3 gap-8">
            {steps.map((step, i) => (
              <motion.div
                key={step.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.2 }}
                className="text-center"
              >
                <div className="w-16 h-16 rounded-full bg-gradient-to-br from-neon-blue to-neon-purple flex items-center justify-center mx-auto mb-6 text-2xl font-bold">
                  {i + 1}
                </div>
                <h3 className="text-xl font-semibold text-white mb-3">{step.title}</h3>
                <p className="text-white/60">{step.description}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="section-padding">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
          className="max-w-4xl mx-auto glass-card p-12 text-center relative overflow-hidden"
        >
          <div className="absolute inset-0 bg-gradient-to-r from-neon-blue/10 via-neon-purple/10 to-neon-pink/10" />
          <div className="relative">
            <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
              Ready to Transform Your Customer Experience?
            </h2>
            <p className="text-white/60 mb-8 max-w-xl mx-auto">
              Join hundreds of businesses using VocaAI to automate customer calls and boost satisfaction.
            </p>
            <Link to="/signup">
              <Button size="lg">
                Start Free Trial
                <ArrowRight size={18} className="ml-2" />
              </Button>
            </Link>
          </div>
        </motion.div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/10 py-12 px-6">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-neon-blue to-neon-purple flex items-center justify-center">
              <Zap size={16} className="text-white" />
            </div>
            <span className="font-bold text-white">VocaAI</span>
          </div>
          <p className="text-white/40 text-sm">
            © 2026 VocaAI. All rights reserved.
          </p>
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
  { icon: Headphones, title: 'Customer Support', description: 'Handle FAQs, troubleshooting, and ticket creation automatically. Escalate complex issues to human agents.' },
  { icon: Wallet, title: 'Financial Services', description: 'Process loan applications, KYC verification, payment reminders, and account inquiries.' },
  { icon: Building2, title: 'Enterprise Automation', description: 'Appointment scheduling, order status, feedback collection, and internal helpdesk.' },
  { icon: Clock, title: '24/7 Availability', description: 'Never miss a customer call. Handle peak volumes without adding headcount.' },
];

const steps = [
  { title: 'Configure Your Agent', description: 'Define your AI agent\'s personality, knowledge base, and conversation flows through our dashboard.' },
  { title: 'Connect Your Phone', description: 'Link your existing phone numbers or get new ones. Integrate with your CRM and tools.' },
  { title: 'Go Live', description: 'Start handling calls immediately. Monitor performance and optimize continuously.' },
];
