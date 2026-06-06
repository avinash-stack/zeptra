import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.0";

const esc = (s: string) => s.replace(/&/g,'&amp;').replace(/</g,'&lt;')
  .replace(/>/g,'&gt;').replace(/"/g,'&quot;');

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const json = (status: number, payload: Record<string, unknown>) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

type NotificationEvent = "submitted" | "approved" | "rejected" | "reassigned";

function currencySymbol(code: string): string {
  const map: Record<string, string> = {
    INR: "₹",
    EUR: "€",
    GBP: "£",
    USD: "$",
    JPY: "¥",
  };
  return map[code] || code + " ";
}

function buildEmailHtml(params: {
  orgName: string;
  event: NotificationEvent;
  employeeName: string;
  amount: string;
  currency: string;
  category: string;
  description: string;
  comments?: string;
  approverName?: string;
}): { subject: string; html: string } {
  const { orgName, event, employeeName, amount, currency, category, description, comments, approverName } = params;
  const orgNameEsc = esc(orgName);
  const employeeNameEsc = esc(employeeName);
  const categoryEsc = esc(category);
  const descriptionEsc = esc(description);
  const commentsEsc = esc(comments || "");
  const approverNameEsc = esc(approverName || "");
  const sym = currencySymbol(currency);
  const formattedAmount = `${sym}${Number(amount).toFixed(2)}`;

  let subject = "";
  let heading = "";
  let body = "";
  let accentColor = "#3B82F6"; // Electric Blue

  switch (event) {
    case "submitted":
      subject = `[${orgNameEsc}] Action required: ${employeeNameEsc} submitted ${formattedAmount} for ${categoryEsc}`;
      heading = "New Expense Awaiting Your Approval";
      accentColor = "#3B82F6";
      body = `
        <p><strong>${employeeNameEsc}</strong> has submitted an expense that requires your review.</p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0;">
          <tr><td style="padding:8px 12px;color:#6b7280;width:120px;">Amount</td><td style="padding:8px 12px;font-weight:600;">${formattedAmount} ${currency}</td></tr>
          <tr><td style="padding:8px 12px;color:#6b7280;">Category</td><td style="padding:8px 12px;">${categoryEsc}</td></tr>
          <tr><td style="padding:8px 12px;color:#6b7280;">Description</td><td style="padding:8px 12px;">${descriptionEsc}</td></tr>
        </table>
        <p style="color:#6b7280;font-size:14px;">Log in to Zeptra to approve or reject this expense.</p>
      `;
      break;

    case "approved":
      subject = `[${orgNameEsc}] Your expense of ${formattedAmount} was approved`;
      heading = "Expense Approved ✓";
      accentColor = "#22c55e";
      body = `
        <p>Great news! Your expense has been approved${approverName ? ` by <strong>${approverNameEsc}</strong>` : ""}.</p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0;">
          <tr><td style="padding:8px 12px;color:#6b7280;width:120px;">Amount</td><td style="padding:8px 12px;font-weight:600;">${formattedAmount} ${currency}</td></tr>
          <tr><td style="padding:8px 12px;color:#6b7280;">Category</td><td style="padding:8px 12px;">${categoryEsc}</td></tr>
          <tr><td style="padding:8px 12px;color:#6b7280;">Description</td><td style="padding:8px 12px;">${descriptionEsc}</td></tr>
        </table>
      `;
      break;

    case "rejected":
      subject = `[${orgNameEsc}] Your expense of ${formattedAmount} was rejected`;
      heading = "Expense Rejected";
      accentColor = "#ef4444";
      body = `
        <p>Unfortunately, your expense has been rejected${approverName ? ` by <strong>${approverNameEsc}</strong>` : ""}.</p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0;">
          <tr><td style="padding:8px 12px;color:#6b7280;width:120px;">Amount</td><td style="padding:8px 12px;font-weight:600;">${formattedAmount} ${currency}</td></tr>
          <tr><td style="padding:8px 12px;color:#6b7280;">Category</td><td style="padding:8px 12px;">${categoryEsc}</td></tr>
          <tr><td style="padding:8px 12px;color:#6b7280;">Description</td><td style="padding:8px 12px;">${descriptionEsc}</td></tr>
        </table>
        ${comments ? `
        <div style="background:#fef2f2;border-left:4px solid #ef4444;padding:12px 16px;border-radius:4px;margin:16px 0;">
          <p style="margin:0;color:#6b7280;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;">Reason</p>
          <p style="margin:4px 0 0;color:#1f2937;">${commentsEsc}</p>
        </div>
        ` : ""}
        <p style="color:#6b7280;font-size:14px;">You can revise and resubmit the expense from your dashboard.</p>
      `;
      break;

    case "reassigned":
      subject = `[${orgNameEsc}] An expense has been reassigned to you`;
      heading = "Expense Reassigned to You";
      accentColor = "#f59e0b";
      body = `
        <p>An expense has been reassigned to you for review.</p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0;">
          <tr><td style="padding:8px 12px;color:#6b7280;width:120px;">Submitted by</td><td style="padding:8px 12px;font-weight:600;">${employeeNameEsc}</td></tr>
          <tr><td style="padding:8px 12px;color:#6b7280;">Amount</td><td style="padding:8px 12px;font-weight:600;">${formattedAmount} ${currency}</td></tr>
          <tr><td style="padding:8px 12px;color:#6b7280;">Category</td><td style="padding:8px 12px;">${categoryEsc}</td></tr>
          <tr><td style="padding:8px 12px;color:#6b7280;">Description</td><td style="padding:8px 12px;">${descriptionEsc}</td></tr>
        </table>
        ${comments ? `
        <div style="background:#fffbeb;border-left:4px solid #f59e0b;padding:12px 16px;border-radius:4px;margin:16px 0;">
          <p style="margin:0;color:#6b7280;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;">Notes from previous reviewer</p>
          <p style="margin:4px 0 0;color:#1f2937;">${commentsEsc}</p>
        </div>
        ` : ""}
        <p style="color:#6b7280;font-size:14px;">Log in to Zeptra to review this expense.</p>
      `;
      break;
  }

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:40px 20px;">
    <div style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
      <!-- Header -->
      <div style="background:linear-gradient(135deg,${accentColor},${accentColor}dd);padding:24px 32px;">
        <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:600;">${heading}</h1>
        <p style="margin:4px 0 0;color:rgba(255,255,255,0.85);font-size:13px;">${orgNameEsc}</p>
      </div>
      <!-- Body -->
      <div style="padding:24px 32px;">
        ${body}
      </div>
      <!-- Footer -->
      <div style="padding:16px 32px;border-top:1px solid #e5e7eb;">
        <p style="margin:0;color:#9ca3af;font-size:12px;">This is an automated notification from Zeptra. You can manage your notification preferences in Account Settings.</p>
      </div>
    </div>
  </div>
</body>
</html>`;

  return { subject, html };
}

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
      return json(500, { error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" });
    }
    if (!resendApiKey || !fromEmail) {
      return json(500, { error: "Missing RESEND_API_KEY or RESEND_FROM_EMAIL" });
    }

    const authHeader = req.headers.get("Authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.replace("Bearer ", "") : "";
    if (!token || token !== serviceRoleKey) {
      return json(401, { error: "Invalid internal authorization token" });
    }

    const body = await req.json().catch(() => null);
    if (!body) {
      return json(400, { error: "Invalid request payload" });
    }

    const event = body.event as NotificationEvent;
    const expenseId = body.expense_id as string;

    if (!event || !["submitted", "approved", "rejected", "reassigned"].includes(event)) {
      return json(400, { error: "Invalid event type" });
    }
    if (!expenseId) {
      return json(400, { error: "expense_id is required" });
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Fetch expense details
    const { data: expense, error: expenseErr } = await admin
      .from("expenses")
      .select("*, expense_categories(name)")
      .eq("id", expenseId)
      .single();

    if (expenseErr || !expense) {
      return json(404, { error: "Expense not found" });
    }

    // Fetch submitter profile
    const { data: submitter } = await admin
      .from("users")
      .select("id, name, email, org_id")
      .eq("id", expense.user_id)
      .single();

    if (!submitter) {
      return json(500, { error: "Submitter profile not found" });
    }

    // Fetch org name
    let orgName = "Zeptra";
    if (submitter.org_id) {
      const { data: org } = await admin
        .from("organizations")
        .select("name")
        .eq("id", submitter.org_id)
        .single();
      if (org) orgName = org.name;
    }

    // Determine recipient
    let recipientId: string | null = null;
    if (event === "submitted" || event === "reassigned") {
      recipientId = expense.current_approver_id;
    } else {
      // approved / rejected → notify the submitter
      recipientId = expense.user_id;
    }

    if (!recipientId) {
      return json(200, { skipped: true, reason: "No recipient" });
    }

    // Fetch recipient profile
    const { data: recipient } = await admin
      .from("users")
      .select("id, name, email")
      .eq("id", recipientId)
      .single();

    if (!recipient || !recipient.email) {
      return json(200, { skipped: true, reason: "Recipient has no email" });
    }

    // Check notification preferences
    const { data: prefs } = await admin
      .from("notification_preferences")
      .select("*")
      .eq("user_id", recipientId)
      .single();

    if (prefs) {
      const prefMap: Record<NotificationEvent, string> = {
        submitted: "on_approval_needed",
        approved: "on_expense_approved",
        rejected: "on_expense_rejected",
        reassigned: "on_approval_needed",
      };
      const prefKey = prefMap[event];
      if (prefs[prefKey] === false) {
        return json(200, { skipped: true, reason: `User opted out of ${prefKey}` });
      }
    }

    // For rejected/reassigned, fetch latest approval_history comments
    let latestComments: string | undefined;
    if (event === "rejected" || event === "reassigned") {
      const { data: history } = await admin
        .from("approval_history")
        .select("comments")
        .eq("expense_id", expenseId)
        .order("acted_at", { ascending: false })
        .limit(1)
        .single();
      if (history?.comments) {
        latestComments = history.comments;
      }
    }

    // For approved/rejected, try to find the approver name for the email
    let approverName: string | undefined;
    if (event === "approved" || event === "rejected") {
      const { data: history } = await admin
        .from("approval_history")
        .select("approver_id")
        .eq("expense_id", expenseId)
        .order("acted_at", { ascending: false })
        .limit(1)
        .single();
      if (history?.approver_id) {
        const { data: approver } = await admin
          .from("users")
          .select("name")
          .eq("id", history.approver_id)
          .single();
        approverName = approver?.name;
      }
    }

    // Build email
    const categoryName = (expense as any).expense_categories?.name || "Uncategorized";
    const { subject, html } = buildEmailHtml({
      orgName,
      event,
      employeeName: submitter.name,
      amount: String(expense.amount),
      currency: expense.currency,
      category: categoryName,
      description: expense.description,
      comments: latestComments,
      approverName,
    });

    // Send via Resend API
    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [recipient.email],
        subject,
        html,
      }),
    });

    const resendData = await resendRes.json();

    if (!resendRes.ok) {
      console.error("Resend API error:", resendData);
      return json(500, { error: resendData.message || "Failed to send email" });
    }

    return json(200, { success: true, email_id: resendData.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("send-notification error:", message);
    return json(500, { error: message });
  }
});
