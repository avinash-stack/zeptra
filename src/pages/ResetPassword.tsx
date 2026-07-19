import React, { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Loader2, Lock, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const ResetPassword: React.FC = () => {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [sessionInvalid, setSessionInvalid] = useState(false);

  // Wait for auth to finish loading, then check for a valid session.
  // Supabase's detectSessionInUrl exchanges the URL token automatically.
  useEffect(() => {
    if (authLoading) return;

    if (!user) {
      // Give a short grace period for the token exchange to complete
      const timer = window.setTimeout(() => {
        setSessionInvalid(true);
      }, 2000);
      return () => window.clearTimeout(timer);
    }
  }, [authLoading, user]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!user) {
      toast.error('Your reset session is not available. Please request a new reset link.');
      return;
    }

    if (password.length < 8) {
      toast.error('Password must be at least 8 characters.');
      return;
    }

    if (password !== confirmPassword) {
      toast.error('Passwords do not match.');
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;

      // Sign out so the user re-authenticates with their new password
      await supabase.auth.signOut();
      toast.success('Password updated — please log in.');
      navigate('/login', { replace: true });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to update password';
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary/10 via-background to-info/10 p-4">
      <Card className="w-full max-w-md shadow-2xl border-0">
        <CardHeader className="text-center space-y-4">
          <div className="mx-auto w-32 h-32 flex items-center justify-center bg-white dark:bg-white/95 rounded-2xl shadow-sm p-4 mb-2">
            <img src="/zeptra-logo.png" alt="Zeptra Logo" className="w-full h-full object-contain" />
          </div>
          <div>
            <CardTitle className="text-xl font-bold">Set New Password</CardTitle>
            <CardDescription>
              {user
                ? 'Enter your new password below.'
                : sessionInvalid
                  ? 'This reset link is invalid or has expired.'
                  : 'Verifying your reset link…'}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {user ? (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="new-password">New Password</Label>
                <Input
                  id="new-password"
                  type="password"
                  placeholder="At least 8 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm-password">Confirm Password</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  placeholder="Re-enter your password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                />
              </div>
              <Button
                type="submit"
                className="w-full bg-gradient-to-r from-primary to-accent"
                disabled={saving}
              >
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Update Password
              </Button>
            </form>
          ) : sessionInvalid ? (
            <div className="space-y-4">
              <p className="text-sm text-center text-muted-foreground">
                Please request a new password reset link.
              </p>
              <Link to="/forgot-password">
                <Button className="w-full bg-gradient-to-r from-primary to-accent">
                  Request new reset link
                </Button>
              </Link>
              <Link
                to="/login"
                className="flex items-center justify-center text-sm text-muted-foreground hover:text-primary transition-colors"
              >
                Back to login
              </Link>
            </div>
          ) : (
            <div className="flex items-center justify-center py-4">
              <div className="w-6 h-6 border-4 border-primary border-t-transparent rounded-full animate-spin" />
              <span className="ml-3 text-sm text-muted-foreground">Verifying…</span>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default ResetPassword;
