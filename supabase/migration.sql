-- ============================================================
-- Zeptra Migration Script
-- Run this in Supabase SQL Editor to upgrade from old schema
-- WARNING: This will DROP all existing data!
-- ============================================================

-- 0. Drop trigger first (depends on function)
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

-- 2. Drop existing tables (in dependency order)
DROP TABLE IF EXISTS public.approval_history CASCADE;
DROP TABLE IF EXISTS public.expenses CASCADE;
DROP TABLE IF EXISTS public.expense_categories CASCADE;
DROP TABLE IF EXISTS public.user_roles CASCADE;
DROP TABLE IF EXISTS public.profiles CASCADE;
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
-- Now create everything fresh
-- ============================================================

-- 5. Enums
CREATE TYPE public.app_role AS ENUM ('admin', 'employee', 'hr', 'finance');
CREATE TYPE public.expense_status AS ENUM ('pending_l1', 'pending_l2', 'approved', 'rejected');
CREATE TYPE public.approval_action AS ENUM ('approved', 'rejected', 'reassigned');
CREATE TYPE public.profile_status AS ENUM ('active', 'inactive');

-- 6. Organizations
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

-- 7. Org currencies
CREATE TABLE public.org_currencies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  symbol TEXT NOT NULL,
  name TEXT NOT NULL,
  is_default BOOLEAN DEFAULT false,
  UNIQUE(org_id, code)
);

-- 8. Profiles
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

-- 9. User roles
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role public.app_role NOT NULL,
  UNIQUE (user_id, role)
);

-- 10. Expense categories (org-scoped)
CREATE TABLE public.expense_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(org_id, name)
);

-- 11. Expenses
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

-- 12. Approval history
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
-- 13. Helper functions
-- ============================================================

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role) $$;

CREATE OR REPLACE FUNCTION public.is_manager_of(_manager_id UUID, _user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = _user_id AND manager_id = _manager_id) $$;

CREATE OR REPLACE FUNCTION public.is_manager(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (SELECT 1 FROM public.profiles WHERE manager_id = _user_id) $$;

CREATE OR REPLACE FUNCTION public.user_org_id(_user_id UUID)
RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT org_id FROM public.profiles WHERE id = _user_id $$;

-- ============================================================
-- 14. Enable RLS
-- ============================================================
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_currencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_history ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 15. RLS Policies
-- ============================================================

-- Organizations
CREATE POLICY "Members can view own org" ON public.organizations FOR SELECT TO authenticated USING (id = public.user_org_id(auth.uid()));
CREATE POLICY "Admin can update own org" ON public.organizations FOR UPDATE TO authenticated USING (id = public.user_org_id(auth.uid()) AND public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Anyone can insert org during bootstrap" ON public.organizations FOR INSERT TO authenticated WITH CHECK (true);

-- Org currencies
CREATE POLICY "Members can view currencies" ON public.org_currencies FOR SELECT TO authenticated USING (org_id = public.user_org_id(auth.uid()));
CREATE POLICY "Admin can manage currencies" ON public.org_currencies FOR ALL TO authenticated USING (org_id = public.user_org_id(auth.uid()) AND public.has_role(auth.uid(), 'admin'));

-- Profiles
CREATE POLICY "Users can view org profiles" ON public.profiles FOR SELECT TO authenticated USING (org_id = public.user_org_id(auth.uid()) OR id = auth.uid());
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE TO authenticated USING (id = auth.uid());
CREATE POLICY "Admin/HR can insert profiles" ON public.profiles FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Admin/HR can update profiles" ON public.profiles FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'hr'));

-- User roles
CREATE POLICY "Users can view roles" ON public.user_roles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin/HR can manage roles" ON public.user_roles FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'hr'));

-- Expense categories
CREATE POLICY "Members can view active categories" ON public.expense_categories FOR SELECT TO authenticated USING (org_id = public.user_org_id(auth.uid()));
CREATE POLICY "Admin can manage categories" ON public.expense_categories FOR INSERT TO authenticated WITH CHECK (org_id = public.user_org_id(auth.uid()) AND public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admin can update categories" ON public.expense_categories FOR UPDATE TO authenticated USING (org_id = public.user_org_id(auth.uid()) AND public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admin can delete categories" ON public.expense_categories FOR DELETE TO authenticated USING (org_id = public.user_org_id(auth.uid()) AND public.has_role(auth.uid(), 'admin'));

-- Expenses
CREATE POLICY "Employee sees own expenses" ON public.expenses FOR SELECT TO authenticated USING (user_id = auth.uid() OR current_approver_id = auth.uid() OR public.is_manager_of(auth.uid(), user_id) OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'finance'));
CREATE POLICY "Employee can insert own expenses" ON public.expenses FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "Employee can update own pending expenses" ON public.expenses FOR UPDATE TO authenticated USING ((user_id = auth.uid() AND status = 'pending_l1') OR current_approver_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Employee can delete own pending expenses" ON public.expenses FOR DELETE TO authenticated USING (user_id = auth.uid() AND status = 'pending_l1');

-- Approval history
CREATE POLICY "View approval history" ON public.approval_history FOR SELECT TO authenticated USING (true);
CREATE POLICY "Approvers can insert history" ON public.approval_history FOR INSERT TO authenticated WITH CHECK (approver_id = auth.uid());

-- ============================================================
-- 16. Storage
-- ============================================================
INSERT INTO storage.buckets (id, name, public) VALUES ('receipts', 'receipts', true) ON CONFLICT (id) DO NOTHING;

DO $$ BEGIN
  CREATE POLICY "Users can upload receipts" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'receipts' AND (storage.foldername(name))[1] = auth.uid()::text);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Anyone can view receipts" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'receipts');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- 17. Encryption helpers
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
-- 18. Signup trigger
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, name, email, first_name, last_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', NEW.email),
    NEW.email,
    NEW.raw_user_meta_data->>'first_name',
    NEW.raw_user_meta_data->>'last_name'
  );
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'employee');
  RETURN NEW;
END; $$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- 19. create_organization RPC
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_organization(
  _name TEXT, _slug TEXT, _corporate_email TEXT, _business_phone TEXT DEFAULT NULL
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid UUID := auth.uid(); _org_id UUID;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  INSERT INTO public.organizations (name, slug, corporate_email, business_phone, created_by)
  VALUES (_name, _slug, _corporate_email, _business_phone, _uid)
  RETURNING id INTO _org_id;

  UPDATE public.profiles SET org_id = _org_id WHERE id = _uid;

  DELETE FROM public.user_roles WHERE user_id = _uid;
  INSERT INTO public.user_roles (user_id, role) VALUES (_uid, 'admin');

  INSERT INTO public.expense_categories (org_id, name) VALUES
    (_org_id, 'Travel'), (_org_id, 'Meals'), (_org_id, 'Office Supplies'),
    (_org_id, 'Software'), (_org_id, 'Equipment'), (_org_id, 'Training'),
    (_org_id, 'Communication'), (_org_id, 'Miscellaneous');

  INSERT INTO public.org_currencies (org_id, code, symbol, name, is_default) VALUES
    (_org_id, 'USD', '$', 'US Dollar', true);

  RETURN _org_id;
END; $$;

-- ============================================================
-- 20. promote_to_admin RPC
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
