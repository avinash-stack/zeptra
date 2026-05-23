import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.0";

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");

    if (!supabaseUrl || !serviceRoleKey || !stripeSecretKey) {
      return json(500, {
        error: "Missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or STRIPE_SECRET_KEY",
      });
    }

    const proPriceId = Deno.env.get("STRIPE_PRO_PRICE_ID") || "";
    const enterprisePriceId = Deno.env.get("STRIPE_ENTERPRISE_PRICE_ID") || "";

    // Authenticate the caller
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json(401, { error: "Missing bearer token" });
    }

    const body = await req.json().catch(() => null);
    if (!body) {
      return json(400, { error: "Invalid request payload" });
    }

    const { plan, org_id } = body as { plan?: string; org_id?: string };
    if (!plan || !["pro", "enterprise"].includes(plan)) {
      return json(400, { error: "plan must be 'pro' or 'enterprise'" });
    }
    if (!org_id) {
      return json(400, { error: "org_id is required" });
    }

    const token = authHeader.replace("Bearer ", "");
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Verify caller identity
    const { data: authData, error: authError } = await admin.auth.getUser(token);
    if (authError || !authData.user) {
      return json(401, { error: "Invalid auth token" });
    }
    const callerId = authData.user.id;

    // Verify caller is admin of the given org
    const { data: callerProfile } = await admin
      .from("users")
      .select("org_id")
      .eq("id", callerId)
      .single();

    if (!callerProfile || callerProfile.org_id !== org_id) {
      return json(403, { error: "You do not belong to this organization" });
    }

    const { data: callerRoles } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", callerId);

    const isAdmin = (callerRoles || []).some(
      (r: { role: string }) => r.role === "admin",
    );
    if (!isAdmin) {
      return json(403, { error: "Only admin users can manage billing" });
    }

    // Get the org info for Stripe customer creation
    const { data: org } = await admin
      .from("organizations")
      .select("name, corporate_email")
      .eq("id", org_id)
      .single();

    // Get existing subscription to check for stripe_customer_id
    const { data: subscription } = await admin
      .from("subscriptions")
      .select("stripe_customer_id")
      .eq("org_id", org_id)
      .single();

    let stripeCustomerId = subscription?.stripe_customer_id;

    // Create Stripe customer if one doesn't exist
    if (!stripeCustomerId) {
      const customerRes = await fetch("https://api.stripe.com/v1/customers", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${stripeSecretKey}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          name: org?.name || "Unknown Organization",
          email: org?.corporate_email || "",
          "metadata[org_id]": org_id,
        }),
      });

      const customer = await customerRes.json();
      if (customer.error) {
        return json(500, { error: customer.error.message });
      }

      stripeCustomerId = customer.id;

      // Persist the customer ID
      await admin
        .from("subscriptions")
        .update({ stripe_customer_id: stripeCustomerId, updated_at: new Date().toISOString() })
        .eq("org_id", org_id);
    }

    // Determine the price ID
    const priceId = plan === "pro" ? proPriceId : enterprisePriceId;
    if (!priceId) {
      return json(500, {
        error: `STRIPE_${plan.toUpperCase()}_PRICE_ID is not configured`,
      });
    }

    // Build success/cancel URLs
    const origin = req.headers.get("origin") || req.headers.get("referer") || "";
    const baseUrl = origin.replace(/\/$/, "");
    const successUrl = `${baseUrl}/settings?tab=billing&checkout=success`;
    const cancelUrl = `${baseUrl}/settings?tab=billing&checkout=canceled`;

    // Create Stripe Checkout Session
    const sessionRes = await fetch(
      "https://api.stripe.com/v1/checkout/sessions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${stripeSecretKey}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          customer: stripeCustomerId!,
          "line_items[0][price]": priceId,
          "line_items[0][quantity]": "1",
          mode: "subscription",
          "metadata[org_id]": org_id,
          success_url: successUrl,
          cancel_url: cancelUrl,
        }),
      },
    );

    const session = await sessionRes.json();
    if (session.error) {
      return json(500, { error: session.error.message });
    }

    return json(200, { url: session.url });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return json(500, { error: message });
  }
});
