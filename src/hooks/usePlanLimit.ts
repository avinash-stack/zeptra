import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import type { Subscription, PlanLimit, PlanType } from '@/types/database';

interface PlanLimitState {
  /** Raw plan value from the subscriptions table */
  plan: PlanType;
  /** Effective plan after trial logic (use this for limit enforcement) */
  effectivePlan: PlanType;
  subscription: Subscription | null;
  limits: PlanLimit | null;
  userCount: number;
  expenseCount: number;
  isLoading: boolean;
  /** True when the org has hit the user OR expense limit */
  usageExceeded: boolean;
  /** True when the org has hit the user limit specifically */
  userLimitReached: boolean;
  /** True when the org has hit the expense limit specifically */
  expenseLimitReached: boolean;
  /** Check access to a gated feature */
  canAccess: (feature: 'analytics' | 'api') => boolean;
  /** Re-fetch all billing data */
  refetch: () => Promise<void>;
  /** True when org is currently within the trial window */
  isInTrial: boolean;
  /** Days remaining in trial (0 if expired or no trial) */
  trialDaysRemaining: number;
  /** True when trial existed and has passed */
  trialExpired: boolean;
  /** True when 3 or fewer days remain in an active trial */
  trialWarning: boolean;
  /** Trial end date (null if no trial) */
  trialEnd: Date | null;
  /** True when trial expired AND org exceeds free plan limits */
  isTrialBlockRequired: boolean;
}

export function usePlanLimit(): PlanLimitState {
  const { profile } = useAuth();
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [limits, setLimits] = useState<PlanLimit | null>(null);
  const [userCount, setUserCount] = useState(0);
  const [expenseCount, setExpenseCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  const orgId = profile?.org_id;

  const fetchAll = useCallback(async () => {
    if (!orgId) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);

    try {
      const { data: subData } = await supabase
        .from('subscriptions')
        .select('*')
        .eq('org_id', orgId)
        .single();

      const sub = subData as Subscription | null;
      setSubscription(sub);

      const rawPlan: PlanType = sub?.plan || 'free';

      const now = new Date();
      const trialEndRaw = (sub as any)?.trial_end;
      const trialEndDate = trialEndRaw ? new Date(trialEndRaw) : null;
      const isInTrialNow = trialEndDate ? now < trialEndDate : false;

      // During trial: Pro access. After trial: depends on plan in DB.
      const effectivePlan: PlanType = isInTrialNow ? 'pro' : rawPlan;

      const [
        { data: limitData },
        { count: uCount },
        { data: eCount },
      ] = await Promise.all([
        supabase.from('plan_limits').select('*').eq('plan', effectivePlan).single(),
        supabase.from('users').select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('is_active', true),
        supabase.rpc('org_expense_count_this_month', { _org_id: orgId }),
      ]);

      setLimits(limitData as PlanLimit | null);
      setUserCount(uCount || 0);
      setExpenseCount(Number(eCount) || 0);
    } catch (err) {
      console.error('usePlanLimit fetch error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const plan: PlanType = subscription?.plan || 'free';

  const now = new Date();
  const trialEndRaw = (subscription as any)?.trial_end;
  const trialEnd = trialEndRaw ? new Date(trialEndRaw) : null;
  const isInTrial = trialEnd ? now < trialEnd : false;
  const trialExpired = trialEnd ? now > trialEnd : false;
  const trialDaysRemaining = trialEnd
    ? Math.max(0, Math.ceil((trialEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)))
    : 0;
  const trialWarning = trialDaysRemaining <= 3 && isInTrial;

  // During trial: Pro access. Manually upgraded to pro: always pro after trial.
  const effectivePlan: PlanType = isInTrial ? 'pro' : plan;

  const isTrialBlockRequired =
    trialExpired &&
    plan === 'free' &&
    (userCount > 5 || expenseCount > 50);

  const userLimitReached = limits
    ? limits.max_users !== null && userCount >= limits.max_users
    : false;

  const expenseLimitReached = limits
    ? limits.max_expenses_per_month !== null && expenseCount >= limits.max_expenses_per_month
    : false;

  const usageExceeded = userLimitReached || expenseLimitReached;

  const canAccess = (feature: 'analytics' | 'api'): boolean => {
    if (!limits) return false;
    if (feature === 'analytics') return limits.has_analytics;
    if (feature === 'api') return limits.has_api;
    return false;
  };

  return {
    plan,
    effectivePlan,
    subscription,
    limits,
    userCount,
    expenseCount,
    isLoading,
    usageExceeded,
    userLimitReached,
    expenseLimitReached,
    canAccess,
    refetch: fetchAll,
    isInTrial,
    trialDaysRemaining,
    trialExpired,
    trialWarning,
    trialEnd,
    isTrialBlockRequired,
  };
}
