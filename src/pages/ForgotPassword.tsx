import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, ArrowLeft, Mail, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase, isSupabaseConfigured } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const ForgotPassword: React.FC = () => {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!isSupabaseConfigured) {
      toast.error('Supabase is not configured.');
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: 'https://app.getzeptra.com/reset-password',
      });
      if (error) throw error;
      setSent(true);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to send reset link';
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary/10 via-background to-info/10 p-4">
      <Card className="w-full max-w-md shadow-2xl border-0">
        <CardHeader className="text-center space-y-4">
          <div className="mx-auto w-32 h-32 flex items-center justify-center bg-white dark:bg-white/95 rounded-2xl shadow-sm p-4 mb-2">
            <img src="/zeptra-logo.png" alt="Zeptra Logo" className="w-full h-full object-contain" />
          </div>
          <div>
            <CardTitle className="text-xl font-bold">Reset Your Password</CardTitle>
            <CardDescription>
              {sent
                ? "We've sent you a reset link."
                : "Enter your email and we'll send you a link to reset your password."}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {sent ? (
            <div className="space-y-4">
              <div className="flex flex-col items-center gap-3 py-4 text-center">
                <CheckCircle2 className="h-10 w-10 text-green-500" />
                <p className="text-sm text-muted-foreground">
                  Check your email for a reset link. If you don't see it, check your spam folder.
                </p>
              </div>
              <Link
                to="/login"
                className="flex items-center justify-center gap-2 text-sm text-muted-foreground hover:text-primary transition-colors"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to login
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="reset-email">Email</Label>
                <Input
                  id="reset-email"
                  type="email"
                  placeholder="you@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <Button
                type="submit"
                className="w-full bg-gradient-to-r from-primary to-accent"
                disabled={loading || !isSupabaseConfigured}
              >
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                <Mail className="mr-2 h-4 w-4" />
                Send reset link
              </Button>
              <Link
                to="/login"
                className="flex items-center justify-center gap-2 text-sm text-muted-foreground hover:text-primary transition-colors"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to login
              </Link>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default ForgotPassword;
