import { Link, useLocation, Outlet, Navigate, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { 
  Zap, LayoutDashboard, Phone, Settings, BarChart3, 
  Bot, LogOut, ChevronLeft, Menu
} from 'lucide-react';
import { useState, useEffect } from 'react';
import { useAuthStore } from '../../store/auth';
import { useOrganizationStore } from '../../store/organization';
import { cn } from '../../lib/utils';

const navItems = [
  { icon: LayoutDashboard, label: 'Overview', href: '/dashboard' },
  { icon: Phone, label: 'Calls', href: '/dashboard/calls' },
  { icon: Bot, label: 'Voice Agents', href: '/dashboard/agents' },
  { icon: BarChart3, label: 'Analytics', href: '/dashboard/analytics' },
  { icon: Settings, label: 'Settings', href: '/dashboard/settings' },
];

export function DashboardLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
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

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] flex">
      {/* Mobile overlay */}
      {mobileOpen && (
        <div 
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <motion.aside
        initial={false}
        animate={{ width: collapsed ? 80 : 260 }}
        className={cn(
          'fixed lg:relative h-screen bg-[#0d0d12]/95 backdrop-blur-xl border-r border-white/5 z-50 flex flex-col',
          'transition-transform duration-300',
          mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        )}
      >
        {/* Logo */}
        <div className="p-4 flex items-center justify-between border-b border-white/5">
          <Link to="/dashboard" className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center shadow-lg shadow-purple-500/25 flex-shrink-0">
              <Zap size={20} className="text-white" />
            </div>
            {!collapsed && (
              <span className="text-xl font-bold whitespace-nowrap text-white">
                VocaAI
              </span>
            )}
          </Link>
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="hidden lg:flex p-2 text-white/60 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
          >
            <ChevronLeft size={18} className={cn('transition-transform', collapsed && 'rotate-180')} />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-3 space-y-1">
          {navItems.map((item) => {
            const isActive = location.pathname === item.href || 
              (item.href !== '/dashboard' && location.pathname.startsWith(item.href));
            return (
              <Link
                key={item.href}
                to={item.href}
                onClick={() => setMobileOpen(false)}
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all',
                  isActive 
                    ? 'bg-purple-500/10 text-purple-400 border border-purple-500/30' 
                    : 'text-white/60 hover:text-white hover:bg-white/5'
                )}
              >
                <item.icon size={20} className="flex-shrink-0" />
                {!collapsed && <span className="font-medium">{item.label}</span>}
              </Link>
            );
          })}
        </nav>

        {/* User */}
        <div className="p-3 border-t border-white/5">
          {!collapsed && (
            <div className="px-3 py-2 mb-2">
              <p className="text-sm font-medium text-white truncate">{user?.name}</p>
              <p className="text-xs text-white/50 truncate">{user?.email}</p>
            </div>
          )}
          <button
            onClick={logout}
            className="flex items-center gap-3 px-3 py-2.5 w-full rounded-xl text-white/60 hover:text-red-400 hover:bg-red-500/10 transition-all"
          >
            <LogOut size={20} className="flex-shrink-0" />
            {!collapsed && <span className="font-medium">Logout</span>}
          </button>
        </div>
      </motion.aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-h-screen">
        {/* Mobile header */}
        <header className="lg:hidden sticky top-0 z-30 bg-[#0d0d12]/90 backdrop-blur-xl border-b border-white/5 px-4 py-3 flex items-center gap-4">
          <button
            onClick={() => setMobileOpen(true)}
            className="p-2 text-white/60 hover:text-white"
          >
            <Menu size={24} />
          </button>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
              <Zap size={14} className="text-white" />
            </div>
            <span className="font-bold text-white">VocaAI</span>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
