-- ============================================================
-- Zeptra Migration Script v2
-- Run this in Supabase SQL Editor
-- WARNING: This will DROP all existing data!
-- ============================================================

-- 0. Drop trigger first
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- 1. Drop existing functions
DROP FUNCTION IF EXISTS public.handle_new_user() CASCADE;
DROP FUNCTION IF EXISTS public.has_role(UUID, public.app_role) CASCADE;
DROP FUNCTION IF EXISTS public.is_manager_of(UUID, UUID) CASCADE;
DROP FUNCTION IF EXISTS public.is_manager(UUID) CASCADE;
DROP FUNCTION IF EXISTS public.user_org_id(UUID) CASCADE;
DROP FUNCTION IF EXISTS public.promote_to_admin() CASCADE;
DROP FUNCTION IF EXISTS public.create_organization(TEXT, TEXT, TEXT, TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.encrypt_text(TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.decrypt_text(TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.ensure_user_profile(UUID, TEXT, TEXT, TEXT, TEXT) CASCADE;

-- 2. Drop existing tables (in dependency order)
DROP TABLE IF EXISTS public.approval_history CASCADE;
DROP TABLE IF EXISTS public.expenses CASCADE;
DROP TABLE IF EXISTS public.expense_categories CASCADE;
DROP TABLE IF EXISTS public.user_roles CASCADE;
DROP TABLE IF EXISTS public.profiles CASCADE;
DROP TABLE IF EXISTS public.users CASCADE;
DROP TABLE IF EXISTS public.org_currencies CASCADE;
DROP TABLE IF EXISTS public.organizations CASCADE;

-- 3. Drop existing enums
DROP TYPE IF EXISTS public.app_role CASCADE;
DROP TYPE IF EXISTS public.expense_status CASCADE;
DROP TYPE IF EXISTS public.approval_action CASCADE;
DROP TYPE IF EXISTS public.profile_status CASCADE;

-- 4. Enable pgcrypto
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- 5. Enums
-- ============================================================
CREATE TYPE public.app_role AS ENUM ('admin', 'employee', 'hr', 'finance');
CREATE TYPE public.expense_status AS ENUM ('pending_l1', 'pending_l2', 'approved', 'rejected');
CREATE TYPE public.approval_action AS ENUM ('approved', 'rejected', 'reassigned');
CREATE TYPE public.profile_status AS ENUM ('active', 'inactive');

-- ============================================================
-- 6. Organizations
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
-- 7. Org currencies
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
-- 8. Users table (renamed from "profiles" for clarity)
-- ============================================================
CREATE TABLE public.users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id UUID REFERENCES public.organizations(id),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  first_name TEXT,
  last_name TEXT,
  phone TEXT,
  manager_id UUID REFERENCES public.users(id),
  tag TEXT,
  status public.profile_status DEFAULT 'active' NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 9. User roles
-- ============================================================
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role public.app_role NOT NULL,
  UNIQUE (user_id, role)
);

-- ============================================================
-- 10. Expense categories (org-scoped)
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
-- 11. Expenses
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
  submitted_at TIMESTAMPTZ DEFAULT now(),
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 12. Approval history
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
-- 13. Helper functions (SECURITY DEFINER = bypass RLS)
-- ============================================================

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role) $$;

CREATE OR REPLACE FUNCTION public.is_manager_of(_manager_id UUID, _user_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (SELECT 1 FROM public.users WHERE id = _user_id AND manager_id = _manager_id) $$;

CREATE OR REPLACE FUNCTION public.is_manager(_user_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (SELECT 1 FROM public.users WHERE manager_id = _user_id) $$;

CREATE OR REPLACE FUNCTION public.user_org_id(_user_id UUID)
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT org_id FROM public.users WHERE id = _user_id $$;

-- ============================================================
-- 14. Ensure user profile exists (callable from client as fallback)
-- ============================================================
CREATE OR REPLACE FUNCTION public.ensure_user_profile(
  _name TEXT DEFAULT NULL,
  _email TEXT DEFAULT NULL,
  _first_name TEXT DEFAULT NULL,
  _last_name TEXT DEFAULT NULL
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid UUID := auth.uid();
  _auth_email TEXT;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  -- Check if profile already exists
  IF EXISTS (SELECT 1 FROM public.users WHERE id = _uid) THEN
    RETURN;
  END IF;

  -- Get email from auth.users if not provided
  IF _email IS NULL OR _email = '' THEN
    SELECT email INTO _auth_email FROM auth.users WHERE id = _uid;
  ELSE
    _auth_email := _email;
  END IF;

  -- Create the profile
  INSERT INTO public.users (id, name, email, first_name, last_name)
  VALUES (
    _uid,
    COALESCE(NULLIF(_name, ''), _auth_email, 'User'),
    COALESCE(_auth_email, ''),
    NULLIF(_first_name, ''),
    NULLIF(_last_name, '')
  );

  -- Default role
  INSERT INTO public.user_roles (user_id, role) VALUES (_uid, 'employee')
  ON CONFLICT (user_id, role) DO NOTHING;
END; $$;

-- ============================================================
-- 15. Enable RLS
-- ============================================================
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_currencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_history ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 16. RLS — Organizations
-- ============================================================
CREATE POLICY "org_select" ON public.organizations FOR SELECT TO authenticated
  USING (id = public.user_org_id(auth.uid()));
CREATE POLICY "org_insert" ON public.organizations FOR INSERT TO authenticated
  WITH CHECK (true);
CREATE POLICY "org_update" ON public.organizations FOR UPDATE TO authenticated
  USING (id = public.user_org_id(auth.uid()) AND public.has_role(auth.uid(), 'admin'));

-- ============================================================
-- 17. RLS — Org Currencies
-- ============================================================
CREATE POLICY "curr_select" ON public.org_currencies FOR SELECT TO authenticated
  USING (org_id = public.user_org_id(auth.uid()));
CREATE POLICY "curr_insert" ON public.org_currencies FOR INSERT TO authenticated
  WITH CHECK (org_id = public.user_org_id(auth.uid()) AND public.has_role(auth.uid(), 'admin'));
CREATE POLICY "curr_update" ON public.org_currencies FOR UPDATE TO authenticated
  USING (org_id = public.user_org_id(auth.uid()) AND public.has_role(auth.uid(), 'admin'));
CREATE POLICY "curr_delete" ON public.org_currencies FOR DELETE TO authenticated
  USING (org_id = public.user_org_id(auth.uid()) AND public.has_role(auth.uid(), 'admin'));

-- ============================================================
-- 18. RLS — Users
-- ============================================================
CREATE POLICY "users_select" ON public.users FOR SELECT TO authenticated
  USING (org_id = public.user_org_id(auth.uid()) OR id = auth.uid());
CREATE POLICY "users_insert" ON public.users FOR INSERT TO authenticated
  WITH CHECK (true);
CREATE POLICY "users_update_self" ON public.users FOR UPDATE TO authenticated
  USING (id = auth.uid());
CREATE POLICY "users_update_admin" ON public.users FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'hr'));

-- ============================================================
-- 19. RLS — User Roles
-- ============================================================
CREATE POLICY "roles_select" ON public.user_roles FOR SELECT TO authenticated
  USING (true);
CREATE POLICY "roles_insert" ON public.user_roles FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'hr'));
CREATE POLICY "roles_update" ON public.user_roles FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'hr'));
CREATE POLICY "roles_delete" ON public.user_roles FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'hr'));

-- ============================================================
-- 20. RLS — Expense Categories
-- ============================================================
CREATE POLICY "cat_select" ON public.expense_categories FOR SELECT TO authenticated
  USING (org_id = public.user_org_id(auth.uid()));
CREATE POLICY "cat_insert" ON public.expense_categories FOR INSERT TO authenticated
  WITH CHECK (org_id = public.user_org_id(auth.uid()) AND public.has_role(auth.uid(), 'admin'));
CREATE POLICY "cat_update" ON public.expense_categories FOR UPDATE TO authenticated
  USING (org_id = public.user_org_id(auth.uid()) AND public.has_role(auth.uid(), 'admin'));
CREATE POLICY "cat_delete" ON public.expense_categories FOR DELETE TO authenticated
  USING (org_id = public.user_org_id(auth.uid()) AND public.has_role(auth.uid(), 'admin'));

-- ============================================================
-- 21. RLS — Expenses
-- ============================================================
CREATE POLICY "exp_select" ON public.expenses FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR current_approver_id = auth.uid()
    OR public.is_manager_of(auth.uid(), user_id)
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'finance')
  );
CREATE POLICY "exp_insert" ON public.expenses FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "exp_update" ON public.expenses FOR UPDATE TO authenticated
  USING (
    (user_id = auth.uid() AND status = 'pending_l1')
    OR current_approver_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
  );
CREATE POLICY "exp_delete" ON public.expenses FOR DELETE TO authenticated
  USING (user_id = auth.uid() AND status = 'pending_l1');

-- ============================================================
-- 22. RLS — Approval History
-- ============================================================
CREATE POLICY "ah_select" ON public.approval_history FOR SELECT TO authenticated
  USING (true);
CREATE POLICY "ah_insert" ON public.approval_history FOR INSERT TO authenticated
  WITH CHECK (approver_id = auth.uid());

-- ============================================================
-- 23. Storage
-- ============================================================
INSERT INTO storage.buckets (id, name, public) VALUES ('receipts', 'receipts', true)
ON CONFLICT (id) DO NOTHING;

DO $$ BEGIN
  CREATE POLICY "receipt_upload" ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'receipts' AND (storage.foldername(name))[1] = auth.uid()::text);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "receipt_view" ON storage.objects FOR SELECT TO authenticated
    USING (bucket_id = 'receipts');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- 24. Encryption helpers
-- ============================================================
CREATE OR REPLACE FUNCTION public.encrypt_text(plaintext TEXT)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE encryption_key TEXT;
BEGIN
  encryption_key := current_setting('app.settings.encryption_key', true);
  IF encryption_key IS NULL OR encryption_key = '' THEN RETURN plaintext; END IF;
  RETURN encode(pgp_sym_encrypt(plaintext, encryption_key), 'base64');
END; $$;

CREATE OR REPLACE FUNCTION public.decrypt_text(ciphertext TEXT)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE encryption_key TEXT;
BEGIN
  IF ciphertext IS NULL THEN RETURN NULL; END IF;
  encryption_key := current_setting('app.settings.encryption_key', true);
  IF encryption_key IS NULL OR encryption_key = '' THEN RETURN ciphertext; END IF;
  BEGIN RETURN pgp_sym_decrypt(decode(ciphertext, 'base64'), encryption_key);
  EXCEPTION WHEN OTHERS THEN RETURN ciphertext; END;
END; $$;

-- ============================================================
-- 25. handle_new_user trigger (inserts into public.users)
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.users (id, name, email, first_name, last_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', NEW.email),
    NEW.email,
    NEW.raw_user_meta_data->>'first_name',
    NEW.raw_user_meta_data->>'last_name'
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'employee')
  ON CONFLICT (user_id, role) DO NOTHING;

  RETURN NEW;
END; $$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- 26. create_organization RPC
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_organization(
  _name TEXT, _slug TEXT, _corporate_email TEXT, _business_phone TEXT DEFAULT NULL
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid UUID := auth.uid(); _org_id UUID;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  -- Ensure user record exists (fallback if trigger didn't fire)
  INSERT INTO public.users (id, name, email)
  SELECT _uid, COALESCE(u.raw_user_meta_data->>'name', u.email), u.email
  FROM auth.users u WHERE u.id = _uid
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.user_roles (user_id, role) VALUES (_uid, 'employee')
  ON CONFLICT (user_id, role) DO NOTHING;

  -- Create org
  INSERT INTO public.organizations (name, slug, corporate_email, business_phone, created_by)
  VALUES (_name, _slug, _corporate_email, _business_phone, _uid)
  RETURNING id INTO _org_id;

  -- Link user to org
  UPDATE public.users SET org_id = _org_id WHERE id = _uid;

  -- Promote to admin
  DELETE FROM public.user_roles WHERE user_id = _uid;
  INSERT INTO public.user_roles (user_id, role) VALUES (_uid, 'admin');

  -- Seed default expense categories
  INSERT INTO public.expense_categories (org_id, name) VALUES
    (_org_id, 'Travel'), (_org_id, 'Meals'), (_org_id, 'Office Supplies'),
    (_org_id, 'Software'), (_org_id, 'Equipment'), (_org_id, 'Training'),
    (_org_id, 'Communication'), (_org_id, 'Miscellaneous');

  -- Seed default currency
  INSERT INTO public.org_currencies (org_id, code, symbol, name, is_default) VALUES
    (_org_id, 'USD', '$', 'US Dollar', true);

  RETURN _org_id;
END; $$;

-- ============================================================
-- 27. promote_to_admin RPC
-- ============================================================
CREATE OR REPLACE FUNCTION public.promote_to_admin()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid UUID := auth.uid(); _admin_count INT;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT COUNT(*) INTO _admin_count FROM public.user_roles WHERE role = 'admin';
  IF _admin_count > 0 THEN RAISE EXCEPTION 'An admin already exists.'; END IF;
  DELETE FROM public.user_roles WHERE user_id = _uid;
  INSERT INTO public.user_roles (user_id, role) VALUES (_uid, 'admin');
END; $$;
