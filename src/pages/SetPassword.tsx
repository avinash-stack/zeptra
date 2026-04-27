import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Lock, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const SetPassword: React.FC = () => {
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (loading || user) return;

    const inviteTokenInUrl =
      window.location.hash.includes('access_token=') ||
      window.location.hash.includes('type=invite') ||
      window.location.search.includes('type=invite');

    const timer = window.setTimeout(() => {
      if (!inviteTokenInUrl) {
        toast.error('This invite link is invalid or has expired. Please request a new invitation.');
      }
    }, 1200);

    return () => window.clearTimeout(timer);
  }, [loading, user]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!user) {
      toast.error('Your invite session is not available yet. Please reopen the invite link from your email.');
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

      toast.success('Password created successfully.');
      navigate('/app', { replace: true });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to set password';
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
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
          <div className="mx-auto w-20 h-20 rounded-2xl bg-white shadow-lg border border-border flex items-center justify-center">
            <img src="/zeptra-logo.png" alt="Zeptra Logo" className="w-14 h-14 object-contain" />
          </div>
          <div>
            <CardTitle className="text-2xl font-bold">Create Your Password</CardTitle>
            <CardDescription>
              {user
                ? 'Finish accepting your invitation by setting a password for your account.'
                : 'Your invitation link could not be verified.'}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {user ? (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="password">New Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="At least 8 characters"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Confirm Password</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  placeholder="Re-enter your password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  required
                />
              </div>
              <Button
                type="submit"
                className="w-full bg-gradient-to-r from-primary to-info"
                disabled={saving}
              >
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save Password
              </Button>
            </form>
          ) : (
            <Button className="w-full bg-gradient-to-r from-primary to-info" onClick={() => navigate('/login', { replace: true })}>
              Back to Login
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default SetPassword;
