import React from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/contexts/AuthContext';
import { usePlanLimit } from '@/hooks/usePlanLimit';
import { LogOut } from 'lucide-react';

interface TrialExpiredWallProps {
  onUpgradeClick: () => void;
}

const TrialExpiredWall: React.FC<TrialExpiredWallProps> = ({ onUpgradeClick }) => {
  const { hasRole, signOut, organization } = useAuth();
  const { userCount, expenseCount } = usePlanLimit();
  const isAdmin = hasRole('admin');

  const country = (organization as { country?: string } | null)?.country || 'IN';
  const isIndia = country === 'IN';
  const currency = isIndia ? '₹' : '$';
  const pricePerUser = isIndia ? 49 : 1;
  const monthlyTotal = pricePerUser * Math.max(userCount, 1);
  const orgSlug = organization?.slug || 'ORG';

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary/10 via-background to-info/10 p-4">
      <Card className="w-full max-w-lg shadow-2xl border-0">
        <CardHeader className="text-center space-y-4">
          <div className="mx-auto w-32 h-32 flex items-center justify-center bg-white dark:bg-white/95 rounded-2xl shadow-sm p-4">
            <img
              src="/zeptra-logo.png"
              alt="Zeptra Logo"
              className="w-full h-full object-contain"
            />
          </div>
          {isAdmin ? (
            <>
              <CardTitle className="text-2xl">Your Free Trial Has Ended</CardTitle>
              <CardDescription className="text-base">
                Your organization has exceeded the Free plan limits ({userCount} users,{' '}
                {expenseCount} expenses this month). Upgrade to Pro to restore full access.
              </CardDescription>
            </>
          ) : (
            <>
              <CardTitle className="text-2xl">Account Access Suspended</CardTitle>
              <CardDescription className="text-base">
                Your organization's trial has ended and requires an upgrade. Please contact your
                administrator to restore access.
              </CardDescription>
            </>
          )}
        </CardHeader>

        <CardContent className="space-y-6">
          {isAdmin && (
            <>
              <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 text-center">
                <p className="text-sm text-muted-foreground">
                  {currency}{pricePerUser}/user/month
                </p>
                <div className="mt-2 flex items-baseline justify-center gap-1">
                  <span className="text-3xl font-bold text-primary">
                    {currency}{monthlyTotal.toLocaleString()}
                  </span>
                  <span className="text-sm text-muted-foreground">/month estimated</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {currency}{pricePerUser} × {userCount} user{userCount !== 1 ? 's' : ''}
                </p>
              </div>

              <Button
                className="w-full bg-gradient-to-r from-primary to-accent font-semibold"
                size="lg"
                onClick={onUpgradeClick}
              >
                Upgrade to Pro
              </Button>

              <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-2 text-sm">
                <p className="font-semibold text-foreground">Bank transfer instructions</p>
                <p className="text-muted-foreground">
                  Transfer {currency}{monthlyTotal.toLocaleString()} to our account. We'll activate
                  Pro within 24 hours of confirmation.
                </p>
                <div className="flex items-center gap-2 pt-1">
                  <span className="text-muted-foreground">Reference:</span>
                  <Badge variant="outline" className="font-mono text-xs px-2 py-1 border-primary/30 bg-primary/5">
                    ZEPTRA-{orgSlug}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground pt-1">
                  Email payment confirmation to activate your account.
                </p>
              </div>
            </>
          )}

          <div className="flex justify-center pt-2">
            {isAdmin ? (
              <button
                type="button"
                onClick={signOut}
                className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                <LogOut className="h-4 w-4" />
                Sign Out
              </button>
            ) : (
              <Button variant="outline" onClick={signOut} className="gap-2">
                <LogOut className="h-4 w-4" />
                Sign Out
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default TrialExpiredWall;
