import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type AppRole = "admin" | "employee" | "hr" | "finance";

const validRoles = new Set<AppRole>(["admin", "employee", "hr", "finance"]);
const esc = (value: string) => value
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");

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

    // Plan limit check
    const { data: sub } = await admin.from('subscriptions')
      .select('plan').eq('org_id', callerProfile.org_id).single();
    const plan = sub?.plan || 'free';
    const { data: planLimit } = await admin.from('plan_limits')
      .select('max_users').eq('plan', plan).single();
    const limit = planLimit?.max_users ?? null;

    const invites = Array.isArray(body.invites) ? body.invites : [body];
    
    if (limit !== null) {
      const { count } = await admin.from('users')
        .select('id', { count:'exact', head:true })
        .eq('org_id', callerProfile.org_id).eq('is_active', true);
      if ((count||0) + invites.length > limit)
        return json(403, { error: `${plan} plan limit reached. Upgrade to invite more users.` });
    }

    // Fetch org name
    let orgName = "Zeptra";
    const { data: orgData } = await admin.from("organizations").select("name").eq("id", callerProfile.org_id).single();
    if (orgData?.name) orgName = orgData.name;

    // Fetch inviter name
    let inviterName = "Someone";
    const { data: inviterData } = await admin.from("users").select("name").eq("id", callerId).single();
    if (inviterData?.name) inviterName = inviterData.name;

    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    const fromEmail = Deno.env.get("RESEND_FROM_EMAIL");
    if (!resendApiKey || !fromEmail) {
      return json(500, { error: "Missing RESEND_API_KEY or RESEND_FROM_EMAIL in function environment" });
    }

    const results = await Promise.allSettled(invites.map(async (invite: any) => {
      const email = String(invite.email ?? "").trim().toLowerCase();
      const name = String(invite.name ?? "").trim();
      const role = String(invite.role ?? "employee") as AppRole;
      const managerId = invite.manager_id ? String(invite.manager_id) : null;
      const tag = invite.tag ? String(invite.tag) : null;
      const redirectTo = invite.redirect_to ? String(invite.redirect_to) : undefined;

      if (managerId) {
        const { data: mgr } = await admin.from('users').select('org_id').eq('id', managerId).single();
        if (!mgr || mgr.org_id !== callerProfile.org_id) throw new Error('Invalid manager_id');
      }

      const allowed = [Deno.env.get('SITE_URL'),'http://localhost:5173','http://localhost:3000'];
      if (redirectTo && !allowed.some(o => o && redirectTo.startsWith(o))) throw new Error('Invalid redirect_to');
      if (!email || !email.includes("@")) throw new Error("Valid email is required");
      if (!name) throw new Error("Name is required");
      if (!validRoles.has(role)) throw new Error(`Invalid role: ${role}`);
      if (!isAdmin && role === "admin") throw new Error("Only admin users can assign the admin role");

      const inviteOptions: { data?: { name: string }; redirectTo?: string } = { data: { name } };
      if (redirectTo) inviteOptions.redirectTo = redirectTo;

      const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
        type: 'invite',
        email,
        options: inviteOptions,
      });

      if (linkError) throw new Error(linkError.message);

      const invitedUserId = linkData.user?.id;
      const actionLink = linkData.properties?.action_link;

      if (!invitedUserId || !actionLink) throw new Error("Invite succeeded but failed to generate action link");

      const { error: profileError } = await admin.from("users").upsert(
        { id: invitedUserId, org_id: callerProfile.org_id, name, email, manager_id: managerId, tag, status: "active", is_active: true },
        { onConflict: "id" },
      );
      if (profileError) throw new Error(profileError.message);

      await admin.from("user_roles").delete().eq("user_id", invitedUserId);
      const { error: insertRoleError } = await admin.from("user_roles").insert({ user_id: invitedUserId, role });
      if (insertRoleError) throw new Error(insertRoleError.message);

      const emailHtml = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:40px 20px;">
    <div style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
      <div style="background:#3B82F6;padding:24px 32px;">
        <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;">Zeptra</h1>
      </div>
      <div style="padding:32px;">
        <h2 style="margin:0 0 16px;color:#111827;font-size:20px;">Hi ${esc(name)},</h2>
        <p style="margin:0 0 24px;color:#4b5563;font-size:16px;line-height:1.5;">
          <strong>${esc(inviterName)}</strong> has invited you to join <strong>${esc(orgName)}</strong> as a <strong>${esc(role)}</strong> on Zeptra.
        </p>
        <a href="${esc(actionLink)}" style="display:inline-block;background:#3B82F6;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:6px;font-weight:600;font-size:16px;">Accept Invitation & Set Password</a>
        <p style="margin:24px 0 0;color:#9ca3af;font-size:14px;">This link expires in 24 hours.</p>
      </div>
      <div style="padding:16px 32px;border-top:1px solid #e5e7eb;background:#f9fafb;">
        <p style="margin:0;color:#9ca3af;font-size:12px;">If you didn't expect this invitation, you can safely ignore this email.</p>
      </div>
    </div>
  </div>
</body>
</html>`;

      const resendRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: fromEmail,
          to: [email],
          subject: `You've been invited to join ${orgName} on Zeptra`,
          html: emailHtml,
        }),
      });

      if (!resendRes.ok) throw new Error("User was created, but invitation email failed to send.");
      return { success: true, email };
    }));

    const failures = results.filter(r => r.status === 'rejected');
    if (failures.length > 0 && invites.length === 1) {
      return json(400, { error: (failures[0] as PromiseRejectedResult).reason.message });
    }

    return json(200, { success: true, results: results.map(r => r.status === 'fulfilled' ? r.value : { error: r.reason.message }) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return json(500, { error: message });
  }
});
