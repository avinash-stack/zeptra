import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Action = "delete" | "reset_password";

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

    const body = await req.json().catch(() => null);
    if (!body) {
      return json(400, { error: "Invalid request payload" });
    }

    const token = authHeader.replace("Bearer ", "");
    const action = String(body.action ?? "") as Action;
    const targetUserId = String(body.user_id ?? "").trim();
    const email = String(body.email ?? "").trim().toLowerCase();
    const redirectTo = body.redirect_to ? String(body.redirect_to) : undefined;

    if (!targetUserId) {
      return json(400, { error: "User id is required" });
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: authData, error: authError } = await admin.auth.getUser(token);
    if (authError || !authData.user) {
      return json(401, { error: "Invalid auth token" });
    }

    const callerId = authData.user.id;
    if (callerId === targetUserId) {
      return json(400, { error: "You cannot perform this action on your own account" });
    }

    const { data: callerRoles, error: roleError } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", callerId);

    if (roleError) {
      return json(500, { error: roleError.message });
    }

    const isAdmin = (callerRoles || []).some((row: { role: string }) => row.role === "admin");
    if (!isAdmin) {
      return json(403, { error: "Only admin users can manage password resets or delete users" });
    }

    if (action === "reset_password") {
      if (!email || !email.includes("@")) {
        return json(400, { error: "Valid email is required" });
      }

      const { error } = await admin.auth.resetPasswordForEmail(email, redirectTo ? { redirectTo } : undefined);
      if (error) {
        return json(400, { error: error.message });
      }

      return json(200, { success: true, action, email });
    }

    if (action === "delete") {
      const { error } = await admin.auth.admin.deleteUser(targetUserId);
      if (error) {
        return json(400, { error: error.message });
      }

      return json(200, { success: true, action, user_id: targetUserId });
    }

    return json(400, { error: `Unsupported action: ${action}` });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return json(500, { error: message });
  }
});
