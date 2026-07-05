import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { X, Sparkles, AlertTriangle } from 'lucide-react';
import { usePlanLimit } from '@/hooks/usePlanLimit';

interface TrialBannerProps {
  /** Called when the user clicks "Upgrade to Pro" — open the UpgradeModal */
  onUpgradeClick?: () => void;
}

/**
 * TrialBanner — displays contextual banners during and after the
 * 14-day Pro trial. Renders nothing for paid Pro, Enterprise, or
 * orgs that never had a trial.
 */
const TrialBanner: React.FC<TrialBannerProps> = ({ onUpgradeClick }) => {
  const { plan, effectivePlan, isInTrial, trialDaysRemaining, trialExpired, trialEnd } = usePlanLimit();
  const [dismissed, setDismissed] = useState(false);

  // ---- Cases where we show nothing ----
  // Paid pro (admin manually upgraded in DB)
  if (plan === 'pro') return null;
  // Enterprise — always full access
  if (plan === 'enterprise') return null;
  // Free with no trial ever started
  if (!trialEnd) return null;
  // Not in trial and not expired (shouldn't happen, but guard)
  if (!isInTrial && !trialExpired) return null;

  // ---- Active trial banner (dismissible) ----
  if (isInTrial && !dismissed) {
    return (
      <div className="relative flex items-center gap-3 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm">
        <Sparkles className="h-5 w-5 shrink-0 text-warning" />
        <div className="flex-1">
          <span className="font-semibold text-warning">
            🎉 You're on a 14-day free trial of Pro.
          </span>{' '}
          <Badge variant="outline" className="ml-1 border-warning/30 bg-warning/15 text-warning text-xs">
            {trialDaysRemaining} day{trialDaysRemaining !== 1 ? 's' : ''} remaining
          </Badge>
          <span className="ml-1 text-muted-foreground">
            Upgrade now to keep Pro features after your trial ends.
          </span>
        </div>
        <Button
          size="sm"
          className="shrink-0 bg-gradient-to-r from-primary to-accent text-xs font-semibold"
          onClick={onUpgradeClick}
        >
          Upgrade to Pro
        </Button>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          aria-label="Dismiss trial banner"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  // ---- Trial expired banner (NOT dismissible) ----
  if (trialExpired) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm">
        <AlertTriangle className="h-5 w-5 shrink-0 text-destructive" />
        <div className="flex-1">
          <span className="font-semibold text-destructive">
            Your 14-day trial has ended.
          </span>{' '}
          <span className="text-muted-foreground">
            You've been moved to the Free plan. Upgrade to Pro to restore full access.
          </span>
        </div>
        <Button
          size="sm"
          className="shrink-0 bg-gradient-to-r from-primary to-accent text-xs font-semibold"
          onClick={onUpgradeClick}
        >
          Upgrade to Pro
        </Button>
      </div>
    );
  }

  return null;
};

export default TrialBanner;
