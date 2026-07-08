import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const esc = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const json = (status: number, payload: Record<string, unknown>) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    const fromEmail = Deno.env.get("RESEND_FROM_EMAIL");

    if (!supabaseUrl || !serviceRoleKey) {
      return json(500, {
        error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
      });
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
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Verify caller is authenticated
    const { data: authData, error: authError } = await admin.auth.getUser(
      token,
    );
    if (authError || !authData.user) {
      return json(401, { error: "Invalid auth token" });
    }

    const {
      org_name,
      admin_name,
      admin_email,
    }: { org_name?: string; admin_name?: string; admin_email?: string } = body;

    if (!admin_email) {
      return json(400, { error: "admin_email is required" });
    }

    // Gracefully skip if Resend is not configured
    if (!resendApiKey || !fromEmail) {
      console.log(
        "Welcome email skipped: RESEND_API_KEY or RESEND_FROM_EMAIL not configured",
      );
      return json(200, {
        success: true,
        skipped: true,
        reason: "Resend not configured",
      });
    }

    // Generate a magic link for email verification
    const siteUrl = Deno.env.get("SITE_URL") || "http://localhost:5173";
    const { data: linkData, error: linkError } =
      await admin.auth.admin.generateLink({
        type: "magiclink",
        email: admin_email,
        options: { redirectTo: `${siteUrl}/app` },
      });

    let verifyLink = `${siteUrl}/app`;
    if (!linkError && linkData?.properties?.action_link) {
      verifyLink = linkData.properties.action_link;
    } else if (linkError) {
      console.warn("Magic link generation failed (non-fatal):", linkError.message);
    }

    const safeName = esc(admin_name || "there");
    const safeOrg = esc(org_name || "your organization");
    const safeLink = esc(verifyLink);

    const emailHtml = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:40px 20px;">
    <div style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
      <div style="background:linear-gradient(135deg,#3B82F6,#8B5CF6);padding:32px;">
        <h1 style="margin:0;color:#ffffff;font-size:28px;font-weight:700;">Welcome to Zeptra! 🎉</h1>
      </div>
      <div style="padding:32px;">
        <h2 style="margin:0 0 16px;color:#111827;font-size:20px;">Hi ${safeName},</h2>
        <p style="margin:0 0 16px;color:#4b5563;font-size:16px;line-height:1.6;">
          Your organization <strong>${safeOrg}</strong> has been created successfully on Zeptra.
        </p>
        <p style="margin:0 0 24px;color:#4b5563;font-size:16px;line-height:1.6;">
          As the admin, you can now invite team members, set up expense categories, and start managing expenses.
        </p>
        <a href="${safeLink}" style="display:inline-block;background:linear-gradient(135deg,#3B82F6,#8B5CF6);color:#ffffff;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:600;font-size:16px;">
          Verify Email &amp; Go to Dashboard
        </a>
        <div style="margin-top:32px;padding-top:24px;border-top:1px solid #e5e7eb;">
          <p style="margin:0 0 12px;color:#6b7280;font-size:14px;font-weight:600;">Quick Start Guide:</p>
          <ul style="margin:0;padding:0 0 0 20px;color:#6b7280;font-size:14px;line-height:1.8;">
            <li>Invite your team from the User Management page</li>
            <li>Configure expense categories in Settings</li>
            <li>Set up approval workflows with manager assignments</li>
          </ul>
        </div>
      </div>
      <div style="padding:16px 32px;border-top:1px solid #e5e7eb;background:#f9fafb;">
        <p style="margin:0;color:#9ca3af;font-size:12px;">You're receiving this because you created an organization on Zeptra.</p>
      </div>
    </div>
  </div>
</body>
</html>`;

    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [admin_email],
        subject: `Welcome to Zeptra — ${org_name || "Your organization"} is ready!`,
        html: emailHtml,
      }),
    });

    if (!resendRes.ok) {
      const errText = await resendRes.text().catch(() => "Unknown error");
      console.error(
        `Welcome email failed for ${admin_email}: HTTP ${resendRes.status} — ${errText}`,
      );
      return json(200, {
        success: true,
        warning: "Organization created but welcome email failed to send",
      });
    }

    console.log(`Welcome email sent to ${admin_email}`);
    return json(200, { success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Welcome email error:", message);
    return json(500, { error: message });
  }
});
