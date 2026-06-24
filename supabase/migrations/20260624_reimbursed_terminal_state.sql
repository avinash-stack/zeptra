-- ============================================================
-- MIGRATION: Reimbursed terminal state + manager reversal
-- Run against the Supabase database
-- ============================================================

-- 1. Extend the expense_status enum
--    (ALTER TYPE ... ADD VALUE must be outside a transaction in PG < 12,
--     but Supabase runs PG 15 so it's fine either way)
ALTER TYPE public.expense_status ADD VALUE IF NOT EXISTS 'reimbursed';

-- 2. Drop all existing UPDATE policies (prevent stacking)
DROP POLICY IF EXISTS "expense_update" ON public.expenses;
DROP POLICY IF EXISTS "exp_update"     ON public.expenses;

-- 3. Create new unified UPDATE policy
CREATE POLICY "expense_update" ON public.expenses
  FOR UPDATE TO authenticated
  USING (
    public.is_active_user(auth.uid()) = true
    AND status <> 'reimbursed'
    AND (
      (user_id = auth.uid() AND status = 'pending_l1')
      OR current_approver_id = auth.uid()
      OR (
        public.is_manager(auth.uid())
        AND EXISTS (
          SELECT 1 FROM public.approval_history ah
          WHERE ah.expense_id = expenses.id
            AND ah.approver_id = auth.uid()
            AND ah.action IN ('approved', 'rejected')
        )
      )
      OR (public.has_role(auth.uid(), 'finance') AND org_id = public.user_org_id(auth.uid()))
      OR (public.has_role(auth.uid(), 'admin')   AND org_id = public.user_org_id(auth.uid()))
    )
  )
  WITH CHECK (
    org_id = public.user_org_id(auth.uid())
    AND NOT (user_id = auth.uid() AND status IS DISTINCT FROM 'pending_l1')
    AND (status <> 'reimbursed' OR public.has_role(auth.uid(), 'finance'))
  );

-- 4. Replace status transition trigger
CREATE OR REPLACE FUNCTION public.enforce_expense_status_transition()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status IN ('pending_l1', 'pending_l2') AND NEW.current_approver_id IS NULL THEN
    RAISE EXCEPTION 'Pending expenses require a current approver';
  END IF;

  IF NEW.current_approver_id IS NOT NULL AND NEW.current_approver_id = NEW.user_id THEN
    RAISE EXCEPTION 'Submitter cannot be their own approver';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.user_id = auth.uid() AND OLD.status IS DISTINCT FROM NEW.status THEN
    RAISE EXCEPTION 'Submitter cannot change the status of their own expense';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'pending_l1' THEN
      RAISE EXCEPTION 'New expenses must start in pending_l1';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  -- TERMINAL: reimbursed is immutable
  IF OLD.status = 'reimbursed' THEN
    RAISE EXCEPTION 'Cannot change status of a reimbursed expense';
  END IF;

  -- Only Finance can set reimbursed, and only from approved
  IF NEW.status = 'reimbursed' THEN
    IF NOT public.has_role(auth.uid(), 'finance') THEN
      RAISE EXCEPTION 'Only Finance can mark an expense as reimbursed';
    END IF;
    IF OLD.status <> 'approved' THEN
      RAISE EXCEPTION 'Only approved expenses can be marked as reimbursed (current: %)', OLD.status;
    END IF;
    RETURN NEW;
  END IF;

  -- Forward transitions
  IF OLD.status = 'pending_l1' AND NEW.status IN ('pending_l2', 'approved', 'rejected') THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'pending_l2' AND NEW.status IN ('approved', 'rejected') THEN
    RETURN NEW;
  END IF;

  -- Reversals (manager reversal + finance override)
  IF OLD.status = 'approved' AND NEW.status = 'rejected' THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'rejected' AND NEW.status = 'approved' THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Invalid expense status transition from % to %', OLD.status, NEW.status;
END;
$$;

DROP TRIGGER IF EXISTS enforce_expense_status_transition ON public.expenses;
CREATE TRIGGER enforce_expense_status_transition
  BEFORE INSERT OR UPDATE ON public.expenses
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_expense_status_transition();
