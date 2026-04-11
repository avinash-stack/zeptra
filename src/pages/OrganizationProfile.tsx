import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Building2, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { isSupabaseConfigured, supabase } from "@/integrations/supabase/client";

type FormErrors = Partial<Record<keyof FormState, string>>;

interface FormState {
  companyName: string;
  companySlug: string;
  corporateEmail: string;
  businessPhone: string;
  firstName: string;
  lastName: string;
  adminEmail: string;
  password: string;
  confirmPassword: string;
}

const initialForm: FormState = {
  companyName: "",
  companySlug: "",
  corporateEmail: "",
  businessPhone: "",
  firstName: "",
  lastName: "",
  adminEmail: "",
  password: "",
  confirmPassword: "",
};

const slugify = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9- ]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

const OrganizationProfile: React.FC = () => {
  const navigate = useNavigate();
  const [form, setForm] = useState<FormState>(initialForm);
  const [errors, setErrors] = useState<FormErrors>({});
  const [slugEdited, setSlugEdited] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!slugEdited) {
      setForm((prev) => ({ ...prev, companySlug: slugify(prev.companyName) }));
    }
  }, [form.companyName, slugEdited]);

  const onChange = (field: keyof FormState) => (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    setForm((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const validate = (): FormErrors => {
    const nextErrors: FormErrors = {};

    if (!form.companyName.trim()) nextErrors.companyName = "Company name is required.";
    if (!form.companySlug.trim()) nextErrors.companySlug = "Company slug is required.";
    if (form.companySlug && !/^[a-z0-9-]+$/.test(form.companySlug)) {
      nextErrors.companySlug = "Use lowercase letters, numbers, and hyphens only.";
    }
    if (!form.corporateEmail.trim()) nextErrors.corporateEmail = "Corporate email is required.";
    if (!form.adminEmail.trim()) nextErrors.adminEmail = "Admin email is required.";
    if (!form.password) nextErrors.password = "Password is required.";
    if (form.password && form.password.length < 8) nextErrors.password = "Password must be at least 8 characters.";
    if (!form.confirmPassword) nextErrors.confirmPassword = "Confirm password is required.";
    if (form.password && form.confirmPassword && form.password !== form.confirmPassword) {
      nextErrors.confirmPassword = "Passwords do not match.";
    }

    return nextErrors;
  };

  const required = useMemo(
    () => ({ className: "after:ml-1 after:text-red-500 after:content-['*']" }),
    [],
  );

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const nextErrors = validate();

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      toast.error("Please correct the highlighted fields.");
      return;
    }

    if (!isSupabaseConfigured) {
      toast.error("Supabase is not connected. Add valid env keys and restart the app.");
      return;
    }

    setSubmitting(true);
    try {
      const fullName = `${form.firstName.trim()} ${form.lastName.trim()}`.trim() || form.adminEmail.trim();

      // 1. Sign up – the DB trigger creates profile + default 'employee' role
      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email: form.adminEmail.trim().toLowerCase(),
        password: form.password,
        options: {
          data: {
            name: fullName,
            first_name: form.firstName.trim() || null,
            last_name: form.lastName.trim() || null,
            company_name: form.companyName.trim(),
            company_slug: form.companySlug.trim(),
            corporate_email: form.corporateEmail.trim().toLowerCase(),
            business_phone: form.businessPhone.trim() || null,
            account_type: "organization_owner",
          },
        },
      });

      if (signUpError) throw signUpError;

      // If email confirmation is required, session may be null
      if (!signUpData.session) {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: form.adminEmail.trim().toLowerCase(),
          password: form.password,
        });
        if (signInError) throw signInError;
      }

      // 2. Create the organization via RPC (also promotes to admin + seeds categories)
      const { data: orgId, error: orgError } = await supabase.rpc("create_organization", {
        _name: form.companyName.trim(),
        _slug: form.companySlug.trim(),
        _corporate_email: form.corporateEmail.trim().toLowerCase(),
        _business_phone: form.businessPhone.trim() || null,
      });

      if (orgError) {
        console.error("create_organization RPC error:", orgError);
        // Fallback: try promote_to_admin if create_organization doesn't exist yet
        const { error: promoteError } = await supabase.rpc("promote_to_admin");
        if (promoteError) {
          console.warn("promote_to_admin also failed:", promoteError.message);
        }
      }

      toast.success("Organization created. You are signed in as owner with full admin access.");
      navigate("/app", { replace: true });
    } catch (error: unknown) {
      console.error("Organization creation error:", error);
      let message = "Failed to create organization";
      if (error instanceof Error) {
        message = error.message;
        if (message.includes("already been registered") || message.includes("already exists")) {
          message = "This email is already registered. Please use a different email or sign in.";
        } else if (message.includes("Database error")) {
          message = "Database setup error. Please ensure the database schema has been applied (run schema.sql in Supabase SQL Editor).";
        } else if (message.includes("signups not allowed") || message.includes("Signups not allowed")) {
          message = "Signups are disabled in your Supabase project. Enable them in Authentication → Settings.";
        }
      }
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-primary/5 px-4 py-8 md:px-8">
      <div className="mx-auto w-full max-w-6xl overflow-hidden rounded-3xl border bg-card shadow-xl">
        <div className="h-1 w-full bg-gradient-to-r from-info via-primary to-primary/70" />
        <form className="space-y-8 p-6 md:p-10" onSubmit={handleSubmit}>
          <section>
            <div className="mb-6 flex items-center gap-2 text-primary">
              <Building2 className="h-5 w-5" />
              <h2 className="text-2xl font-extrabold uppercase tracking-[0.14em]">Company Information</h2>
            </div>

            <div className="grid gap-6 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="companyName" {...required}>
                  Company Name
                </Label>
                <Input
                  id="companyName"
                  placeholder="Acme Corporation"
                  value={form.companyName}
                  onChange={onChange("companyName")}
                />
                {errors.companyName && <p className="text-sm text-destructive">{errors.companyName}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="companySlug" {...required}>
                  Company Slug
                </Label>
                <Input
                  id="companySlug"
                  placeholder="acme-corporation"
                  value={form.companySlug}
                  onChange={(event) => {
                    setSlugEdited(true);
                    onChange("companySlug")(event);
                  }}
                />
                <p className="text-sm text-muted-foreground">Lowercase letters, numbers, and hyphens only</p>
                {errors.companySlug && <p className="text-sm text-destructive">{errors.companySlug}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="corporateEmail" {...required}>
                  Corporate Email
                </Label>
                <Input
                  id="corporateEmail"
                  type="email"
                  placeholder="admin@yourcompany.com"
                  value={form.corporateEmail}
                  onChange={onChange("corporateEmail")}
                />
                {errors.corporateEmail && <p className="text-sm text-destructive">{errors.corporateEmail}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="businessPhone">Business Phone</Label>
                <Input
                  id="businessPhone"
                  placeholder="+1-555-0123"
                  value={form.businessPhone}
                  onChange={onChange("businessPhone")}
                />
              </div>
            </div>
          </section>

          <div className="h-px w-full bg-border" />

          <section>
            <div className="mb-6 flex items-center gap-2 text-primary">
              <ShieldCheck className="h-5 w-5" />
              <h2 className="text-2xl font-extrabold uppercase tracking-[0.14em]">Administrator Account</h2>
            </div>

            <div className="grid gap-6 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="firstName">First Name</Label>
                <Input
                  id="firstName"
                  placeholder="Alex"
                  value={form.firstName}
                  onChange={onChange("firstName")}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lastName">Last Name</Label>
                <Input
                  id="lastName"
                  placeholder="Smith"
                  value={form.lastName}
                  onChange={onChange("lastName")}
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="adminEmail" {...required}>
                  Admin Email
                </Label>
                <Input
                  id="adminEmail"
                  type="email"
                  placeholder="admin@yourcompany.com"
                  value={form.adminEmail}
                  onChange={onChange("adminEmail")}
                />
                {errors.adminEmail && <p className="text-sm text-destructive">{errors.adminEmail}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="password" {...required}>
                  Password
                </Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="Min. 8 characters"
                  value={form.password}
                  onChange={onChange("password")}
                />
                {errors.password && <p className="text-sm text-destructive">{errors.password}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirmPassword" {...required}>
                  Confirm Password
                </Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  placeholder="Re-enter password"
                  value={form.confirmPassword}
                  onChange={onChange("confirmPassword")}
                />
                {errors.confirmPassword && <p className="text-sm text-destructive">{errors.confirmPassword}</p>}
              </div>
            </div>
          </section>

          <Button
            type="submit"
            size="lg"
            disabled={submitting}
            className="h-14 w-full bg-gradient-to-r from-primary to-primary/90 text-xl font-bold"
          >
            {submitting && <Loader2 className="mr-2 h-5 w-5 animate-spin" />}
            {submitting ? "Creating Workspace..." : "Create Workspace"}
            {!submitting && <ArrowRight className="ml-2 h-5 w-5" />}
          </Button>
        </form>
      </div>
    </div>
  );
};

export default OrganizationProfile;
