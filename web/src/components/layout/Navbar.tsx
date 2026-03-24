import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Menu, X, Sun, Moon } from 'lucide-react';
import { useAuthStore } from '../../store/auth';
import { GlowingEffect } from '../ui/GlowingEffect';
import { useTheme } from '../../hooks/useTheme';
import VocaCoreAILogo from '../../assets/VocaCore-final-square.png';

export function Navbar() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const { isAuthenticated, logout } = useAuthStore();
  const { theme, toggleTheme } = useTheme();

  const navLinks = [
    { href: '/#features', label: 'How it works?' },
    { href: '/#usecases', label: 'Use Cases' },
    { href: '/#demo', label: 'Docs' },
    { href: '/#pricing', label: 'Pricing' },
  ];

  return (
    <div className="fixed top-0 left-0 right-0 z-50 flex justify-center pt-3 sm:pt-4 px-3 sm:px-4">
      <motion.nav
        initial={{ y: -20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        className="relative w-full max-w-full sm:max-w-[90%] md:max-w-[85%] lg:max-w-[70%] xl:max-w-[60%] rounded-xl sm:rounded-2xl"
      >
        <GlowingEffect
          spread={60}
          glow={true}
          disabled={false}
          proximity={100}
          inactiveZone={0.01}
          borderWidth={1}
          variant="purple"
        />
        <div className="relative bg-gradient-to-br from-white/70 to-white/50 dark:from-white/[0.07] dark:to-white/[0.03] backdrop-blur-2xl saturate-150 border border-white/70 dark:border-white/10 rounded-[inherit] shadow-[0_4px_24px_rgba(0,0,0,0.07),0_1px_2px_rgba(0,0,0,0.04),inset_0_1px_0_rgba(255,255,255,0.8)] dark:shadow-[0_4px_24px_rgba(0,0,0,0.35),inset_0_1px_0_rgba(255,255,255,0.08)]">
        <div className="px-4 sm:px-6 py-2.5 sm:py-3">
          <div className="flex items-center justify-between">
            {/* Logo */}
            <Link to="/" className="flex items-center gap-2 group">
              <img 
                src={VocaCoreAILogo} 
                alt="VocaCore AI" 
                className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg object-contain group-hover:shadow-lg group-hover:shadow-purple-500/25 transition-shadow"
              />
              <span className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white">VocaCore AI</span>
            </Link>

            {/* Desktop Navigation */}
            <div className="hidden lg:flex items-center gap-4 xl:gap-6">
              {navLinks.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  className="text-gray-500 hover:text-gray-900 dark:text-white/60 dark:hover:text-white transition-colors text-sm font-medium"
                >
                  {link.label}
                </a>
              ))}
            </div>

            {/* Auth Buttons + Theme Toggle */}
            <div className="hidden lg:flex items-center gap-2">
              {/* Theme toggle */}
              <button
                onClick={toggleTheme}
                className="p-2 rounded-lg text-gray-500 hover:text-gray-900 hover:bg-gray-100 dark:text-white/50 dark:hover:text-white dark:hover:bg-white/10 transition-all"
                aria-label="Toggle theme"
              >
                {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
              </button>

              {isAuthenticated ? (
                <>
                  <Link to="/dashboard">
                    <button className="px-3 xl:px-4 py-2 text-sm text-gray-600 hover:text-gray-900 dark:text-white/70 dark:hover:text-white transition-colors">
                      Dashboard
                    </button>
                  </Link>
                  <button 
                    onClick={logout}
                    className="px-3 xl:px-4 py-2 text-sm bg-gray-100 border border-gray-200 rounded-lg text-gray-700 hover:bg-gray-200 dark:bg-white/5 dark:border-white/10 dark:text-white dark:hover:bg-white/10 transition-all"
                  >
                    Logout
                  </button>
                </>
              ) : (
                <>
                  <Link to="/login">
                    <button className="px-3 xl:px-4 py-2 text-sm text-gray-600 hover:text-gray-900 dark:text-white/70 dark:hover:text-white transition-colors">
                      Login
                    </button>
                  </Link>
                  <Link to="/signup">
                    <button className="px-3 xl:px-4 py-2 text-sm bg-gradient-to-r from-purple-600 to-purple-500 rounded-lg text-white font-medium hover:from-purple-500 hover:to-purple-400 hover:scale-105 transition-all shadow-lg shadow-purple-500/25">
                      Join Now
                    </button>
                  </Link>
                </>
              )}
            </div>

            {/* Mobile: Theme toggle + Menu Button */}
            <div className="lg:hidden flex items-center gap-1">
              <button
                onClick={toggleTheme}
                className="p-2 text-gray-500 hover:text-gray-900 dark:text-white/50 dark:hover:text-white transition-colors"
                aria-label="Toggle theme"
              >
                {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
              </button>
              <button
                className="p-2 text-gray-600 hover:text-gray-900 dark:text-white/70 dark:hover:text-white"
                onClick={() => setIsMenuOpen(!isMenuOpen)}
              >
                {isMenuOpen ? <X size={20} /> : <Menu size={20} />}
              </button>
            </div>
          </div>

          {/* Mobile Menu */}
          {isMenuOpen && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="lg:hidden mt-3 sm:mt-4 pb-2 border-t border-gray-100 dark:border-white/5 pt-3 sm:pt-4"
            >
              <div className="flex flex-col gap-2 sm:gap-3">
                {navLinks.map((link) => (
                  <a
                    key={link.href}
                    href={link.href}
                    className="text-gray-500 hover:text-gray-900 dark:text-white/60 dark:hover:text-white transition-colors text-sm py-1"
                    onClick={() => setIsMenuOpen(false)}
                  >
                    {link.label}
                  </a>
                ))}
                <div className="flex flex-col sm:flex-row gap-2 mt-3 pt-3 border-t border-gray-100 dark:border-white/5">
                  {isAuthenticated ? (
                    <>
                      <Link to="/dashboard" className="flex-1">
                        <button className="w-full px-4 py-2.5 text-sm bg-gray-100 border border-gray-200 rounded-lg text-gray-700 dark:bg-white/5 dark:border-white/10 dark:text-white">
                          Dashboard
                        </button>
                      </Link>
                      <button 
                        onClick={logout}
                        className="w-full sm:w-auto px-4 py-2.5 text-sm text-gray-500 hover:text-gray-900 bg-gray-100 border border-gray-200 rounded-lg dark:text-white/60 dark:hover:text-white dark:bg-white/5 dark:border-white/10 sm:border-0 sm:bg-transparent dark:sm:bg-transparent"
                      >
                        Logout
                      </button>
                    </>
                  ) : (
                    <>
                      <Link to="/login" className="flex-1">
                        <button className="w-full px-4 py-2.5 text-sm bg-gray-100 border border-gray-200 rounded-lg text-gray-700 dark:bg-white/5 dark:border-white/10 dark:text-white">
                          Login
                        </button>
                      </Link>
                      <Link to="/signup" className="flex-1">
                        <button className="w-full px-4 py-2.5 text-sm bg-gradient-to-r from-purple-600 to-purple-500 rounded-lg text-white font-medium shadow-lg shadow-purple-500/25">
                          Join Now
                        </button>
                      </Link>
                    </>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </div>
        </div>
      </motion.nav>
    </div>
  );
}
