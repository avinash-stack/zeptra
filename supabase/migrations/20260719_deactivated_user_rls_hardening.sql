-- ============================================================
-- MIGRATION: Deactivated User RLS Hardening
-- Date: 2026-07-19
-- ============================================================

-- ── Part A: Update is_active_user to handle NULL (no row) ──
CREATE OR REPLACE FUNCTION public.is_active_user(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT is_active FROM public.users WHERE id = _user_id),
    false
  )
$$;

-- ── Part B: Update SELECT RLS policies ──

-- 1. organizations
DROP POLICY IF EXISTS "Members can view own org" ON public.organizations;
CREATE POLICY "Members can view own org" ON public.organizations
  FOR SELECT TO authenticated
  USING (
    id = public.user_org_id(auth.uid())
    AND public.is_active_user(auth.uid())
  );

-- 2. org_currencies
DROP POLICY IF EXISTS "Members can view currencies" ON public.org_currencies;
CREATE POLICY "Members can view currencies" ON public.org_currencies
  FOR SELECT TO authenticated
  USING (
    org_id = public.user_org_id(auth.uid())
    AND public.is_active_user(auth.uid())
  );

-- 3. users: self-read preserved for deactivation detection
DROP POLICY IF EXISTS "Users can view org users" ON public.users;
CREATE POLICY "Users can view org users" ON public.users
  FOR SELECT TO authenticated
  USING (
    id = auth.uid()
    OR (
      public.is_active_user(auth.uid())
      AND org_id = public.user_org_id(auth.uid())
    )
  );

-- 4. user_roles
DROP POLICY IF EXISTS "org_select" ON public.user_roles;
CREATE POLICY "org_select" ON public.user_roles FOR SELECT TO authenticated
  USING (
    public.is_active_user(auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.users
      WHERE id = user_id AND org_id = public.user_org_id(auth.uid())
    )
  );

-- 5. expense_categories
DROP POLICY IF EXISTS "Members can view active categories" ON public.expense_categories;
CREATE POLICY "Members can view active categories" ON public.expense_categories
  FOR SELECT TO authenticated
  USING (
    public.is_active_user(auth.uid())
    AND (
      (org_id = public.user_org_id(auth.uid()) AND is_active = true)
      OR (org_id = public.user_org_id(auth.uid()) AND public.has_role(auth.uid(), 'admin'))
    )
  );

-- 6. expenses
DROP POLICY IF EXISTS "User sees org-scoped expenses" ON public.expenses;
DROP POLICY IF EXISTS "Employee sees own expenses" ON public.expenses;
CREATE POLICY "User sees org-scoped expenses" ON public.expenses
  FOR SELECT TO authenticated
  USING (
    public.is_active_user(auth.uid())
    AND (
      user_id = auth.uid()
      OR current_approver_id = auth.uid()
      OR public.is_manager_of(auth.uid(), user_id)
      OR (
        public.has_any_role(auth.uid(), ARRAY['admin', 'finance'])
        AND user_id IN (SELECT public.org_user_ids(public.user_org_id(auth.uid())))
      )
    )
  );

-- 7. approval_history
DROP POLICY IF EXISTS "View org approval history" ON public.approval_history;
DROP POLICY IF EXISTS "View approval history" ON public.approval_history;
CREATE POLICY "View org approval history" ON public.approval_history
  FOR SELECT TO authenticated
  USING (
    public.is_active_user(auth.uid())
    AND expense_id IN (
      SELECT id FROM public.expenses
      WHERE user_id IN (SELECT public.org_user_ids(public.user_org_id(auth.uid())))
        OR user_id = auth.uid()
        OR current_approver_id = auth.uid()
    )
  );

-- Force PostgREST to reload schema cache
NOTIFY pgrst, 'reload schema';
