import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Action = "delete" | "reset_password" | "update_role" | "update_profile" | "update_status" | "update_user";
type AppRole = "admin" | "employee" | "hr" | "finance";
type ProfileStatus = "active" | "inactive";

const validRoles = new Set<AppRole>(["admin", "employee", "hr", "finance"]);
const validStatuses = new Set<ProfileStatus>(["active", "inactive"]);

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

    const rawBody = await req.json().catch(() => null);
    if (!rawBody) {
      return json(400, { error: "Invalid request payload" });
    }

    const body = (
      typeof rawBody === "object" &&
      rawBody !== null &&
      "body" in rawBody &&
      typeof rawBody.body === "object" &&
      rawBody.body !== null &&
      !("action" in rawBody)
    ) ? rawBody.body as Record<string, unknown> : rawBody as Record<string, unknown>;

    const token = authHeader.replace("Bearer ", "");
    const action = String(body.action ?? "") as Action;
    const targetUserId = String(
      body.target_user_id ??
      body.targetUserId ??
      body.user_id ??
      body.userId ??
      body.id ??
      "",
    ).trim();
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
    const isHr = (callerRoles || []).some((row: { role: string }) => row.role === "hr");
    const canEditUsers = isAdmin || isHr;

    if ((action === "reset_password" || action === "delete") && !isAdmin) {
      return json(403, { error: "Only admin users can manage password resets or delete users" });
    }

    if ((action === "update_role" || action === "update_profile" || action === "update_status" || action === "update_user") && !canEditUsers) {
      return json(403, { error: "Only admin or HR users can edit users" });
    }

    const { data: targetProfile, error: targetProfileError } = await admin.from("users")
      .select("id, org_id")
      .eq("id", targetUserId)
      .single();
    const { data: callerProfile, error: callerProfileError } = await admin.from("users")
      .select("org_id")
      .eq("id", callerId)
      .single();
    if (targetProfileError || !targetProfile) {
      return json(404, { error: "Target user not found" });
    }
    if (callerProfileError || !callerProfile?.org_id) {
      return json(500, { error: "Could not determine your organization" });
    }
    if (!targetProfile || targetProfile.org_id !== callerProfile?.org_id)
      return json(403, { error: 'Target user not in your organization' });

    const { data: targetRoles, error: targetRolesError } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", targetUserId);

    if (targetRolesError) {
      return json(500, { error: targetRolesError.message });
    }

    const targetIsAdmin = (targetRoles || []).some((row: { role: string }) => row.role === "admin");
    if (!isAdmin && targetIsAdmin) {
      return json(403, { error: "Only admin users can modify admin accounts" });
    }

    if (action === "reset_password") {
      if (!email || !email.includes("@")) {
        return json(400, { error: "Valid email is required" });
      }
      const allowedRedirectOrigins = [
        Deno.env.get("SITE_URL"),
        "http://localhost:5173",
        "http://localhost:3000",
      ];
      if (redirectTo && !allowedRedirectOrigins.some((origin) => origin && redirectTo.startsWith(origin))) {
        return json(400, { error: "Invalid redirect_to" });
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

    if (action === "update_role" || (action === "update_user" && "role" in body)) {
      const role = String(body.role ?? "").trim() as AppRole;
      if (!validRoles.has(role)) {
        return json(400, { error: `Invalid role: ${role || "missing"}` });
      }
      if (!isAdmin && role === "admin") {
        return json(403, { error: "Only admin users can assign the admin role" });
      }
      if (!isAdmin && targetIsAdmin) {
        return json(403, { error: "Only admin users can change admin roles" });
      }

      const { error: insertRoleError } = await admin
        .from("user_roles")
        .upsert({ user_id: targetUserId, role }, { onConflict: "user_id,role" });
      if (insertRoleError) {
        return json(400, { error: insertRoleError.message });
      }

      const { error: deleteRoleError } = await admin
        .from("user_roles")
        .delete()
        .eq("user_id", targetUserId)
        .neq("role", role);
      if (deleteRoleError) {
        return json(400, { error: deleteRoleError.message });
      }

      if (action === "update_role") {
        return json(200, { success: true, action, user_id: targetUserId, role });
      }
    }

    if (action === "update_status" || (action === "update_user" && "status" in body)) {
      const status = String(body.status ?? "").trim() as ProfileStatus;
      if (!validStatuses.has(status)) {
        return json(400, { error: `Invalid status: ${status || "missing"}` });
      }

      const { error } = await admin
        .from("users")
        .update({ status, is_active: status === "active" })
        .eq("id", targetUserId);

      if (error) {
        return json(400, { error: error.message });
      }

      if (action === "update_status") {
        return json(200, { success: true, action, user_id: targetUserId, status });
      }
    }

    if (action === "update_profile" || action === "update_user") {
      const updates: Record<string, unknown> = {};

      if ("manager_id" in body) {
        const managerId = body.manager_id ? String(body.manager_id).trim() : null;
        if (managerId === targetUserId) {
          return json(400, { error: "A user cannot be their own manager" });
        }
        if (managerId) {
          const { data: managerProfile, error: managerError } = await admin
            .from("users")
            .select("id, org_id, status")
            .eq("id", managerId)
            .single();
          if (managerError || !managerProfile) {
            return json(400, { error: "Selected manager does not exist" });
          }
          if (managerProfile.org_id !== callerProfile.org_id) {
            return json(400, { error: "Selected manager is not in your organization" });
          }
          if (managerProfile.status !== "active") {
            return json(400, { error: "Selected manager must be active" });
          }
        }
        updates.manager_id = managerId;
      }

      if ("tag" in body) {
        const tag = body.tag ? String(body.tag).trim() : null;
        updates.tag = tag || null;
      }

      if ("name" in body) {
        const name = String(body.name ?? "").trim();
        if (!name) {
          return json(400, { error: "Name is required" });
        }
        updates.name = name;
      }

      if (Object.keys(updates).length > 0) {
        const { error } = await admin
          .from("users")
          .update(updates)
          .eq("id", targetUserId);

        if (error) {
          return json(400, { error: error.message });
        }
      }

      return json(200, { success: true, action, user_id: targetUserId });
    }

    return json(400, { error: `Unsupported action: ${action}` });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return json(500, { error: message });
  }
});
