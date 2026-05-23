import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import type { Subscription, PlanLimit, PlanType } from '@/types/database';

interface PlanLimitState {
  plan: PlanType;
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
      // Fetch subscription for this org
      const { data: subData } = await supabase
        .from('subscriptions')
        .select('*')
        .eq('org_id', orgId)
        .single();

      const sub = subData as Subscription | null;
      setSubscription(sub);

      // Fetch plan limits for the current plan
      const currentPlan = sub?.plan || 'free';
      const { data: limitData } = await supabase
        .from('plan_limits')
        .select('*')
        .eq('plan', currentPlan)
        .single();

      setLimits(limitData as PlanLimit | null);

      // Count users in this org
      const { count: uCount } = await supabase
        .from('users')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', orgId);

      setUserCount(uCount || 0);

      // Count expenses this month for this org's users
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const { count: eCount } = await supabase
        .from('expenses')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', startOfMonth);

      setExpenseCount(eCount || 0);
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

  // -1 means unlimited
  const userLimitReached = limits
    ? limits.max_users !== -1 && userCount >= limits.max_users
    : false;

  const expenseLimitReached = limits
    ? limits.max_expenses_per_month !== -1 && expenseCount >= limits.max_expenses_per_month
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
  };
}
