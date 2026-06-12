import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import AppLayout from "@/components/AppLayout";
import type { AppRole } from "@/types/database";
import Landing from "@/pages/Landing";
import Login from "@/pages/Login";
import OrganizationProfile from "@/pages/OrganizationProfile";
import Dashboard from "@/pages/Dashboard";
import SubmitExpense from "@/pages/SubmitExpense";
import MyExpenses from "@/pages/MyExpenses";
import SetPassword from "@/pages/SetPassword";
import Approvals from "@/pages/Approvals";
import AllExpenses from "@/pages/AllExpenses";
import UserManagement from "@/pages/UserManagement";
import OrgSettings from "@/pages/OrgSettings";
import AccountSettings from "@/pages/AccountSettings";
import Help from "@/pages/Help";
import ProfilePage from "@/pages/Profile";
import AuditLog from "@/pages/AuditLog";
import NotFound from "@/pages/NotFound";

const queryClient = new QueryClient();

const normalizeLegacyHashRoute = () => {
  if (typeof window === "undefined") return;
  if (!window.location.hash.startsWith("#/")) return;

  const hashRoute = window.location.hash.slice(1);
  window.history.replaceState(null, "", hashRoute);
};

normalizeLegacyHashRoute();

class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  constructor(p: { children: React.ReactNode }) { super(p); this.state = { hasError: false }; }
  static getDerivedStateFromError() { return { hasError: true }; }
  render() {
    if (this.state.hasError) return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center p-8">
          <h1 className="text-xl font-bold mb-4">Something went wrong</h1>
          <button className="bg-primary text-white px-4 py-2 rounded"
            onClick={() => { this.setState({ hasError: false }); window.location.href = '/app'; }}>
            Return to dashboard
          </button>
        </div>
      </div>
    );
    return this.props.children;
  }
}

const ProtectedRoute = ({ children, allowedRoles, requireManager }: {
  children: React.ReactNode;
  allowedRoles?: AppRole[];
  requireManager?: boolean;
}) => {
  const { user, loading, profileReady, roles, isManager } = useAuth();
  
  if (loading || (user && !profileReady)) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  
  if (!user) return <Navigate to="/login" replace />;

  // Check role-based access
  if (allowedRoles && !allowedRoles.some(r => roles.includes(r))) {
    // Also allow if requireManager is true and user is a manager
    if (!requireManager || !isManager) {
      return <Navigate to="/app" replace />;
    }
  }

  return <>{children}</>;
};

const AuthRoute = ({ children }: { children: React.ReactNode }) => {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  if (user) return <Navigate to="/app" replace />;
  return <>{children}</>;
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <AppErrorBoundary>
          <BrowserRouter>
            <Routes>
              <Route path="/" element={<AuthRoute><Landing /></AuthRoute>} />
              <Route path="/create-organization" element={<OrganizationProfile />} />
              <Route path="/login" element={<AuthRoute><Login /></AuthRoute>} />
              <Route path="/set-password" element={<SetPassword />} />
              <Route path="/app" element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
                <Route index element={<Dashboard />} />
                <Route path="submit" element={<SubmitExpense />} />
                <Route path="expenses" element={<MyExpenses />} />
                <Route path="approvals" element={
                  <ProtectedRoute allowedRoles={['admin', 'finance']} requireManager>
                    <Approvals />
                  </ProtectedRoute>
                } />
                <Route path="all-expenses" element={
                  <ProtectedRoute allowedRoles={['finance', 'admin']}>
                    <AllExpenses />
                  </ProtectedRoute>
                } />
                <Route path="users" element={
                  <ProtectedRoute allowedRoles={['admin', 'hr']}>
                    <UserManagement />
                  </ProtectedRoute>
                } />
                <Route path="settings" element={
                  <ProtectedRoute allowedRoles={['admin']}>
                    <OrgSettings />
                  </ProtectedRoute>
                } />
                <Route path="audit" element={
                  <ProtectedRoute allowedRoles={['admin']}>
                    <AuditLog />
                  </ProtectedRoute>
                } />
                <Route path="account" element={<AccountSettings />} />
                <Route path="help" element={<Help />} />
                <Route path="profile" element={<ProfilePage />} />
              </Route>
              <Route path="*" element={<NotFound />} />
            </Routes>
          </BrowserRouter>
        </AppErrorBoundary>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
