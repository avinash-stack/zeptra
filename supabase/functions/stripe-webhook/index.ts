import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, stripe-signature",
};

const json = (status: number, payload: Record<string, unknown>) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// Compute HMAC-SHA256 for Stripe webhook signature verification
async function computeHmac(secret: string, payload: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Constant-time comparison to prevent timing attacks
function secureCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

// Verify the Stripe-Signature header
async function verifyStripeSignature(
  payload: string,
  header: string,
  secret: string,
): Promise<boolean> {
  const parts = header.split(",");
  let timestamp = "";
  const signatures: string[] = [];

  for (const part of parts) {
    const [key, value] = part.split("=");
    if (key === "t") timestamp = value;
    if (key === "v1") signatures.push(value);
  }

  if (!timestamp || signatures.length === 0) return false;

  // Check timestamp is within 5 minutes
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parseInt(timestamp, 10)) > 300) return false;

  const signedPayload = `${timestamp}.${payload}`;
  const expectedSig = await computeHmac(secret, signedPayload);

  return signatures.some((sig) => secureCompare(sig, expectedSig));
}

// Map Stripe price ID to plan name
function priceToPlan(priceId: string): "pro" | "enterprise" | null {
  const proPriceId = Deno.env.get("STRIPE_PRO_PRICE_ID") || "";
  const enterprisePriceId = Deno.env.get("STRIPE_ENTERPRISE_PRICE_ID") || "";

  if (priceId === proPriceId) return "pro";
  if (priceId === enterprisePriceId) return "enterprise";
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!webhookSecret || !supabaseUrl || !serviceRoleKey) {
      return json(500, { error: "Missing required environment variables" });
    }

    const signature = req.headers.get("stripe-signature");
    if (!signature) {
      return json(400, { error: "Missing Stripe-Signature header" });
    }

    const body = await req.text();
    const valid = await verifyStripeSignature(body, signature, webhookSecret);
    if (!valid) {
      return json(400, { error: "Invalid signature" });
    }

    const event = JSON.parse(body);
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        const orgId = session.metadata?.org_id;
        if (!orgId) {
          return json(400, { error: "Missing org_id in session metadata" });
        }

        const stripeCustomerId = session.customer;
        const stripeSubscriptionId = session.subscription;

        // Retrieve subscription details from Stripe to get plan and period info
        const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY") || "";
        const subRes = await fetch(
          `https://api.stripe.com/v1/subscriptions/${stripeSubscriptionId}`,
          {
            headers: { Authorization: `Bearer ${stripeSecretKey}` },
          },
        );
        const sub = await subRes.json();

        const priceId = sub.items?.data?.[0]?.price?.id || "";
        const plan = priceToPlan(priceId) || "pro";
        const currentPeriodEnd = sub.current_period_end
          ? new Date(sub.current_period_end * 1000).toISOString()
          : null;

        const { error } = await admin.from("subscriptions").upsert(
          {
            org_id: orgId,
            stripe_customer_id: stripeCustomerId,
            stripe_subscription_id: stripeSubscriptionId,
            plan,
            status: "active",
            current_period_end: currentPeriodEnd,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "org_id" },
        );

        if (error) {
          console.error("checkout.session.completed upsert error:", error);
          return json(500, { error: error.message });
        }
        break;
      }

      case "customer.subscription.updated": {
        const sub = event.data.object;
        const stripeSubscriptionId = sub.id;
        const stripeCustomerId = sub.customer;
        const priceId = sub.items?.data?.[0]?.price?.id || "";
        const plan = priceToPlan(priceId) || "pro";
        const status = sub.cancel_at_period_end ? "canceling" : sub.status;
        const currentPeriodEnd = sub.current_period_end
          ? new Date(sub.current_period_end * 1000).toISOString()
          : null;

        const { error } = await admin
          .from("subscriptions")
          .update({
            plan,
            status,
            current_period_end: currentPeriodEnd,
            updated_at: new Date().toISOString(),
          })
          .eq("stripe_subscription_id", stripeSubscriptionId);

        if (error) {
          console.error("subscription.updated error:", error);
          return json(500, { error: error.message });
        }
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object;
        const stripeSubscriptionId = sub.id;

        const { error } = await admin
          .from("subscriptions")
          .update({
            plan: "free",
            status: "canceled",
            stripe_subscription_id: null,
            current_period_end: null,
            updated_at: new Date().toISOString(),
          })
          .eq("stripe_subscription_id", stripeSubscriptionId);

        if (error) {
          console.error("subscription.deleted error:", error);
          return json(500, { error: error.message });
        }
        break;
      }

      default:
        // Ignore unhandled event types
        break;
    }

    return json(200, { received: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Webhook error:", message);
    return json(500, { error: message });
  }
});
