import { useEffect } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Landing } from './pages/Landing';
import { Login } from './pages/Login';
import { Signup } from './pages/Signup';
import { ResetPassword } from './pages/ResetPassword';
import { Onboarding } from './pages/Onboarding';
import { DashboardLayout } from './components/layout/DashboardLayout';
import { Overview } from './pages/dashboard/Overview';
import { Calls } from './pages/dashboard/Calls';
import { Agents } from './pages/dashboard/Agents';
import { AgentNew } from './pages/dashboard/AgentNew';
import { AgentDetail } from './pages/dashboard/AgentDetail';
import { Tools } from './pages/dashboard/Tools';
import { ToolNew } from './pages/dashboard/ToolNew';
import { ToolDetail } from './pages/dashboard/ToolDetail';
import { Analytics } from './pages/dashboard/Analytics';
import { Settings } from './pages/dashboard/Settings';
import { useAuthStore } from './store/auth';
import { AlertDialog } from './components/ui/AlertDialog';
import { useAlertStore } from './hooks/useAlert';

function App() {
  const { initialize, isLoading } = useAuthStore();
  const { isOpen, message, type, title, confirmText, closeAlert } = useAlertStore();

  useEffect(() => {
    initialize();
  }, [initialize]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-3 border-purple-500/30 border-t-purple-500 rounded-full animate-spin" />
          <p className="text-white/50 text-sm">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <AlertDialog
        isOpen={isOpen}
        onClose={closeAlert}
        message={message}
        type={type}
        title={title}
        confirmText={confirmText}
      />
      <BrowserRouter>
        <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/onboarding" element={<Onboarding />} />
        <Route path="/dashboard" element={<DashboardLayout />}>
          <Route index element={<Overview />} />
          <Route path="calls" element={<Calls />} />
          <Route path="agents" element={<Agents />} />
          <Route path="agents/new" element={<AgentNew />} />
          <Route path="agents/:id" element={<AgentDetail />} />
          <Route path="tools" element={<Tools />} />
          <Route path="tools/new" element={<ToolNew />} />
          <Route path="tools/:id" element={<ToolDetail />} />
          <Route path="analytics" element={<Analytics />} />
          <Route path="settings" element={<Settings />} />
        </Route>
        </Routes>
      </BrowserRouter>
    </>
  );
}

export default App;
