import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type AppRole = "admin" | "employee" | "hr" | "finance";

const validRoles = new Set<AppRole>(["admin", "employee", "hr", "finance"]);

const json = (status: number, payload: Record<string, unknown>) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });

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

    // Parse the request body ONCE before doing anything else
    const body = await req.json().catch(() => null);
    if (!body) {
      return json(400, { error: "Invalid request payload" });
    }

    const token = authHeader.replace("Bearer ", "");

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: authData, error: authError } = await admin.auth.getUser(token);
    if (authError || !authData.user) {
      return json(401, { error: "Invalid auth token" });
    }

    const callerId = authData.user.id;

    const { data: callerRoles, error: roleFetchError } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", callerId);

    if (roleFetchError) {
      return json(500, { error: roleFetchError.message });
    }

    const roleNames = (callerRoles || []).map((r: { role: string }) => r.role);
    const isAdmin = roleNames.includes("admin");
    const isHr = roleNames.includes("hr");
    if (!isAdmin && !isHr) {
      return json(403, { error: "Only admin or HR users can invite new users" });
    }

    // Get the caller's org_id so the invited user joins the same org
    const { data: callerProfile, error: callerProfileError } = await admin
      .from("users")
      .select("org_id")
      .eq("id", callerId)
      .single();

    if (callerProfileError || !callerProfile?.org_id) {
      return json(500, { error: "Could not determine your organization" });
    }

    const email = String(body.email ?? "").trim().toLowerCase();
    const name = String(body.name ?? "").trim();
    const role = String(body.role ?? "employee") as AppRole;
    const managerId = body.manager_id ? String(body.manager_id) : null;
    const tag = body.tag ? String(body.tag) : null;
    const redirectTo = body.redirect_to ? String(body.redirect_to) : undefined;

    if (!email || !email.includes("@")) {
      return json(400, { error: "Valid email is required" });
    }

    if (!name) {
      return json(400, { error: "Name is required" });
    }

    if (!validRoles.has(role)) {
      return json(400, { error: `Invalid role: ${role}` });
    }

    if (!isAdmin && role === "admin") {
      return json(403, { error: "Only admin users can assign the admin role" });
    }

    const inviteOptions: { data?: { name: string }; redirectTo?: string } = {
      data: { name },
    };

    if (redirectTo) {
      inviteOptions.redirectTo = redirectTo;
    }

    const { data: inviteData, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, inviteOptions);
    if (inviteError) {
      return json(400, { error: inviteError.message });
    }

    const invitedUserId = inviteData.user?.id;
    if (!invitedUserId) {
      return json(500, { error: "Invite succeeded but user id was not returned" });
    }

    const { error: profileError } = await admin.from("users").upsert(
      {
        id: invitedUserId,
        org_id: callerProfile.org_id,
        name,
        email,
        manager_id: managerId,
        tag,
        status: "active",
      },
      { onConflict: "id" },
    );

    if (profileError) {
      return json(500, { error: profileError.message });
    }

    const { error: deleteRoleError } = await admin.from("user_roles").delete().eq("user_id", invitedUserId);
    if (deleteRoleError) {
      return json(500, { error: deleteRoleError.message });
    }

    const { error: insertRoleError } = await admin.from("user_roles").insert({
      user_id: invitedUserId,
      role,
    });

    if (insertRoleError) {
      return json(500, { error: insertRoleError.message });
    }

    return json(200, { success: true, user_id: invitedUserId, email, role });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return json(500, { error: message });
  }
});
