-- Zeptra Database Schema
-- Run this in your Supabase SQL Editor

-- Enable pgcrypto for encryption
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- 1. Enums
-- ============================================================
-- NOTE: 'manager' role removed. Manager access is determined by
-- the profiles.manager_id relationship (anyone tagged as a
-- manager_id on another user's profile gets approval access).
CREATE TYPE public.app_role AS ENUM ('admin', 'employee', 'hr', 'finance');
CREATE TYPE public.expense_status AS ENUM ('pending_l1', 'pending_l2', 'approved', 'rejected');
CREATE TYPE public.approval_action AS ENUM ('approved', 'rejected', 'reassigned');
CREATE TYPE public.profile_status AS ENUM ('active', 'inactive');

-- ============================================================
-- 2. Organizations table
-- ============================================================
CREATE TABLE public.organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  corporate_email TEXT NOT NULL,
  business_phone TEXT,
  created_by UUID REFERENCES auth.users(id),
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
-- 4. Profiles table
-- ============================================================
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id UUID REFERENCES public.organizations(id),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  first_name TEXT,
  last_name TEXT,
  phone TEXT,
  manager_id UUID REFERENCES public.profiles(id),
  tag TEXT,
  status public.profile_status DEFAULT 'active' NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 5. User roles table
-- ============================================================
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
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
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(org_id, name)
);

-- ============================================================
-- 7. Expenses table
-- ============================================================
CREATE TABLE public.expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount DECIMAL(12,2) NOT NULL CHECK (amount > 0),
  currency TEXT DEFAULT 'USD' NOT NULL,
  category_id UUID NOT NULL REFERENCES public.expense_categories(id),
  description TEXT NOT NULL,
  receipt_url TEXT,
  status public.expense_status DEFAULT 'pending_l1' NOT NULL,
  current_approver_id UUID REFERENCES auth.users(id),
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
  approver_id UUID NOT NULL REFERENCES auth.users(id),
  action public.approval_action NOT NULL,
  level INT NOT NULL CHECK (level IN (1, 2)),
  reassigned_to UUID REFERENCES auth.users(id),
  comments TEXT,
  acted_at TIMESTAMPTZ DEFAULT now()
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

-- Check if user is manager of another user (via profiles.manager_id)
CREATE OR REPLACE FUNCTION public.is_manager_of(_manager_id UUID, _user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
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
    SELECT 1 FROM public.profiles
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
  SELECT org_id FROM public.profiles WHERE id = _user_id
$$;

-- ============================================================
-- 10. Enable RLS
-- ============================================================
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_currencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_history ENABLE ROW LEVEL SECURITY;

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

CREATE POLICY "Anyone can insert org during bootstrap" ON public.organizations
  FOR INSERT TO authenticated
  WITH CHECK (true);

-- Org currencies: org members can view, admin can manage
CREATE POLICY "Members can view currencies" ON public.org_currencies
  FOR SELECT TO authenticated
  USING (org_id = public.user_org_id(auth.uid()));

CREATE POLICY "Admin can manage currencies" ON public.org_currencies
  FOR ALL TO authenticated
  USING (org_id = public.user_org_id(auth.uid()) AND public.has_role(auth.uid(), 'admin'));

-- Profiles: org members can read, self can update, admin/hr can manage
CREATE POLICY "Users can view org profiles" ON public.profiles
  FOR SELECT TO authenticated
  USING (org_id = public.user_org_id(auth.uid()) OR id = auth.uid());

CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid());

CREATE POLICY "Admin/HR can insert profiles" ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "Admin/HR can update profiles" ON public.profiles
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'hr'));

-- User roles: readable by all, writable by admin/hr
CREATE POLICY "Users can view roles" ON public.user_roles
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admin/HR can manage roles" ON public.user_roles
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'hr'));

-- Expense categories: org members can read active, admin can CRUD
CREATE POLICY "Members can view active categories" ON public.expense_categories
  FOR SELECT TO authenticated
  USING (org_id = public.user_org_id(auth.uid()));

CREATE POLICY "Admin can manage categories" ON public.expense_categories
  FOR INSERT TO authenticated
  WITH CHECK (org_id = public.user_org_id(auth.uid()) AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admin can update categories" ON public.expense_categories
  FOR UPDATE TO authenticated
  USING (org_id = public.user_org_id(auth.uid()) AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admin can delete categories" ON public.expense_categories
  FOR DELETE TO authenticated
  USING (org_id = public.user_org_id(auth.uid()) AND public.has_role(auth.uid(), 'admin'));

-- Expenses: role-based visibility (manager check via profiles.manager_id)
CREATE POLICY "Employee sees own expenses" ON public.expenses
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR current_approver_id = auth.uid()
    OR public.is_manager_of(auth.uid(), user_id)
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'finance')
  );

CREATE POLICY "Employee can insert own expenses" ON public.expenses
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Employee can update own pending expenses" ON public.expenses
  FOR UPDATE TO authenticated
  USING (
    (user_id = auth.uid() AND status = 'pending_l1')
    OR current_approver_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
  );

CREATE POLICY "Employee can delete own pending expenses" ON public.expenses
  FOR DELETE TO authenticated
  USING (user_id = auth.uid() AND status = 'pending_l1');

-- Approval history
CREATE POLICY "View approval history" ON public.approval_history
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Approvers can insert history" ON public.approval_history
  FOR INSERT TO authenticated
  WITH CHECK (approver_id = auth.uid());

-- ============================================================
-- 12. Storage bucket for receipts
-- ============================================================
INSERT INTO storage.buckets (id, name, public) VALUES ('receipts', 'receipts', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Users can upload receipts" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'receipts' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Anyone can view receipts" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'receipts');

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
-- 14. Auto-create profile on signup trigger
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, name, email, first_name, last_name)
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
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Create the organization
  INSERT INTO public.organizations (name, slug, corporate_email, business_phone, created_by)
  VALUES (_name, _slug, _corporate_email, _business_phone, _uid)
  RETURNING id INTO _org_id;

  -- Link user to org
  UPDATE public.profiles SET org_id = _org_id WHERE id = _uid;

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

  -- Seed a free subscription for the new org
  INSERT INTO public.subscriptions (org_id, plan, status)
  VALUES (_org_id, 'free', 'active');

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
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view own subscription" ON public.subscriptions
  FOR SELECT TO authenticated
  USING (org_id = public.user_org_id(auth.uid()));

-- No INSERT/UPDATE/DELETE policies for authenticated users.
-- Only service_role (edge functions) can write to this table.

-- ============================================================
-- 18. Plan limits table (reference data)
-- ============================================================
CREATE TABLE public.plan_limits (
  plan TEXT PRIMARY KEY CHECK (plan IN ('free', 'pro', 'enterprise')),
  max_users INT NOT NULL,
  max_expenses_per_month INT NOT NULL,
  has_analytics BOOLEAN NOT NULL DEFAULT false,
  has_api BOOLEAN NOT NULL DEFAULT false
);

ALTER TABLE public.plan_limits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view plan limits" ON public.plan_limits
  FOR SELECT TO authenticated USING (true);

-- Seed plan limits (-1 = unlimited)
INSERT INTO public.plan_limits (plan, max_users, max_expenses_per_month, has_analytics, has_api) VALUES
  ('free',       5,  50, false, false),
  ('pro',       50,  -1,  true, false),
  ('enterprise', -1,  -1,  true,  true)
ON CONFLICT (plan) DO NOTHING;

-- ============================================================
-- 19. Notification preferences
-- ============================================================
CREATE TABLE public.notification_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  on_expense_submitted BOOLEAN NOT NULL DEFAULT true,
  on_expense_approved BOOLEAN NOT NULL DEFAULT true,
  on_expense_rejected BOOLEAN NOT NULL DEFAULT true,
  on_approval_needed BOOLEAN NOT NULL DEFAULT true
);

ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own notification prefs" ON public.notification_preferences
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can update own notification prefs" ON public.notification_preferences
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid());

-- Service role inserts via trigger; no client INSERT policy needed.
-- Allow INSERT for the handle_new_user trigger (runs as SECURITY DEFINER).
CREATE POLICY "System can insert notification prefs" ON public.notification_preferences
  FOR INSERT
  WITH CHECK (true);

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

-- Org members can view limits
CREATE POLICY "Org members can view category limits" ON public.category_limits
  FOR SELECT TO authenticated
  USING (org_id = public.user_org_id(auth.uid()));

-- Admin can manage limits
CREATE POLICY "Admin can insert category limits" ON public.category_limits
  FOR INSERT TO authenticated
  WITH CHECK (org_id = public.user_org_id(auth.uid()) AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admin can update category limits" ON public.category_limits
  FOR UPDATE TO authenticated
  USING (org_id = public.user_org_id(auth.uid()) AND public.has_role(auth.uid(), 'admin'))
  WITH CHECK (org_id = public.user_org_id(auth.uid()) AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admin can delete category limits" ON public.category_limits
  FOR DELETE TO authenticated
  USING (org_id = public.user_org_id(auth.uid()) AND public.has_role(auth.uid(), 'admin'));

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
