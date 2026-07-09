import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const esc = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const json = (status: number, payload: Record<string, unknown>) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function bankTransferSummary(orgSlug: string, country: string): string {
  const isIndia = country === "IN";
  const currency = isIndia ? "₹" : "$";
  const pricePerUser = isIndia ? 49 : 1;
  return `
Bank transfer to activate Pro (${currency}${pricePerUser}/user/month):
- Include reference: ZEPTRA-${esc(orgSlug)}
- Email payment confirmation after transfer
- Pro activates within 24 hours of confirmation`;
}

function buildWarningEmail(params: {
  adminName: string;
  orgName: string;
  trialEnd: Date;
  days: number;
  orgSlug: string;
  country: string;
}): { subject: string; html: string } {
  const { adminName, orgName, trialEnd, days, orgSlug, country } = params;
  const subject = `Your Zeptra Pro trial ends in ${days} day(s)`;
  const transfer = bankTransferSummary(orgSlug, country);

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:40px 20px;">
    <div style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
      <div style="background:linear-gradient(135deg,#f59e0b,#f59e0bdd);padding:24px 32px;">
        <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:600;">Trial Ending Soon</h1>
        <p style="margin:4px 0 0;color:rgba(255,255,255,0.85);font-size:13px;">${esc(orgName)}</p>
      </div>
      <div style="padding:24px 32px;color:#1f2937;font-size:15px;line-height:1.6;">
        <p>Hi ${esc(adminName)}, your ${esc(orgName)} trial ends on ${esc(formatDate(trialEnd))}.</p>
        <p>After that, if you have more than 5 users or 50 expenses, you'll need to upgrade to Pro to keep access.</p>
        <p><strong>Upgrade now:</strong></p>
        <pre style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:12px;font-size:13px;white-space:pre-wrap;">${transfer.trim()}</pre>
      </div>
      <div style="padding:16px 32px;border-top:1px solid #e5e7eb;">
        <p style="margin:0;color:#9ca3af;font-size:12px;">This is an automated notification from Zeptra.</p>
      </div>
    </div>
  </div>
</body>
</html>`;

  return { subject, html };
}

function buildTrialEndedEmail(params: {
  adminName: string;
  orgName: string;
  orgSlug: string;
  country: string;
}): { subject: string; html: string } {
  const { adminName, orgName, orgSlug, country } = params;
  const subject = "Your Zeptra Pro trial has ended";
  const transfer = bankTransferSummary(orgSlug, country);

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:40px 20px;">
    <div style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
      <div style="background:linear-gradient(135deg,#3B82F6,#3B82F6dd);padding:24px 32px;">
        <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:600;">Trial Ended</h1>
        <p style="margin:4px 0 0;color:rgba(255,255,255,0.85);font-size:13px;">${esc(orgName)}</p>
      </div>
      <div style="padding:24px 32px;color:#1f2937;font-size:15px;line-height:1.6;">
        <p>Hi ${esc(adminName)}, your ${esc(orgName)} Pro trial has ended.</p>
        <p>If your org has 5 or fewer users and 50 or fewer expenses this month, you've been automatically moved to our Free Forever plan — no action needed.</p>
        <p>If you exceed these limits, your account will be suspended until you upgrade to Pro.</p>
        <p><strong>Upgrade:</strong></p>
        <pre style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:12px;font-size:13px;white-space:pre-wrap;">${transfer.trim()}</pre>
      </div>
      <div style="padding:16px 32px;border-top:1px solid #e5e7eb;">
        <p style="margin:0;color:#9ca3af;font-size:12px;">This is an automated notification from Zeptra.</p>
      </div>
    </div>
  </div>
</body>
</html>`;

  return { subject, html };
}

async function sendResendEmail(
  resendApiKey: string,
  fromEmail: string,
  to: string,
  subject: string,
  html: string,
): Promise<boolean> {
  const resendRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: fromEmail, to: [to], subject, html }),
  });

  if (!resendRes.ok) {
    const resendData = await resendRes.json().catch(() => ({}));
    console.error("Resend API error:", resendData);
    return false;
  }
  return true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const warningsSent: string[] = [];
  const notificationsSent: string[] = [];

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    const fromEmail = Deno.env.get("RESEND_FROM_EMAIL");

    if (!supabaseUrl || !serviceRoleKey) {
      return json(200, { checked: true, warningsSent, notificationsSent, error: "missing_config" });
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json(200, { checked: true, warningsSent, notificationsSent, error: "unauthenticated" });
    }

    const token = authHeader.replace("Bearer ", "");
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: authData, error: authError } = await admin.auth.getUser(token);
    if (authError || !authData.user) {
      return json(200, { checked: true, warningsSent, notificationsSent, error: "invalid_token" });
    }

    const userId = authData.user.id;

    const { data: profile } = await admin
      .from("users")
      .select("id, name, email, org_id")
      .eq("id", userId)
      .single();

    if (!profile?.org_id) {
      return json(200, { checked: true, warningsSent, notificationsSent });
    }

    const orgId = profile.org_id;

    const [{ data: subscription }, { data: org }] = await Promise.all([
      admin
        .from("subscriptions")
        .select("plan, trial_start, trial_end, trial_warning_sent, trial_ended_notification_sent")
        .eq("org_id", orgId)
        .single(),
      admin
        .from("organizations")
        .select("name, slug, country")
        .eq("id", orgId)
        .single(),
    ]);

    if (!subscription) {
      return json(200, { checked: true, warningsSent, notificationsSent });
    }

    const now = new Date();
    const trialEndRaw = subscription.trial_end;
    const trialEnd = trialEndRaw ? new Date(trialEndRaw) : null;
    const isInTrial = trialEnd ? now < trialEnd : false;
    const trialExpired = trialEnd ? now > trialEnd : false;
    const trialDaysRemaining = trialEnd
      ? Math.max(0, Math.ceil((trialEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)))
      : 0;

    const orgName = org?.name || "Your organization";
    const orgSlug = org?.slug || "ORG";
    const country = org?.country || "IN";

    // Find org admin email
    const { data: orgUsers } = await admin
      .from("users")
      .select("id, name, email")
      .eq("org_id", orgId)
      .eq("is_active", true);

    const orgUserIds = (orgUsers || []).map((u: { id: string }) => u.id);

    let adminEmail: string | null = null;
    let adminName = "Admin";

    if (orgUserIds.length > 0) {
      const { data: adminRoles } = await admin
        .from("user_roles")
        .select("user_id")
        .eq("role", "admin")
        .in("user_id", orgUserIds)
        .limit(1);

      if (adminRoles && adminRoles.length > 0) {
        const adminUser = (orgUsers || []).find(
          (u: { id: string }) => u.id === adminRoles[0].user_id,
        );
        if (adminUser) {
          adminEmail = adminUser.email;
          adminName = adminUser.name || "Admin";
        }
      }
    }

    if (!adminEmail) {
      adminEmail = profile.email;
      adminName = profile.name || "Admin";
    }

    const canSendEmail = Boolean(resendApiKey && fromEmail && adminEmail);

    // WARNING EMAIL (3 days before trial ends)
    if (
      canSendEmail &&
      trialDaysRemaining <= 3 &&
      isInTrial &&
      !subscription.trial_warning_sent
    ) {
      const { subject, html } = buildWarningEmail({
        adminName,
        orgName,
        trialEnd: trialEnd!,
        days: trialDaysRemaining,
        orgSlug,
        country,
      });

      const sent = await sendResendEmail(resendApiKey!, fromEmail!, adminEmail!, subject, html);
      if (sent) {
        await admin
          .from("subscriptions")
          .update({ trial_warning_sent: true })
          .eq("org_id", orgId);
        warningsSent.push("trial_warning");
      }
    }

    // TRIAL ENDED EMAIL
    if (
      canSendEmail &&
      trialExpired &&
      !subscription.trial_ended_notification_sent
    ) {
      const { subject, html } = buildTrialEndedEmail({
        adminName,
        orgName,
        orgSlug,
        country,
      });

      const sent = await sendResendEmail(resendApiKey!, fromEmail!, adminEmail!, subject, html);
      if (sent) {
        await admin
          .from("subscriptions")
          .update({ trial_ended_notification_sent: true })
          .eq("org_id", orgId);
        notificationsSent.push("trial_ended");
      }
    }

    return json(200, { checked: true, warningsSent, notificationsSent });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("check-trial-status error:", message);
    return json(200, { checked: true, warningsSent, notificationsSent, error: message });
  }
});
