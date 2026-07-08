-- ============================================================
-- FIX: get_category_monthly_spend — use COALESCE(base_amount, amount)
-- Run in Supabase SQL Editor
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_category_monthly_spend(
  p_category_id UUID,
  p_org_id UUID
)
RETURNS DECIMAL
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(COALESCE(e.base_amount, e.amount)), 0)
  FROM public.expenses e
  JOIN public.expense_categories c ON c.id = e.category_id
  WHERE e.category_id = p_category_id
    AND c.org_id = p_org_id
    AND p_org_id = public.user_org_id(auth.uid())
    AND e.status IN ('pending_l1', 'pending_l2', 'approved')
    AND e.submitted_at >= date_trunc('month', now())
    AND e.submitted_at < date_trunc('month', now()) + interval '1 month';
$$;
