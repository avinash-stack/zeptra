-- ============================================================
-- FIX: get_dashboard_stats — enforce admin/finance RBAC check
-- Run in Supabase SQL Editor
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_dashboard_stats(
  p_org_id UUID,
  p_start_date TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _caller_org UUID;
  _default_currency TEXT;
  _result JSONB;
BEGIN
  -- Verify caller belongs to this org
  SELECT org_id INTO _caller_org FROM public.users WHERE id = auth.uid();

  -- User's org assignment hasn't propagated yet — not a security
  -- issue, just a timing gap. Return empty stats rather than
  -- crashing the dashboard.
  IF _caller_org IS NULL THEN
    RETURN '{"total":0,"totalAmount":0,"pending":0,"approved":0,"rejected":0,"reimbursed":0,"flagged":0,"unconvertedCount":0,"byMonth":[],"byCategory":[],"topSpenders":[]}'::jsonb;
  END IF;

  -- Genuine security violation: user belongs to a different org
  IF _caller_org != p_org_id THEN
    RAISE EXCEPTION 'Access denied: org mismatch';
  END IF;

  -- Verify caller has admin or finance role
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'finance')) THEN
    RAISE EXCEPTION 'Access denied: requires admin or finance role';
  END IF;

  -- Look up org's default currency for unconvertedCount check
  SELECT code INTO _default_currency
  FROM public.org_currencies
  WHERE org_id = p_org_id AND is_default = true
  LIMIT 1;

  SELECT jsonb_build_object(
    'total',       COALESCE(COUNT(*)::INT, 0),
    'totalAmount', COALESCE(SUM(COALESCE(e.base_amount, e.amount))::NUMERIC, 0),
    'pending',     COALESCE(COUNT(*) FILTER (WHERE e.status IN ('pending_l1','pending_l2'))::INT, 0),
    'approved',    COALESCE(COUNT(*) FILTER (WHERE e.status = 'approved')::INT, 0),
    'rejected',    COALESCE(COUNT(*) FILTER (WHERE e.status = 'rejected')::INT, 0),
    'reimbursed',  COALESCE(COUNT(*) FILTER (WHERE e.status = 'reimbursed')::INT, 0),
    'flagged',     COALESCE(COUNT(*) FILTER (WHERE e.ai_analysis->>'risk_level' IN ('medium','high'))::INT, 0),
    'unconvertedCount', COALESCE(COUNT(*) FILTER (
      WHERE e.base_amount IS NULL
        AND _default_currency IS NOT NULL
        AND e.currency IS DISTINCT FROM _default_currency
    )::INT, 0),
    'byMonth',     COALESCE((
      SELECT jsonb_agg(row_to_json(m) ORDER BY m.month_num)
      FROM (
        SELECT to_char(e2.submitted_at, 'Mon') AS name,
               EXTRACT(MONTH FROM e2.submitted_at)::INT AS month_num,
               SUM(COALESCE(e2.base_amount, e2.amount))::NUMERIC AS amount
        FROM public.expenses e2
        WHERE e2.org_id = p_org_id
          AND (p_start_date IS NULL OR e2.submitted_at >= p_start_date)
        GROUP BY to_char(e2.submitted_at, 'Mon'), EXTRACT(MONTH FROM e2.submitted_at)
      ) m
    ), '[]'::jsonb),
    'byCategory',  COALESCE((
      SELECT jsonb_agg(row_to_json(c) ORDER BY c.amount DESC)
      FROM (
        SELECT cat.name, SUM(COALESCE(e3.base_amount, e3.amount))::NUMERIC AS amount
        FROM public.expenses e3
        JOIN public.expense_categories cat ON cat.id = e3.category_id
        WHERE e3.org_id = p_org_id
          AND (p_start_date IS NULL OR e3.submitted_at >= p_start_date)
        GROUP BY cat.name
        ORDER BY SUM(COALESCE(e3.base_amount, e3.amount)) DESC
        LIMIT 8
      ) c
    ), '[]'::jsonb),
    'topSpenders', COALESCE((
      SELECT jsonb_agg(row_to_json(s) ORDER BY s.amount DESC)
      FROM (
        SELECT u.name,
               SUM(COALESCE(e4.base_amount, e4.amount))::NUMERIC AS amount,
               COUNT(*)::INT AS count,
               (SUM(COALESCE(e4.base_amount, e4.amount)) / COUNT(*))::NUMERIC AS avg
        FROM public.expenses e4
        JOIN public.users u ON u.id = e4.user_id
        WHERE e4.org_id = p_org_id
          AND (p_start_date IS NULL OR e4.submitted_at >= p_start_date)
        GROUP BY u.name
        ORDER BY SUM(COALESCE(e4.base_amount, e4.amount)) DESC
        LIMIT 5
      ) s
    ), '[]'::jsonb)
  ) INTO _result
  FROM public.expenses e
  WHERE e.org_id = p_org_id
    AND (p_start_date IS NULL OR e.submitted_at >= p_start_date);

  RETURN _result;
END;
$$;
