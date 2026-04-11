import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (status: number, payload: Record<string, unknown>) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });

const normalizeSlug = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9- ]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      return json(500, { error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in function environment" });
    }

    const body = await req.json().catch(() => null);
    if (!body) {
      return json(400, { error: "Invalid request payload" });
    }

    const companyName = String(body.company_name ?? "").trim();
    const companySlug = normalizeSlug(String(body.company_slug ?? ""));
    const corporateEmail = String(body.corporate_email ?? "").trim().toLowerCase();
    const businessPhone = String(body.business_phone ?? "").trim();
    const firstName = String(body.first_name ?? "").trim();
    const lastName = String(body.last_name ?? "").trim();
    const adminEmail = String(body.admin_email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");

    if (!companyName) return json(400, { error: "Company name is required" });
    if (!companySlug) return json(400, { error: "Company slug is required" });
    if (!corporateEmail || !corporateEmail.includes("@")) return json(400, { error: "Valid corporate email is required" });
    if (!adminEmail || !adminEmail.includes("@")) return json(400, { error: "Valid admin email is required" });
    if (!password || password.length < 8) return json(400, { error: "Password must be at least 8 characters" });

    const fullName = `${firstName} ${lastName}`.trim() || adminEmail;
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const metadata = {
      name: fullName,
      first_name: firstName || null,
      last_name: lastName || null,
      company_name: companyName,
      company_slug: companySlug,
      corporate_email: corporateEmail,
      business_phone: businessPhone || null,
      account_type: "organization_owner",
    };

    const { data: createdUser, error: createUserError } = await admin.auth.admin.createUser({
      email: adminEmail,
      password,
      email_confirm: true,
      user_metadata: metadata,
      app_metadata: { role: "admin", account_type: "organization_owner" },
    });

    if (createUserError || !createdUser.user) {
      return json(400, { error: createUserError?.message ?? "Failed to create organization owner account" });
    }

    const ownerId = createdUser.user.id;

    const { error: profileError } = await admin.from("profiles").upsert(
      {
        id: ownerId,
        name: fullName,
        email: adminEmail,
        status: "active",
      },
      { onConflict: "id" },
    );
    if (profileError) {
      return json(500, { error: profileError.message });
    }

    const { error: deleteRoleError } = await admin.from("user_roles").delete().eq("user_id", ownerId);
    if (deleteRoleError) {
      return json(500, { error: deleteRoleError.message });
    }

    const { error: roleError } = await admin.from("user_roles").insert({
      user_id: ownerId,
      role: "admin",
    });
    if (roleError) {
      return json(500, { error: roleError.message });
    }

    return json(200, {
      success: true,
      user_id: ownerId,
      admin_email: adminEmail,
      role: "admin",
      company: {
        name: companyName,
        slug: companySlug,
        corporate_email: corporateEmail,
        business_phone: businessPhone || null,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return json(500, { error: message });
  }
});
