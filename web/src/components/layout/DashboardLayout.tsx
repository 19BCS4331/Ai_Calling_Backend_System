import { Link, useLocation, Outlet, Navigate, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Zap, LayoutDashboard, Phone, Settings, BarChart3, 
  Bot, LogOut, ChevronLeft, Menu, Wrench, X,
  PhoneIncoming
} from 'lucide-react';
import { useState, useEffect } from 'react';
import { useAuthStore } from '../../store/auth';
import { useOrganizationStore } from '../../store/organization';
import { cn } from '../../lib/utils';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import VocaCoreAILogo from '../../assets/VocaCore-final-square.png';

const navItems = [
  { icon: LayoutDashboard, label: 'Overview', href: '/dashboard' },
  { icon: Phone, label: 'Calls', href: '/dashboard/calls' },
  { icon: Bot, label: 'Voice Agents', href: '/dashboard/agents' },
  { icon: Wrench, label: 'Tools', href: '/dashboard/tools' },
  { icon: PhoneIncoming, label: 'Phone Numbers', href: '/dashboard/phone-numbers' },
  { icon: BarChart3, label: 'Analytics', href: '/dashboard/analytics' },
  { icon: Settings, label: 'Settings', href: '/dashboard/settings' },
];

export function DashboardLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const location = useLocation();
  const { user, isAuthenticated, logout } = useAuthStore();
  const { currentOrganization, isLoading: orgLoading } = useOrganizationStore();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login');
    }
  }, [isAuthenticated, navigate]);

  useEffect(() => {
    // If user is authenticated but has no organization, redirect to onboarding
    if (isAuthenticated && !orgLoading && !currentOrganization) {
      navigate('/onboarding');
    }
  }, [isAuthenticated, orgLoading, currentOrganization, navigate]);

  // Close mobile menu on route change
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  // Prevent body scroll when mobile menu is open
  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [mobileOpen]);

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  const sidebarWidth = collapsed ? 80 : 260;

  return (
    <div className="min-h-screen bg-[#0a0a0f]">
      {/* Mobile overlay */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-black/70 backdrop-blur-sm z-40 lg:hidden"
            onClick={() => setMobileOpen(false)}
          />
        )}
      </AnimatePresence>

      {/* Desktop Sidebar - Fixed */}
      <motion.aside
        initial={false}
        animate={{ width: sidebarWidth }}
        transition={{ duration: 0.2, ease: 'easeInOut' }}
        className="hidden lg:flex fixed left-0 top-0 h-screen flex-col z-50 bg-gradient-to-b from-[#0d0d14] to-[#0a0a0f] border-r border-white/[0.06]"
      >
        {/* Logo */}
        <div className="h-16 flex items-center justify-between px-4 border-b border-white/[0.06]">
          <Link to="/dashboard" className="flex items-center gap-3 group">
            {/* <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 via-purple-600 to-pink-500 flex items-center justify-center shadow-lg shadow-purple-500/20 group-hover:shadow-purple-500/30 transition-shadow flex-shrink-0"> */}
              <img 
                src={VocaCoreAILogo} 
                alt="VocaCore AI" 
                className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg object-contain group-hover:shadow-lg group-hover:shadow-purple-500/25 transition-shadow"
              />
            {/* </div> */}
            <AnimatePresence mode="wait">
              {!collapsed && (
                <motion.span
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  transition={{ duration: 0.15 }}
                  className="text-lg font-bold whitespace-nowrap bg-gradient-to-r from-white to-white/80 bg-clip-text text-transparent"
                >
                  VocaCore AI
                </motion.span>
              )}
            </AnimatePresence>
          </Link>
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="p-2 text-white/40 hover:text-white/80 hover:bg-white/[0.06] rounded-lg transition-all duration-200"
          >
            <ChevronLeft size={18} className={cn('transition-transform duration-200', collapsed && 'rotate-180')} />
          </button>
        </div>

        {/* Navigation - Scrollable */}
        <nav className="flex-1 overflow-y-auto overflow-x-hidden py-4 px-3 space-y-1 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
          {navItems.map((item) => {
            const isActive = location.pathname === item.href || 
              (item.href !== '/dashboard' && location.pathname.startsWith(item.href));
            return (
              <Link
                key={item.href}
                to={item.href}
                className={cn(
                  'group relative flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200',
                  isActive 
                    ? 'bg-purple-500/15 text-white' 
                    : 'text-white/50 hover:text-white/90 hover:bg-white/[0.04]'
                )}
              >
                {/* Active indicator */}
                {isActive && (
                  <motion.div
                    layoutId="activeTab"
                    className="absolute left-0 top-0 bottom-0 w-1 my-auto h-[calc(100%-8px)] bg-gradient-to-b from-purple-400 to-purple-600 rounded-full"
                    transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                  />
                )}
                <item.icon 
                  size={20} 
                  className={cn(
                    'flex-shrink-0 transition-colors duration-200',
                    isActive ? 'text-purple-400' : 'group-hover:text-white/80'
                  )} 
                />
                <AnimatePresence mode="wait">
                  {!collapsed && (
                    <motion.span
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -10 }}
                      transition={{ duration: 0.15 }}
                      className={cn(
                        'font-medium text-sm whitespace-nowrap',
                        isActive && 'text-white'
                      )}
                    >
                      {item.label}
                    </motion.span>
                  )}
                </AnimatePresence>
              </Link>
            );
          })}
        </nav>

        {/* User section */}
        <div className="p-3 border-t border-white/[0.06]">
          <AnimatePresence mode="wait">
            {!collapsed && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="px-3 py-2.5 mb-2 rounded-xl bg-white/[0.02]"
              >
                <p className="text-sm font-medium text-white/90 truncate">{user?.name}</p>
                <p className="text-xs text-white/40 truncate">{user?.email}</p>
              </motion.div>
            )}
          </AnimatePresence>
          <button
            onClick={() => setShowLogoutConfirm(true)}
            className={cn(
              'group flex items-center gap-3 px-3 py-2.5 w-full rounded-xl transition-all duration-200',
              'text-white/50 hover:text-red-400 hover:bg-red-500/10'
            )}
          >
            <LogOut size={20} className="flex-shrink-0 group-hover:text-red-400 transition-colors" />
            <AnimatePresence mode="wait">
              {!collapsed && (
                <motion.span
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  transition={{ duration: 0.15 }}
                  className="font-medium text-sm"
                >
                  Logout
                </motion.span>
              )}
            </AnimatePresence>
          </button>
        </div>
      </motion.aside>

      {/* Mobile Sidebar - Slide in */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.aside
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className="lg:hidden fixed left-0 top-0 h-full w-[280px] z-50 bg-gradient-to-b from-[#0d0d14] to-[#0a0a0f] border-r border-white/[0.06] flex flex-col"
          >
            {/* Mobile Header */}
            <div className="h-16 flex items-center justify-between px-4 border-b border-white/[0.06]">
              <Link to="/dashboard" className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 via-purple-600 to-pink-500 flex items-center justify-center shadow-lg shadow-purple-500/20">
                  <Zap size={20} className="text-white" />
                </div>
                <span className="text-lg font-bold bg-gradient-to-r from-white to-white/80 bg-clip-text text-transparent">
                  VocaCore AI
                </span>
              </Link>
              <button
                onClick={() => setMobileOpen(false)}
                className="p-2 text-white/40 hover:text-white/80 hover:bg-white/[0.06] rounded-lg transition-all"
              >
                <X size={20} />
              </button>
            </div>

            {/* Mobile Navigation */}
            <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
              {navItems.map((item, index) => {
                const isActive = location.pathname === item.href || 
                  (item.href !== '/dashboard' && location.pathname.startsWith(item.href));
                return (
                  <motion.div
                    key={item.href}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: index * 0.05 }}
                  >
                    <Link
                      to={item.href}
                      className={cn(
                        'group relative flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200',
                        isActive 
                          ? 'bg-purple-500/15 text-white' 
                          : 'text-white/50 hover:text-white/90 hover:bg-white/[0.04]'
                      )}
                    >
                      {isActive && (
                        <div className="absolute left-0 top-0 bottom-0 w-1 my-auto h-[calc(100%-8px)] bg-gradient-to-b from-purple-400 to-purple-600 rounded-full" />
                      )}
                      <item.icon 
                        size={22} 
                        className={cn(
                          'flex-shrink-0',
                          isActive ? 'text-purple-400' : ''
                        )} 
                      />
                      <span className={cn('font-medium', isActive && 'text-white')}>
                        {item.label}
                      </span>
                    </Link>
                  </motion.div>
                );
              })}
            </nav>

            {/* Mobile User Section */}
            <div className="p-3 border-t border-white/[0.06]">
              <div className="px-4 py-3 mb-2 rounded-xl bg-white/[0.02]">
                <p className="text-sm font-medium text-white/90 truncate">{user?.name}</p>
                <p className="text-xs text-white/40 truncate">{user?.email}</p>
              </div>
              <button
                onClick={() => setShowLogoutConfirm(true)}
                className="group flex items-center gap-3 px-4 py-3 w-full rounded-xl text-white/50 hover:text-red-400 hover:bg-red-500/10 transition-all"
              >
                <LogOut size={22} className="flex-shrink-0 group-hover:text-red-400" />
                <span className="font-medium">Logout</span>
              </button>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* Main Content Area */}
      <div 
        className="min-h-screen transition-all duration-200"
        style={{ marginLeft: collapsed ? 80 : 260 }}
      >
        {/* Mobile header */}
        <header className="lg:hidden sticky top-0 z-30 bg-[#0a0a0f]/95 backdrop-blur-xl border-b border-white/[0.06] px-4 h-14 flex items-center gap-4">
          <button
            onClick={() => setMobileOpen(true)}
            className="p-2 -ml-2 text-white/60 hover:text-white hover:bg-white/[0.06] rounded-lg transition-all"
          >
            <Menu size={22} />
          </button>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
              <Zap size={16} className="text-white" />
            </div>
            <span className="font-bold text-white">VocaCore AI</span>
          </div>
        </header>

        {/* Page content - Scrollable */}
        <main className="p-4 sm:p-6 lg:p-8">
          <Outlet />
        </main>
      </div>

      {/* Mobile margin compensation */}
      <style>{`
        @media (max-width: 1023px) {
          .min-h-screen[style*="margin-left"] {
            margin-left: 0 !important;
          }
        }
      `}</style>

      {/* Logout Confirmation Dialog */}
      <ConfirmDialog
        isOpen={showLogoutConfirm}
        onClose={() => setShowLogoutConfirm(false)}
        onConfirm={logout}
        title="Logout"
        message="Are you sure you want to logout?"
        confirmText="Logout"
        cancelText="Cancel"
        variant="danger"
      />
    </div>
  );
}
