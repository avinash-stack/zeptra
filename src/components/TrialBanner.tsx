import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { X, Info } from 'lucide-react';
import { usePlanLimit } from '@/hooks/usePlanLimit';

interface TrialBannerProps {
  onUpgradeClick: () => void;
}

const TrialBanner: React.FC<TrialBannerProps> = ({ onUpgradeClick }) => {
  const {
    plan,
    isInTrial,
    trialDaysRemaining,
    trialWarning,
    trialExpired,
    trialEnd,
    isTrialBlockRequired,
  } = usePlanLimit();
  const [dismissed, setDismissed] = useState(false);

  // STATE 5: paid plans — no banner
  if (plan === 'pro' || plan === 'enterprise') return null;

  // No trial ever started
  if (!trialEnd) return null;

  // STATE 4: full-page wall handles this
  if (isTrialBlockRequired) return null;

  // STATE 2: urgent trial warning (not dismissible)
  if (isInTrial && trialWarning) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm">
        <div className="flex-1">
          <span className="font-semibold text-destructive">
            🚨 Only {trialDaysRemaining} day{trialDaysRemaining !== 1 ? 's' : ''} left in your trial!
          </span>{' '}
          <span className="text-muted-foreground">
            Upgrade now to avoid losing access.
          </span>
        </div>
        <Button
          size="sm"
          variant="destructive"
          className="shrink-0 text-xs font-semibold"
          onClick={onUpgradeClick}
        >
          Upgrade Now
        </Button>
      </div>
    );
  }

  // STATE 1: active trial with more than 3 days (dismissible)
  if (isInTrial && trialDaysRemaining > 3 && !dismissed) {
    return (
      <div className="relative flex items-center gap-3 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm">
        <div className="flex-1">
          <span className="font-semibold text-warning">
            ⏳ {trialDaysRemaining} days left in your Pro trial.
          </span>{' '}
          <span className="text-muted-foreground">
            Upgrade now to keep unlimited access.
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

  // STATE 3: trial ended, within free limits (dismissible info banner)
  if (trialExpired && plan === 'free' && !isTrialBlockRequired && !dismissed) {
    return (
      <div className="relative flex items-center gap-3 rounded-lg border border-info/30 bg-info/10 px-4 py-3 text-sm">
        <Info className="h-5 w-5 shrink-0 text-info" />
        <div className="flex-1">
          <span className="font-semibold text-info">
            Your trial has ended. You're now on the Free plan
          </span>{' '}
          <span className="text-muted-foreground">
            (5 users, 50 expenses/month).
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

  return null;
};

export default TrialBanner;
