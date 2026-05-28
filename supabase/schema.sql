-- Zeptra Database Schema
-- Run this in your Supabase SQL Editor

-- Enable pgcrypto for encryption
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- 1. Enums
-- ============================================================
-- NOTE: 'manager' role removed. Manager access is determined by
-- the users.manager_id relationship (anyone tagged as a
-- manager_id on another user's profile gets approval access).
DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('admin', 'employee', 'hr', 'finance');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE public.expense_status AS ENUM ('pending_l1', 'pending_l2', 'approved', 'rejected');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE public.approval_action AS ENUM ('approved', 'rejected', 'reassigned');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE public.profile_status AS ENUM ('active', 'inactive');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- ============================================================
-- 2. Organizations table
-- ============================================================
CREATE TABLE public.organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  corporate_email TEXT NOT NULL,
  business_phone TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 3. Organization currencies
-- ============================================================
CREATE TABLE public.org_currencies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  symbol TEXT NOT NULL,
  name TEXT NOT NULL,
  is_default BOOLEAN DEFAULT false,
  UNIQUE(org_id, code)
);

-- ============================================================
-- 4. Users table
-- ============================================================
CREATE TABLE public.users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  first_name TEXT,
  last_name TEXT,
  phone TEXT,
  manager_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  tag TEXT,
  status public.profile_status DEFAULT 'active' NOT NULL,
  is_active BOOLEAN DEFAULT true NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 5. User roles table
-- ============================================================
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
  role public.app_role NOT NULL,
  UNIQUE (user_id, role)
);

-- ============================================================
-- 6. Expense categories (org-scoped, admin-editable)
-- ============================================================
CREATE TABLE public.expense_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true NOT NULL,
  gl_code TEXT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(org_id, name)
);

-- ============================================================
-- 7. Expenses table
-- ============================================================
CREATE TABLE public.expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  amount DECIMAL(12,2) NOT NULL CHECK (amount > 0),
  currency TEXT DEFAULT 'USD' NOT NULL,
  category_id UUID NOT NULL REFERENCES public.expense_categories(id),
  description TEXT NOT NULL,
  receipt_url TEXT,
  status public.expense_status DEFAULT 'pending_l1' NOT NULL,
  current_approver_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  version INTEGER NOT NULL DEFAULT 1,
  is_policy_exception BOOLEAN DEFAULT false NOT NULL,
  submitted_at TIMESTAMPTZ DEFAULT now(),
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 8. Approval history
-- ============================================================
CREATE TABLE public.approval_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id UUID NOT NULL REFERENCES public.expenses(id) ON DELETE CASCADE,
  approver_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  action public.approval_action NOT NULL,
  level INT NOT NULL CHECK (level IN (1, 2)),
  reassigned_to UUID REFERENCES public.users(id) ON DELETE SET NULL,
  comments TEXT,
  acted_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 8b. Audit log + exports log
-- ============================================================
CREATE TABLE IF NOT EXISTS public.audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('expense','user','organization','category','approval')),
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('created','updated','approved','rejected','reassigned','invited','deactivated','activated','exported','deleted')),
  changes JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_log_org_idx ON public.audit_log(org_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.exports_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  export_type TEXT NOT NULL CHECK (export_type IN ('csv','tally_xml','audit_csv')),
  record_count INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 9. Helper functions
-- ============================================================

-- Check if user has a specific role
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- Check if user is manager of another user (via users.manager_id)
CREATE OR REPLACE FUNCTION public.is_manager_of(_manager_id UUID, _user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = _user_id AND manager_id = _manager_id
  )
$$;

-- Check if user is a manager of anyone (has direct reports)
CREATE OR REPLACE FUNCTION public.is_manager(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE manager_id = _user_id
  )
$$;

-- Get user's org_id
CREATE OR REPLACE FUNCTION public.user_org_id(_user_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT org_id FROM public.users WHERE id = _user_id
$$;

-- ============================================================
-- 9b. AI analysis column on expenses
-- ============================================================
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS ai_analysis JSONB;

-- ============================================================
-- 10. Enable RLS
-- ============================================================
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_currencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exports_log ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 11. RLS Policies
-- ============================================================

-- Organizations: members can read, admin can update
CREATE POLICY "Members can view own org" ON public.organizations
  FOR SELECT TO authenticated
  USING (id = public.user_org_id(auth.uid()));

CREATE POLICY "Admin can update own org" ON public.organizations
  FOR UPDATE TO authenticated
  USING (id = public.user_org_id(auth.uid()) AND public.has_role(auth.uid(), 'admin'));

-- Org insert: only users with no org yet
DROP POLICY IF EXISTS "Anyone can insert org during bootstrap" ON public.organizations;
CREATE POLICY "bootstrap_insert" ON public.organizations FOR INSERT TO authenticated
  WITH CHECK (NOT EXISTS (
    SELECT 1 FROM public.users WHERE id = auth.uid() AND org_id IS NOT NULL
  ));

-- Org currencies: org members can view, admin can manage
CREATE POLICY "Members can view currencies" ON public.org_currencies
  FOR SELECT TO authenticated
  USING (org_id = public.user_org_id(auth.uid()));

CREATE POLICY "Admin can manage currencies" ON public.org_currencies
  FOR ALL TO authenticated
  USING (org_id = public.user_org_id(auth.uid()) AND public.has_role(auth.uid(), 'admin'))
  WITH CHECK (org_id = public.user_org_id(auth.uid()) AND public.has_role(auth.uid(), 'admin'));

-- Profiles: org members can read, self can update, admin/hr can manage
CREATE POLICY "Users can view org users" ON public.users
  FOR SELECT TO authenticated
  USING (org_id = public.user_org_id(auth.uid()) OR id = auth.uid());

CREATE POLICY "Users can update own profile" ON public.users
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid() AND org_id = public.user_org_id(auth.uid()));

-- User insert/update: must be org-scoped
DROP POLICY IF EXISTS "Admin/HR can insert users" ON public.users;
DROP POLICY IF EXISTS "Admin/HR can update users" ON public.users;
CREATE POLICY "admin_hr_insert" ON public.users FOR INSERT TO authenticated
  WITH CHECK (org_id = public.user_org_id(auth.uid())
    AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'hr')));
CREATE POLICY "admin_hr_update" ON public.users FOR UPDATE TO authenticated
  USING (org_id = public.user_org_id(auth.uid())
    AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'hr')))
  WITH CHECK (org_id = public.user_org_id(auth.uid()));

-- user_roles: org-scoped
DROP POLICY IF EXISTS "Users can view roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admin/HR can manage roles" ON public.user_roles;
CREATE POLICY "org_select" ON public.user_roles FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users
    WHERE id = user_id AND org_id = public.user_org_id(auth.uid())));
CREATE POLICY "admin_hr_all" ON public.user_roles FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users
    WHERE id = user_id AND org_id = public.user_org_id(auth.uid()))
    AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'hr')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.users
    WHERE id = user_id AND org_id = public.user_org_id(auth.uid()))
    AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'hr')));

-- Expense categories: org members can read active, admin can CRUD
CREATE POLICY "Members can view active categories" ON public.expense_categories
  FOR SELECT TO authenticated
  USING (
    (org_id = public.user_org_id(auth.uid()) AND is_active = true)
    OR (org_id = public.user_org_id(auth.uid()) AND public.has_role(auth.uid(), 'admin'))
  );

CREATE POLICY "Admin can manage categories" ON public.expense_categories
  FOR INSERT TO authenticated
  WITH CHECK (org_id = public.user_org_id(auth.uid()) AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admin can update categories" ON public.expense_categories
  FOR UPDATE TO authenticated
  USING (org_id = public.user_org_id(auth.uid()) AND public.has_role(auth.uid(), 'admin'))
  WITH CHECK (org_id = public.user_org_id(auth.uid()) AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admin can delete categories" ON public.expense_categories
  FOR DELETE TO authenticated
  USING (org_id = public.user_org_id(auth.uid()) AND public.has_role(auth.uid(), 'admin'));

-- Expenses: role-based visibility (manager check via users.manager_id)
CREATE POLICY "Employee sees own expenses" ON public.expenses
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR current_approver_id = auth.uid()
    OR public.is_manager_of(auth.uid(), user_id)
    OR (
      org_id = public.user_org_id(auth.uid())
      AND (
        public.has_role(auth.uid(), 'admin')
        OR public.has_role(auth.uid(), 'finance')
      )
    )
  );

CREATE POLICY "Employee can insert own expenses" ON public.expenses
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND org_id = public.user_org_id(auth.uid())
    AND status = 'pending_l1'
    AND category_id IN (
      SELECT id FROM public.expense_categories
      WHERE org_id = public.user_org_id(auth.uid()) AND is_active = true
    )
    AND (
      current_approver_id IS NULL
      OR current_approver_id IN (
        SELECT id FROM public.users
        WHERE org_id = public.user_org_id(auth.uid()) AND id <> auth.uid()
      )
    )
  );

-- Expense update: include finance, block self-approval
DROP POLICY IF EXISTS "expense_update" ON public.expenses;
CREATE POLICY "expense_update" ON public.expenses FOR UPDATE TO authenticated
  USING (
    (user_id = auth.uid() AND status = 'pending_l1')
    OR current_approver_id = auth.uid()
    OR (public.has_role(auth.uid(),'admin') AND org_id = public.user_org_id(auth.uid()))
    OR (public.has_role(auth.uid(),'finance') AND org_id = public.user_org_id(auth.uid()))
  )
  WITH CHECK (
    org_id = public.user_org_id(auth.uid())
    AND NOT (user_id = auth.uid() AND status IS DISTINCT FROM 'pending_l1')
  );

CREATE POLICY "Employee can delete own pending expenses" ON public.expenses
  FOR DELETE TO authenticated
  USING (user_id = auth.uid() AND status = 'pending_l1');

-- Approval history
CREATE POLICY "View approval history" ON public.approval_history
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.expenses e
      WHERE e.id = expense_id
        AND (
          e.user_id = auth.uid()
          OR e.current_approver_id = auth.uid()
          OR public.is_manager_of(auth.uid(), e.user_id)
          OR (
            e.org_id = public.user_org_id(auth.uid())
            AND (
              public.has_role(auth.uid(), 'admin')
              OR public.has_role(auth.uid(), 'finance')
            )
          )
        )
    )
  );

CREATE POLICY "Approvers can insert history" ON public.approval_history
  FOR INSERT TO authenticated
  WITH CHECK (
    approver_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.expenses e
      WHERE e.id = expense_id
        AND e.org_id = public.user_org_id(auth.uid())
        AND e.user_id != auth.uid()  -- Block self-approval audit logs
        AND (
          e.current_approver_id = auth.uid()
          OR public.has_role(auth.uid(), 'admin')
          OR public.has_role(auth.uid(), 'finance')
          OR EXISTS (
            SELECT 1
            FROM public.users submitter
            LEFT JOIN public.users l1_manager ON l1_manager.id = submitter.manager_id
            WHERE submitter.id = e.user_id
              AND (
                submitter.manager_id = auth.uid()
                OR l1_manager.manager_id = auth.uid()
              )
          )
        )
    )
  );

-- ============================================================
-- 12. Storage bucket for receipts
-- ============================================================
INSERT INTO storage.buckets (id, name, public) VALUES ('receipts', 'receipts', false)
ON CONFLICT (id) DO UPDATE SET public = false;

CREATE POLICY "Users can upload receipts" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'receipts' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Storage: restrict receipts to owner only
DROP POLICY IF EXISTS "Anyone can view receipts" ON storage.objects;
CREATE POLICY "owner_select" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'receipts'
    AND (storage.foldername(name))[1] = auth.uid()::text);

-- ============================================================
-- 13. Encryption helpers (pgcrypto)
-- ============================================================
-- Server-side encryption key stored in vault or env.
-- For now we use a deterministic key derivation.
-- In production, use Supabase Vault for key management.

CREATE OR REPLACE FUNCTION public.encrypt_text(plaintext TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  encryption_key TEXT;
BEGIN
  -- Get the encryption key from a server-side config
  -- In production, use Supabase Vault: SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'encryption_key'
  encryption_key := current_setting('app.settings.encryption_key', true);
  IF encryption_key IS NULL OR encryption_key = '' THEN
    -- Fallback: return plaintext if no key configured
    RETURN plaintext;
  END IF;
  RETURN encode(pgp_sym_encrypt(plaintext, encryption_key), 'base64');
END;
$$;

CREATE OR REPLACE FUNCTION public.decrypt_text(ciphertext TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  encryption_key TEXT;
BEGIN
  IF ciphertext IS NULL THEN RETURN NULL; END IF;
  encryption_key := current_setting('app.settings.encryption_key', true);
  IF encryption_key IS NULL OR encryption_key = '' THEN
    RETURN ciphertext;
  END IF;
  BEGIN
    RETURN pgp_sym_decrypt(decode(ciphertext, 'base64'), encryption_key);
  EXCEPTION WHEN OTHERS THEN
    -- If decryption fails (e.g. data was not encrypted), return as-is
    RETURN ciphertext;
  END;
END;
$$;

-- ============================================================
-- 14. Auto-create user profile on signup trigger
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.users (id, name, email, first_name, last_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', NEW.email),
    NEW.email,
    NEW.raw_user_meta_data->>'first_name',
    NEW.raw_user_meta_data->>'last_name'
  );
  -- Default role: employee
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'employee');
  -- Default notification preferences
  INSERT INTO public.notification_preferences (user_id) VALUES (NEW.id);
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- 15. RPC: Create organization (replaces edge function)
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_organization(
  _name TEXT,
  _slug TEXT,
  _corporate_email TEXT,
  _business_phone TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid UUID := auth.uid();
  _org_id UUID;
  _creator_email TEXT;
  _override_plan TEXT;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Create the organization
  INSERT INTO public.organizations (name, slug, corporate_email, business_phone, created_by)
  VALUES (_name, _slug, _corporate_email, _business_phone, _uid)
  RETURNING id INTO _org_id;

  -- Link user to org
  UPDATE public.users SET org_id = _org_id WHERE id = _uid;

  -- Promote to admin (remove default employee, add admin)
  DELETE FROM public.user_roles WHERE user_id = _uid;
  INSERT INTO public.user_roles (user_id, role) VALUES (_uid, 'admin');

  -- Seed default expense categories for this org
  INSERT INTO public.expense_categories (org_id, name) VALUES
    (_org_id, 'Travel'),
    (_org_id, 'Meals'),
    (_org_id, 'Office Supplies'),
    (_org_id, 'Software'),
    (_org_id, 'Equipment'),
    (_org_id, 'Training'),
    (_org_id, 'Communication'),
    (_org_id, 'Miscellaneous');

  -- Seed default currency
  INSERT INTO public.org_currencies (org_id, code, symbol, name, is_default) VALUES
    (_org_id, 'USD', '$', 'US Dollar', true);

  -- Determine initial subscription plan
  SELECT email INTO _creator_email FROM public.users WHERE id = _uid;
  SELECT plan INTO _override_plan FROM public.plan_overrides WHERE email = _creator_email;

  -- Seed a subscription for the new org
  INSERT INTO public.subscriptions (org_id, plan, status)
  VALUES (_org_id, COALESCE(_override_plan, 'free'), 'active');

  RETURN _org_id;
END;
$$;

-- ============================================================
-- 16. RPC: Promote first user to admin (organization bootstrap)
-- ============================================================
CREATE OR REPLACE FUNCTION public.promote_to_admin()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid UUID := auth.uid();
  _admin_count INT;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT COUNT(*) INTO _admin_count
  FROM public.user_roles
  WHERE role = 'admin';

  IF _admin_count > 0 THEN
    RAISE EXCEPTION 'An admin already exists. Cannot self-promote.';
  END IF;

  DELETE FROM public.user_roles WHERE user_id = _uid;
  INSERT INTO public.user_roles (user_id, role) VALUES (_uid, 'admin');
END;
$$;

-- ============================================================
-- 17. Subscriptions table (billing)
-- ============================================================
CREATE TABLE public.subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE UNIQUE,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro', 'enterprise')),
  status TEXT NOT NULL DEFAULT 'active',
  current_period_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  last_event_timestamp TIMESTAMPTZ
);

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can view own subscription" ON public.subscriptions;
DROP POLICY IF EXISTS "admin_all" ON public.subscriptions;
CREATE POLICY "org_select" ON public.subscriptions FOR SELECT TO authenticated
  USING (org_id = public.user_org_id(auth.uid()));

-- ============================================================
-- 18. Plan limits table (reference data)
-- ============================================================
CREATE TABLE public.plan_limits (
  plan TEXT PRIMARY KEY CHECK (plan IN ('free', 'pro', 'enterprise')),
  max_users INT,
  max_expenses_per_month INT,
  has_analytics BOOL DEFAULT false,
  has_api BOOL DEFAULT false
);

ALTER TABLE public.plan_limits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view plan limits" ON public.plan_limits
  FOR SELECT TO authenticated USING (true);

UPDATE public.plan_limits
SET max_users = NULLIF(max_users, -1),
    max_expenses_per_month = NULLIF(max_expenses_per_month, -1);

INSERT INTO public.plan_limits VALUES
  ('free',5,50,false,false),('pro',50,NULL,true,false),('enterprise',NULL,NULL,true,true)
ON CONFLICT DO NOTHING;

-- ============================================================
-- 18b. Backend Plan Overrides
-- ============================================================
CREATE TABLE IF NOT EXISTS public.plan_overrides (
  email TEXT PRIMARY KEY,
  plan TEXT NOT NULL CHECK (plan IN ('free', 'pro', 'enterprise')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.plan_overrides ENABLE ROW LEVEL SECURITY;
-- Only accessible by service role or admins via dashboard (no standard user access needed)

CREATE OR REPLACE FUNCTION public.apply_plan_override()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _org_id UUID;
BEGIN
  -- Find the org_id where the creator has this email
  SELECT o.id INTO _org_id
  FROM public.organizations o
  JOIN public.users u ON o.created_by = u.id
  WHERE u.email = NEW.email
  LIMIT 1;

  IF _org_id IS NOT NULL THEN
    UPDATE public.subscriptions SET plan = NEW.plan WHERE org_id = _org_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_plan_override ON public.plan_overrides;
CREATE TRIGGER on_plan_override AFTER INSERT OR UPDATE ON public.plan_overrides
  FOR EACH ROW EXECUTE FUNCTION public.apply_plan_override();

-- ============================================================
-- 19. Notification preferences
-- ============================================================
CREATE TABLE public.notification_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE UNIQUE,
  on_expense_submitted BOOLEAN NOT NULL DEFAULT true,
  on_expense_approved BOOLEAN NOT NULL DEFAULT true,
  on_expense_rejected BOOLEAN NOT NULL DEFAULT true,
  on_approval_needed BOOLEAN NOT NULL DEFAULT true,
  on_reassigned BOOL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own notification prefs" ON public.notification_preferences;
DROP POLICY IF EXISTS "Users can update own notification prefs" ON public.notification_preferences;
DROP POLICY IF EXISTS "System can insert notification prefs" ON public.notification_preferences;
CREATE POLICY "own_all" ON public.notification_preferences FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ============================================================
-- 20. Expense notification triggers (via pg_net)
-- ============================================================
-- Enable the pg_net extension for async HTTP calls from triggers.
-- This is available on Supabase paid plans and can be enabled in the SQL editor.
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.notify_expense_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _event TEXT;
  _supabase_url TEXT;
  _service_role_key TEXT;
BEGIN
  -- Determine the event type
  IF TG_OP = 'INSERT' THEN
    _event := 'submitted';
  ELSIF TG_OP = 'UPDATE' THEN
    -- Status changed to approved
    IF NEW.status = 'approved' AND OLD.status != 'approved' THEN
      _event := 'approved';
    -- Status changed to rejected
    ELSIF NEW.status = 'rejected' AND OLD.status != 'rejected' THEN
      _event := 'rejected';
    -- Approver changed (reassignment) while still pending
    ELSIF NEW.current_approver_id IS DISTINCT FROM OLD.current_approver_id
          AND NEW.current_approver_id IS NOT NULL
          AND NEW.status IN ('pending_l1', 'pending_l2') THEN
      _event := 'reassigned';
    ELSE
      -- No notification-worthy change
      RETURN NEW;
    END IF;
  ELSE
    RETURN NEW;
  END IF;

  -- Read config (set via: ALTER DATABASE postgres SET app.settings.supabase_url = '...')
  _supabase_url := current_setting('app.settings.supabase_url', true);
  _service_role_key := current_setting('app.settings.service_role_key', true);

  -- Skip if not configured
  IF _supabase_url IS NULL OR _service_role_key IS NULL THEN
    RAISE WARNING 'notify_expense_change: supabase_url or service_role_key not configured, skipping notification';
    RETURN NEW;
  END IF;

  -- Fire-and-forget HTTP call to the send-notification edge function
  BEGIN
    PERFORM extensions.http_post(
      url := _supabase_url || '/functions/v1/send-notification',
      body := json_build_object('event', _event, 'expense_id', NEW.id)::text,
      headers := json_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || _service_role_key
      )::jsonb
    );
  EXCEPTION WHEN OTHERS THEN
    -- Never block the expense transaction due to notification failure
    RAISE WARNING 'notify_expense_change: failed to call send-notification: %', SQLERRM;
  END;

  RETURN NEW;
END;
$$;

-- Trigger on INSERT (new expense submitted)
CREATE TRIGGER on_expense_inserted
  AFTER INSERT ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.notify_expense_change();

-- Trigger on UPDATE (status change, approver change)
CREATE TRIGGER on_expense_updated
  AFTER UPDATE ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.notify_expense_change();

-- ============================================================
-- 20b. Org_id + version + audit logging triggers
-- ============================================================
CREATE OR REPLACE FUNCTION public.set_expense_org_id()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.org_id := public.user_org_id(NEW.user_id);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS set_expense_org_id ON public.expenses;
CREATE TRIGGER set_expense_org_id BEFORE INSERT ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.set_expense_org_id();

CREATE OR REPLACE FUNCTION public.set_expense_policy_exception()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _monthly_limit DECIMAL(12,2);
  _per_expense_limit DECIMAL(12,2);
  _month_spend DECIMAL(12,2);
BEGIN
  SELECT monthly_limit, per_expense_limit
  INTO _monthly_limit, _per_expense_limit
  FROM public.category_limits
  WHERE org_id = NEW.org_id AND category_id = NEW.category_id;

  SELECT COALESCE(SUM(amount), 0)
  INTO _month_spend
  FROM public.expenses
  WHERE org_id = NEW.org_id
    AND category_id = NEW.category_id
    AND id <> NEW.id
    AND status IN ('pending_l1', 'pending_l2', 'approved')
    AND submitted_at >= date_trunc('month', NEW.submitted_at)
    AND submitted_at < date_trunc('month', NEW.submitted_at) + interval '1 month';

  NEW.is_policy_exception :=
    (_per_expense_limit IS NOT NULL AND NEW.amount > _per_expense_limit)
    OR (_monthly_limit IS NOT NULL AND (_month_spend + NEW.amount) > _monthly_limit);

  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS zz_set_expense_policy_exception ON public.expenses;
CREATE TRIGGER zz_set_expense_policy_exception BEFORE INSERT OR UPDATE OF amount, category_id, status, submitted_at ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.set_expense_policy_exception();

CREATE OR REPLACE FUNCTION public.increment_expense_version()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.version := OLD.version + 1;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS on_expense_version_bump ON public.expenses;
CREATE TRIGGER on_expense_version_bump BEFORE UPDATE ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.increment_expense_version();

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

  IF OLD.status = 'pending_l1' AND NEW.status IN ('pending_l2', 'approved', 'rejected') THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'pending_l2' AND NEW.status IN ('approved', 'rejected') THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Invalid expense status transition from % to %', OLD.status, NEW.status;
END;
$$;
DROP TRIGGER IF EXISTS enforce_expense_status_transition ON public.expenses;
CREATE TRIGGER enforce_expense_status_transition BEFORE INSERT OR UPDATE ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.enforce_expense_status_transition();

CREATE OR REPLACE FUNCTION public.enforce_plan_limits()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _plan TEXT;
  _max_expenses INT;
  _current_count BIGINT;
BEGIN
  SELECT plan INTO _plan FROM public.subscriptions WHERE org_id = NEW.org_id;
  IF _plan IS NULL THEN _plan := 'free'; END IF;

  SELECT max_expenses_per_month INTO _max_expenses FROM public.plan_limits WHERE plan = _plan;

  IF _max_expenses IS NOT NULL THEN
    SELECT public.org_expense_count_this_month(NEW.org_id) INTO _current_count;
    IF _current_count >= _max_expenses THEN
      RAISE EXCEPTION 'Plan limit reached: Maximum expenses per month exceeded.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS enforce_plan_limits ON public.expenses;
CREATE TRIGGER enforce_plan_limits BEFORE INSERT ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.enforce_plan_limits();

CREATE OR REPLACE FUNCTION public.log_expense_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.audit_log(org_id,actor_id,entity_type,entity_id,action,changes)
    VALUES(NEW.org_id,NEW.user_id,'expense',NEW.id::TEXT,'created',
      jsonb_build_object('amount',NEW.amount,'currency',NEW.currency,'status',NEW.status));
  ELSIF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO public.audit_log(org_id,actor_id,entity_type,entity_id,action,changes)
    VALUES(NEW.org_id,COALESCE(auth.uid(),NEW.current_approver_id,NEW.user_id),
      'expense',NEW.id::TEXT,
      CASE NEW.status WHEN 'approved' THEN 'approved'
        WHEN 'rejected' THEN 'rejected' ELSE 'updated' END,
      jsonb_build_object('from',OLD.status,'to',NEW.status));
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS on_expense_change ON public.expenses;
CREATE TRIGGER on_expense_change AFTER INSERT OR UPDATE ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.log_expense_change();

CREATE OR REPLACE FUNCTION public.log_export()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.audit_log(org_id,actor_id,entity_type,entity_id,action,changes)
  VALUES(NEW.org_id,NEW.actor_id,'organization',NEW.org_id::TEXT,'exported',
    jsonb_build_object('type',NEW.export_type,'count',NEW.record_count));
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS on_export ON public.exports_log;
CREATE TRIGGER on_export AFTER INSERT ON public.exports_log
  FOR EACH ROW EXECUTE FUNCTION public.log_export();

CREATE OR REPLACE FUNCTION public.log_user_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _action TEXT;
  _org_id UUID;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.org_id IS NULL THEN
      RETURN NEW;
    END IF;
    _action := 'invited';
    _org_id := NEW.org_id;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.org_id IS NULL AND NEW.org_id IS NOT NULL THEN
      _action := 'invited';
    ELSIF OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'inactive' THEN
      _action := 'deactivated';
    ELSIF OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'active' THEN
      _action := 'activated';
    ELSE
      _action := 'updated';
    END IF;
    _org_id := COALESCE(NEW.org_id, OLD.org_id);
    IF _org_id IS NULL THEN
      RETURN NEW;
    END IF;
  ELSE
    RETURN NEW;
  END IF;

  INSERT INTO public.audit_log(org_id, actor_id, entity_type, entity_id, action, changes)
  VALUES(
    _org_id,
    auth.uid(),
    'user',
    NEW.id::TEXT,
    _action,
    jsonb_build_object('email', NEW.email, 'status', NEW.status, 'manager_id', NEW.manager_id)
  );
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS on_user_change ON public.users;
CREATE TRIGGER on_user_change AFTER INSERT OR UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.log_user_change();

CREATE OR REPLACE FUNCTION public.log_category_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _row public.expense_categories%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    _row := OLD;
  ELSE
    _row := NEW;
  END IF;

  INSERT INTO public.audit_log(org_id, actor_id, entity_type, entity_id, action, changes)
  VALUES(
    _row.org_id,
    auth.uid(),
    'category',
    _row.id::TEXT,
    CASE TG_OP WHEN 'INSERT' THEN 'created' WHEN 'DELETE' THEN 'deleted' ELSE 'updated' END,
    jsonb_build_object('name', _row.name, 'is_active', _row.is_active, 'gl_code', _row.gl_code)
  );
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS on_category_change ON public.expense_categories;
CREATE TRIGGER on_category_change AFTER INSERT OR UPDATE OR DELETE ON public.expense_categories
  FOR EACH ROW EXECUTE FUNCTION public.log_category_change();

CREATE OR REPLACE FUNCTION public.log_approval_history_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _org_id UUID;
BEGIN
  SELECT org_id INTO _org_id FROM public.expenses WHERE id = NEW.expense_id;
  IF _org_id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.audit_log(org_id, actor_id, entity_type, entity_id, action, changes)
  VALUES(
    _org_id,
    NEW.approver_id,
    'approval',
    NEW.expense_id::TEXT,
    NEW.action::TEXT,
    jsonb_build_object('level', NEW.level, 'reassigned_to', NEW.reassigned_to, 'comments', NEW.comments)
  );
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS on_approval_history_change ON public.approval_history;
CREATE TRIGGER on_approval_history_change AFTER INSERT ON public.approval_history
  FOR EACH ROW EXECUTE FUNCTION public.log_approval_history_change();

-- ============================================================
-- 21. Category spend limits
-- ============================================================
CREATE TABLE public.category_limits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES public.expense_categories(id) ON DELETE CASCADE UNIQUE,
  monthly_limit DECIMAL(12,2),
  per_expense_limit DECIMAL(12,2),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.category_limits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Org members can view category limits" ON public.category_limits;
DROP POLICY IF EXISTS "Admin can insert category limits" ON public.category_limits;
DROP POLICY IF EXISTS "Admin can update category limits" ON public.category_limits;
DROP POLICY IF EXISTS "Admin can delete category limits" ON public.category_limits;
CREATE POLICY "org_select" ON public.category_limits FOR SELECT TO authenticated
  USING (org_id = public.user_org_id(auth.uid()));
CREATE POLICY "admin_all" ON public.category_limits FOR ALL TO authenticated
  USING (org_id = public.user_org_id(auth.uid()) AND public.has_role(auth.uid(),'admin'))
  WITH CHECK (org_id = public.user_org_id(auth.uid()) AND public.has_role(auth.uid(),'admin'));

-- ============================================================
-- 22. Policy exception flag on expenses
-- ============================================================
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS is_policy_exception BOOLEAN DEFAULT false;
UPDATE public.expenses SET is_policy_exception = false WHERE is_policy_exception IS NULL;
ALTER TABLE public.expenses ALTER COLUMN is_policy_exception SET NOT NULL;

-- ============================================================
-- 23. Function: get monthly spend for a category
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
  SELECT COALESCE(SUM(e.amount), 0)
  FROM public.expenses e
  JOIN public.expense_categories c ON c.id = e.category_id
  WHERE e.category_id = p_category_id
    AND c.org_id = p_org_id
    AND p_org_id = public.user_org_id(auth.uid())
    AND e.status IN ('pending_l1', 'pending_l2', 'approved')
    AND e.submitted_at >= date_trunc('month', now())
    AND e.submitted_at < date_trunc('month', now()) + interval '1 month';
$$;

-- ============================================================
-- 24. Org-scoped expense count for plan limits
-- ============================================================
CREATE OR REPLACE FUNCTION public.org_expense_count_this_month(_org_id UUID)
RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*) FROM public.expenses e
  JOIN public.users u ON u.id = e.user_id
  WHERE u.org_id = _org_id
  AND e.created_at >= date_trunc('month', now());
$$;

-- ============================================================
-- 25. GST details on expenses
-- ============================================================
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS gst_details JSONB;

-- ============================================================
-- 26. SECURITY: Multi-org data isolation
-- ============================================================

-- Helper: has_any_role
CREATE OR REPLACE FUNCTION public.has_any_role(_user_id UUID, _roles TEXT[])
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles 
    WHERE user_id = _user_id AND role::text = ANY(_roles)
  );
$$;

-- Helper: get all user IDs in the same org as the current user
CREATE OR REPLACE FUNCTION public.org_user_ids(_org_id UUID)
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.users WHERE org_id = _org_id;
$$;

-- Drop and recreate expense SELECT policy to include org isolation
DROP POLICY IF EXISTS "Employee sees own expenses" ON public.expenses;
CREATE POLICY "User sees org-scoped expenses" ON public.expenses
  FOR SELECT TO authenticated
  USING (
    -- Own expenses
    user_id = auth.uid()
    -- Or assigned approver
    OR current_approver_id = auth.uid()
    -- Or manager of submitter (existing helper)
    OR public.is_manager_of(auth.uid(), user_id)
    -- Or admin/finance, but ONLY within same org
    OR (
      public.has_any_role(auth.uid(), ARRAY['admin', 'finance'])
      AND user_id IN (SELECT public.org_user_ids(public.user_org_id(auth.uid())))
    )
  );

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_select" ON public.audit_log FOR SELECT TO authenticated
  USING (org_id = public.user_org_id(auth.uid()) AND public.has_role(auth.uid(),'admin'));

ALTER TABLE public.exports_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org_insert" ON public.exports_log FOR INSERT TO authenticated
  WITH CHECK (org_id = public.user_org_id(auth.uid()));
CREATE POLICY "admin_select" ON public.exports_log FOR SELECT TO authenticated
  USING (org_id = public.user_org_id(auth.uid()) AND public.has_role(auth.uid(),'admin'));

-- Approval history: only see history for expenses you can see
DROP POLICY IF EXISTS "View approval history" ON public.approval_history;
CREATE POLICY "View org approval history" ON public.approval_history
  FOR SELECT TO authenticated
  USING (
    expense_id IN (
      SELECT id FROM public.expenses
      WHERE user_id IN (SELECT public.org_user_ids(public.user_org_id(auth.uid())))
        OR user_id = auth.uid()
        OR current_approver_id = auth.uid()
    )
  );
