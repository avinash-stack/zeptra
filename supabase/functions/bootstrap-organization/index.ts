import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
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

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json(401, { error: "Missing bearer token" });
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

    if (!companyName) return json(400, { error: "Company name is required" });
    if (!companySlug) return json(400, { error: "Company slug is required" });
    if (!corporateEmail || !corporateEmail.includes("@")) return json(400, { error: "Valid corporate email is required" });

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: authData, error: authError } = await admin.auth.getUser(token);
    if (authError || !authData.user) {
      return json(401, { error: "Invalid auth token" });
    }

    const ownerId = authData.user.id;
    const ownerEmail = authData.user.email?.toLowerCase();
    if (!ownerEmail) {
      return json(400, { error: "Authenticated user must have an email" });
    }

    const { data: existingProfile } = await admin
      .from("users")
      .select("org_id")
      .eq("id", ownerId)
      .single();
    if (existingProfile?.org_id) {
      return json(409, { error: "User already belongs to an organization" });
    }

    const { data: org, error: orgError } = await admin
      .from("organizations")
      .insert({
        name: companyName,
        slug: companySlug,
        corporate_email: corporateEmail,
        business_phone: businessPhone || null,
        created_by: ownerId,
      })
      .select("id")
      .single();
    if (orgError || !org) {
      return json(400, { error: orgError?.message || "Failed to create organization" });
    }

    const fullName = `${firstName} ${lastName}`.trim() || ownerEmail;

    const { error: profileError } = await admin.from("users").upsert(
      {
        id: ownerId,
        org_id: org.id,
        name: fullName,
        email: ownerEmail,
        first_name: firstName || null,
        last_name: lastName || null,
        status: "active",
        is_active: true,
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

    const defaultCategories = [
      "Travel",
      "Meals",
      "Office Supplies",
      "Software",
      "Equipment",
      "Training",
      "Communication",
      "Miscellaneous",
    ].map((name) => ({ org_id: org.id, name }));
    const { error: categoryError } = await admin.from("expense_categories").insert(defaultCategories);
    if (categoryError) {
      return json(500, { error: categoryError.message });
    }
    const { error: currencyError } = await admin.from("org_currencies").insert({
      org_id: org.id,
      code: "USD",
      symbol: "$",
      name: "US Dollar",
      is_default: true,
    });
    if (currencyError) {
      return json(500, { error: currencyError.message });
    }
    const { error: subscriptionError } = await admin.from("subscriptions").insert({
      org_id: org.id,
      plan: "free",
      status: "active",
    });
    if (subscriptionError) {
      return json(500, { error: subscriptionError.message });
    }

    return json(200, {
      success: true,
      user_id: ownerId,
      admin_email: ownerEmail,
      role: "admin",
      company: {
        id: org.id,
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
