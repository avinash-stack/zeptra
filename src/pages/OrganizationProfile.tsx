import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight, Building2, Check, CheckCircle2, Globe, Loader2, Mail, Plus, Rocket, ShieldCheck, Trash2, Users, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { isSupabaseConfigured, supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { AppRole } from "@/types/database";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

type FormErrors = Partial<Record<keyof OrgForm, string>>;

interface OrgForm {
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

interface InviteRow {
  name: string;
  email: string;
  role: AppRole;
  status: "idle" | "sending" | "sent" | "failed";
}

const initialForm: OrgForm = {
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

const emptyInvite = (): InviteRow => ({ name: "", email: "", role: "employee", status: "idle" });

const slugify = (value: string) =>
  value.trim().toLowerCase().replace(/[^a-z0-9- ]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");

/* ------------------------------------------------------------------ */
/* Step Indicator                                                      */
/* ------------------------------------------------------------------ */

const StepIndicator: React.FC<{ current: number }> = ({ current }) => {
  const steps = [
    { num: 1, label: "Organization" },
    { num: 2, label: "Invite Team" },
    { num: 3, label: "All Set" },
  ];

  return (
    <div className="flex items-center justify-center mb-8">
      {steps.map((step, i) => (
        <React.Fragment key={step.num}>
          <div className="flex flex-col items-center">
            <div
              className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold transition-all
                ${current > step.num
                  ? "bg-primary text-primary-foreground"
                  : current === step.num
                    ? "bg-gradient-to-br from-primary to-accent text-white shadow-lg shadow-primary/25"
                    : "bg-muted text-muted-foreground"
                }`}
            >
              {current > step.num ? <Check className="w-4 h-4" /> : step.num}
            </div>
            <span className={`text-xs mt-1.5 font-medium ${current >= step.num ? "text-foreground" : "text-muted-foreground"}`}>
              {step.label}
            </span>
          </div>
          {i < steps.length - 1 && (
            <div className={`w-16 sm:w-24 h-0.5 mx-2 mb-5 transition-colors ${current > step.num ? "bg-primary" : "bg-muted"}`} />
          )}
        </React.Fragment>
      ))}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Main Component                                                      */
/* ------------------------------------------------------------------ */

const OrganizationProfile: React.FC = () => {
  const navigate = useNavigate();
  const { user, reloadAll } = useAuth();

  const [step, setStep] = useState(1);
  const [form, setForm] = useState<OrgForm>(initialForm);
  const [errors, setErrors] = useState<FormErrors>({});
  const [slugEdited, setSlugEdited] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [country, setCountry] = useState('IN');

  // Step 2 — invites
  const [invites, setInvites] = useState<InviteRow[]>([emptyInvite()]);
  const [inviteSending, setInviteSending] = useState(false);
  const [invitesSentCount, setInvitesSentCount] = useState(0);

  /* ---- slug auto-derive ---- */
  useEffect(() => {
    if (!slugEdited) {
      setForm((prev) => ({ ...prev, companySlug: slugify(prev.companyName) }));
    }
  }, [form.companyName, slugEdited]);

  const onChange = (field: keyof OrgForm) => (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    setForm((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const required = useMemo(
    () => ({ className: "after:ml-1 after:text-red-500 after:content-['*']" }),
    [],
  );

  /* ---- Step 1 validation ---- */
  const validateStep1 = (): FormErrors => {
    const nextErrors: FormErrors = {};
    if (!form.companyName.trim()) nextErrors.companyName = "Company name is required.";
    if (!form.companySlug.trim()) nextErrors.companySlug = "Company slug is required.";
    if (form.companySlug && !/^[a-z0-9-]+$/.test(form.companySlug)) {
      nextErrors.companySlug = "Use lowercase letters, numbers, and hyphens only.";
    }
    if (!form.corporateEmail.trim()) nextErrors.corporateEmail = "Corporate email is required.";
    if (!country) (nextErrors as Record<string, string>).country = "Country is required.";
    if (!form.adminEmail.trim()) nextErrors.adminEmail = "Admin email is required.";
    if (!form.password) nextErrors.password = "Password is required.";
    if (form.password && form.password.length < 8) nextErrors.password = "Password must be at least 8 characters.";
    if (!form.confirmPassword) nextErrors.confirmPassword = "Confirm password is required.";
    if (form.password && form.confirmPassword && form.password !== form.confirmPassword) {
      nextErrors.confirmPassword = "Passwords do not match.";
    }
    return nextErrors;
  };

  /* ---- Step 1 submit ---- */
  const handleStep1Next = async () => {
    const nextErrors = validateStep1();
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

      // 0. Pre-check slug availability (granted to anon — works before sign-up)
      const { data: slugAvailable, error: slugCheckError } = await supabase.rpc("check_slug_available", {
        _slug: form.companySlug.trim(),
      });

      if (slugCheckError) {
        console.error("Slug check error:", slugCheckError);
        toast.error("Could not verify organization URL availability. Please try again.");
        return;
      }

      if (slugAvailable === false) {
        setErrors((prev) => ({ ...prev, companySlug: "This organization URL is already taken." }));
        toast.error("This organization URL is already taken. Please choose a different slug.");
        return;
      }

      // 1. Sign up — if already registered, fall through to sign in
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

      if (signUpError) {
        if (
          signUpError.message.includes("already been registered") ||
          signUpError.message.includes("already exists")
        ) {
          // User retrying after a slug error — sign in to continue the flow
          const { error: signInError } = await supabase.auth.signInWithPassword({
            email: form.adminEmail.trim().toLowerCase(),
            password: form.password,
          });
          if (signInError) {
            toast.error("This email is already registered. Please use the correct password or sign in.");
            return;
          }
        } else {
          throw signUpError;
        }
      } else {
        // 2. Ensure session for newly signed-up user
        if (!signUpData.session) {
          const { error: signInError } = await supabase.auth.signInWithPassword({
            email: form.adminEmail.trim().toLowerCase(),
            password: form.password,
          });
          if (signInError) throw signInError;
        }
      }

      // 3. Wait for DB trigger (handle_new_user)
      await new Promise((resolve) => setTimeout(resolve, 1500));

      // 4. Ensure user profile exists (critical — do not swallow errors)
      const { error: ensureError } = await supabase.rpc("ensure_user_profile", {
        _name: fullName,
        _email: form.adminEmail.trim().toLowerCase(),
        _first_name: form.firstName.trim() || null,
        _last_name: form.lastName.trim() || null,
      });
      if (ensureError) {
        console.error("ensure_user_profile failed:", ensureError.message);
        throw new Error("Failed to initialize user profile. Please try again.");
      }

      // 5. Create organization via RPC
      const { data: newOrgId, error: orgError } = await supabase.rpc("create_organization", {
        _name: form.companyName.trim(),
        _slug: form.companySlug.trim(),
        _corporate_email: form.corporateEmail.trim().toLowerCase(),
        _business_phone: form.businessPhone.trim() || null,
        p_country: country,
      });

      if (orgError || !newOrgId) {
        console.error("create_organization RPC error:", orgError);
        let errorMessage = orgError?.message || "Failed to create organization. Please try again.";
        if (errorMessage.includes("already belongs to an organization")) {
          errorMessage = "This email is already registered to an existing organization.";
        } else if (errorMessage.includes("unique") || errorMessage.includes("duplicate")) {
          errorMessage = "This organization URL is already taken. Please choose a different slug.";
          setErrors((prev) => ({ ...prev, companySlug: "This organization URL is already taken." }));
        }
        toast.error(errorMessage);
        return;
      }

      setOrgId(newOrgId as string);
      console.log("Organization created with ID:", newOrgId);

      // 6. Send welcome email (non-blocking — does not affect data integrity)
      supabase.functions
        .invoke("welcome-email", {
          body: {
            org_name: form.companyName.trim(),
            admin_name: fullName,
            admin_email: form.adminEmail.trim().toLowerCase(),
          },
        })
        .then(({ error: emailError }) => {
          if (emailError) console.error("Welcome email delivery failed:", emailError.message);
        })
        .catch((err) => {
          console.error("Welcome email invocation failed:", err);
        });

      await reloadAll();
      toast.success("Organization created successfully!");
      setStep(2);
    } catch (error: unknown) {
      console.error("Organization creation error:", error);
      let message = "Failed to create organization";
      if (error instanceof Error) {
        message = error.message;
        if (message.includes("Database error")) {
          message = "Database setup error. Please ensure the database schema has been applied.";
        } else if (message.includes("signups not allowed") || message.includes("Signups not allowed")) {
          message = "Signups are disabled in your Supabase project. Enable them in Authentication → Settings.";
        }
      }
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  /* ---- Step 2 invite helpers ---- */
  const updateInvite = (index: number, field: keyof InviteRow, value: string) => {
    setInvites((prev) => prev.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
  };

  const addInviteRow = () => setInvites((prev) => [...prev, emptyInvite()]);

  const removeInviteRow = (index: number) => {
    if (invites.length === 1) return;
    setInvites((prev) => prev.filter((_, i) => i !== index));
  };

  const handleStep2Next = async () => {
    const filledInvites = invites.filter((r) => r.email.trim());
    if (filledInvites.length === 0) {
      // skip
      setStep(3);
      return;
    }

    setInviteSending(true);
    const redirectTo = `${window.location.origin}/set-password`;

    const payload = filledInvites.map(invite => ({
      email: invite.email.trim().toLowerCase(),
      name: invite.name.trim(),
      role: invite.role,
      manager_id: null,
      tag: null,
      redirect_to: redirectTo,
    }));

    filledInvites.forEach((invite) => {
      const realIdx = invites.indexOf(invite);
      updateInvite(realIdx, "status", "sending");
    });

    const { data, error } = await supabase.functions.invoke("invite-user", {
      body: { invites: payload },
    });

    let hasFailures = false;

    if (error || !data?.success) {
      filledInvites.forEach((invite) => {
        const realIdx = invites.indexOf(invite);
        updateInvite(realIdx, "status", "failed");
      });
      toast.error(error?.message || data?.error || "Failed to invite some users");
      hasFailures = true;
    } else {
      let succeededCount = 0;
      let failedCount = 0;
      filledInvites.forEach((invite, idx) => {
        const realIdx = invites.indexOf(invite);
        const result = data.results?.[idx];
        if (result?.success) {
          updateInvite(realIdx, "status", "sent");
          succeededCount++;
        } else {
          updateInvite(realIdx, "status", "failed");
          failedCount++;
        }
      });
      setInvitesSentCount(succeededCount);

      if (succeededCount > 0) toast.success(`${succeededCount} invite${succeededCount > 1 ? "s" : ""} sent!`);
      if (failedCount > 0) {
        toast.error(`${failedCount} invite${failedCount > 1 ? "s" : ""} failed. You can retry later from User Management.`);
        hasFailures = true;
      }
    }

    setInviteSending(false);
    if (hasFailures) return;
    setStep(3);
  };

  /* ---- Step 3 finish ---- */
  const handleFinish = () => {
    navigate("/app", { replace: true });
  };

  /* ================================================================ */
  /* Render                                                            */
  /* ================================================================ */

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-primary/5 px-4 py-8 md:px-8">
      <div className="mx-auto w-full max-w-2xl">
        <StepIndicator current={step} />

        {/* ==================== Step 1 ==================== */}
        {step === 1 && (
          <Card className="overflow-hidden">
            <div className="h-1 w-full bg-gradient-to-r from-info via-primary to-primary/70" />
            <CardContent className="p-6 md:p-8 space-y-8">
              <section>
                <div className="mb-6 flex items-center gap-2 text-primary">
                  <Building2 className="h-5 w-5" />
                  <h2 className="text-2xl font-extrabold uppercase tracking-[0.14em]">Company Information</h2>
                </div>

                <div className="grid gap-6 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="companyName" {...required}>Company Name</Label>
                    <Input id="companyName" placeholder="Your Company" value={form.companyName} onChange={onChange("companyName")} />
                    {errors.companyName && <p className="text-sm text-destructive">{errors.companyName}</p>}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="companySlug" {...required}>Company Slug</Label>
                    <Input
                      id="companySlug"
                      placeholder="your-company"
                      value={form.companySlug}
                      onChange={(event) => { setSlugEdited(true); onChange("companySlug")(event); }}
                    />
                    <p className="text-sm text-muted-foreground">Lowercase letters, numbers, and hyphens only</p>
                    {errors.companySlug && <p className="text-sm text-destructive">{errors.companySlug}</p>}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="corporateEmail" {...required}>Corporate Email</Label>
                    <Input id="corporateEmail" type="email" placeholder="admin@yourcompany.com" value={form.corporateEmail} onChange={onChange("corporateEmail")} />
                    {errors.corporateEmail && <p className="text-sm text-destructive">{errors.corporateEmail}</p>}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="businessPhone">Business Phone</Label>
                    <Input id="businessPhone" placeholder="+1-555-0123" value={form.businessPhone} onChange={onChange("businessPhone")} />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label {...required}><Globe className="inline h-4 w-4 mr-1 -mt-0.5" />Country</Label>
                    <Select value={country} onValueChange={setCountry}>
                      <SelectTrigger id="country">
                        <SelectValue placeholder="Select your country" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="IN">India</SelectItem>
                        <SelectItem value="US">United States</SelectItem>
                        <SelectItem value="GB">United Kingdom</SelectItem>
                        <SelectItem value="AU">Australia</SelectItem>
                        <SelectItem value="CA">Canada</SelectItem>
                        <SelectItem value="SG">Singapore</SelectItem>
                        <SelectItem value="AE">United Arab Emirates</SelectItem>
                        <SelectItem value="OTHER">Other</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      This sets your organization's billing region and default currency.
                      India → ₹ INR. All other countries → $ USD.
                    </p>
                    {(errors as Record<string, string>).country && <p className="text-sm text-destructive">{(errors as Record<string, string>).country}</p>}
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
                    <Input id="firstName" placeholder="First Name" value={form.firstName} onChange={onChange("firstName")} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="lastName">Last Name</Label>
                    <Input id="lastName" placeholder="Last Name" value={form.lastName} onChange={onChange("lastName")} />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor="adminEmail" {...required}>Admin Email</Label>
                    <Input id="adminEmail" type="email" placeholder="admin@yourcompany.com" value={form.adminEmail} onChange={onChange("adminEmail")} />
                    {errors.adminEmail && <p className="text-sm text-destructive">{errors.adminEmail}</p>}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="password" {...required}>Password</Label>
                    <Input id="password" type="password" placeholder="Min. 8 characters" value={form.password} onChange={onChange("password")} />
                    {errors.password && <p className="text-sm text-destructive">{errors.password}</p>}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="confirmPassword" {...required}>Confirm Password</Label>
                    <Input id="confirmPassword" type="password" placeholder="Re-enter password" value={form.confirmPassword} onChange={onChange("confirmPassword")} />
                    {errors.confirmPassword && <p className="text-sm text-destructive">{errors.confirmPassword}</p>}
                  </div>
                </div>
              </section>

              <Button
                size="lg"
                disabled={submitting}
                className="h-14 w-full bg-gradient-to-r from-primary to-primary/90 text-xl font-bold"
                onClick={handleStep1Next}
              >
                {submitting && <Loader2 className="mr-2 h-5 w-5 animate-spin" />}
                {submitting ? "Creating Workspace..." : "Next"}
                {!submitting && <ArrowRight className="ml-2 h-5 w-5" />}
              </Button>
            </CardContent>
          </Card>
        )}

        {/* ==================== Step 2 ==================== */}
        {step === 2 && (
          <Card className="overflow-hidden">
            <div className="h-1 w-full bg-gradient-to-r from-info via-primary to-primary/70" />
            <CardContent className="p-6 md:p-8 space-y-6">
              <div className="flex items-center gap-2 text-primary">
                <Users className="h-5 w-5" />
                <h2 className="text-2xl font-extrabold uppercase tracking-[0.14em]">Invite Your Team</h2>
              </div>
              <p className="text-muted-foreground text-sm">Add team members now, or skip and invite later from User Management.</p>

              <div className="space-y-3">
                {invites.map((invite, idx) => (
                  <div key={idx} className="flex items-start gap-2">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 flex-1">
                      <Input
                        placeholder="Name"
                        value={invite.name}
                        onChange={(e) => updateInvite(idx, "name", e.target.value)}
                        disabled={invite.status === "sending" || invite.status === "sent"}
                      />
                      <Input
                        placeholder="Email"
                        type="email"
                        value={invite.email}
                        onChange={(e) => updateInvite(idx, "email", e.target.value)}
                        disabled={invite.status === "sending" || invite.status === "sent"}
                      />
                      <Select
                        value={invite.role}
                        onValueChange={(val) => updateInvite(idx, "role", val)}
                        disabled={invite.status === "sending" || invite.status === "sent"}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="employee">Employee</SelectItem>
                          <SelectItem value="hr">HR</SelectItem>
                          <SelectItem value="finance">Finance</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Status / Remove */}
                    <div className="flex items-center h-10 shrink-0">
                      {invite.status === "sending" && <Loader2 className="w-4 h-4 animate-spin text-primary" />}
                      {invite.status === "sent" && <CheckCircle2 className="w-4 h-4 text-success" />}
                      {invite.status === "failed" && <XCircle className="w-4 h-4 text-destructive" />}
                      {invite.status === "idle" && invites.length > 1 && (
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => removeInviteRow(idx)}>
                          <Trash2 className="w-4 h-4 text-muted-foreground" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <Button variant="outline" size="sm" onClick={addInviteRow} disabled={inviteSending}>
                <Plus className="w-4 h-4 mr-1" /> Add another
              </Button>

              <div className="flex flex-col sm:flex-row items-center gap-3 pt-4">
                <Button variant="outline" onClick={() => setStep(1)} disabled={inviteSending} className="w-full sm:w-auto">
                  <ArrowLeft className="w-4 h-4 mr-1" /> Back
                </Button>
                <Button
                  className="w-full sm:flex-1 bg-gradient-to-r from-primary to-accent"
                  onClick={handleStep2Next}
                  disabled={inviteSending}
                >
                  {inviteSending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {inviteSending ? "Sending invites..." : "Next"}
                  {!inviteSending && <ArrowRight className="ml-2 h-4 w-4" />}
                </Button>
              </div>

              <button
                type="button"
                className="w-full text-center text-sm text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => setStep(3)}
                disabled={inviteSending}
              >
                Skip for now →
              </button>
            </CardContent>
          </Card>
        )}

        {/* ==================== Step 3 ==================== */}
        {step === 3 && (
          <Card className="overflow-hidden">
            <div className="h-1 w-full bg-gradient-to-r from-info via-primary to-primary/70" />
            <CardContent className="p-6 md:p-8 space-y-8 text-center">
              <div className="w-16 h-16 rounded-full bg-gradient-to-br from-success to-success/70 flex items-center justify-center mx-auto">
                <Rocket className="w-8 h-8 text-white" />
              </div>
              <div>
                <h2 className="text-2xl font-bold">You're All Set!</h2>
                <p className="text-muted-foreground mt-1">Your workspace is ready to go.</p>
              </div>

              <div className="text-left space-y-3 max-w-sm mx-auto">
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="w-5 h-5 text-success shrink-0" />
                  <span className="text-sm font-medium">Organization created</span>
                </div>
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="w-5 h-5 text-success shrink-0" />
                  <span className="text-sm font-medium">
                    {invitesSentCount > 0
                      ? `${invitesSentCount} invite${invitesSentCount > 1 ? "s" : ""} sent`
                      : "No invites sent yet"}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <ArrowRight className="w-5 h-5 text-primary shrink-0" />
                  <button
                    type="button"
                    className="text-sm font-medium text-primary hover:underline"
                    onClick={() => navigate("/app/settings", { replace: true })}
                  >
                    Set up expense categories
                  </button>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row items-center gap-3 pt-2">
                <Button variant="outline" onClick={() => setStep(2)} className="w-full sm:w-auto">
                  <ArrowLeft className="w-4 h-4 mr-1" /> Back
                </Button>
                <Button
                  className="w-full sm:flex-1 bg-gradient-to-r from-primary to-accent text-lg font-bold h-12"
                  onClick={handleFinish}
                >
                  Go to Dashboard
                  <ArrowRight className="ml-2 h-5 w-5" />
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
};

export default OrganizationProfile;
