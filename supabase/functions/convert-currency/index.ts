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
    // ── Auth: same pattern as analyze-expense ──
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json(401, { error: "Missing bearer token" });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      return json(500, { error: "Missing Supabase configuration" });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: authData, error: authError } =
      await supabase.auth.getUser(token);
    if (authError || !authData.user) {
      return json(401, { error: "Invalid auth token" });
    }

    // ── Validate input ──
    const body = await req.json().catch(() => null);
    if (
      !body ||
      typeof body.amount !== "number" ||
      typeof body.from !== "string" ||
      typeof body.to !== "string" ||
      typeof body.date !== "string"
    ) {
      return json(400, {
        error:
          "Request body must include: amount (number), from (string), to (string), date (YYYY-MM-DD string)",
      });
    }

    const { amount, from, to, date } = body as {
      amount: number;
      from: string;
      to: string;
      date: string;
    };

    if (amount <= 0) {
      return json(400, { error: "amount must be greater than 0" });
    }

    // Basic YYYY-MM-DD format check
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return json(400, { error: "date must be in YYYY-MM-DD format" });
    }

    // ── Same-currency shortcut ──
    if (from === to) {
      return json(200, {
        converted_amount: amount,
        rate: 1,
        rate_date: date,
        source: "same_currency",
      });
    }

    // ── Fetch historical rate from Frankfurter ──
    const url = `https://api.frankfurter.app/${date}?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
    const res = await fetch(url);

    if (!res.ok) {
      const errorText = await res.text().catch(() => "Unknown API error");
      console.error(
        `Frankfurter API error (${res.status}): ${errorText}`,
      );
      return json(422, {
        error: `Currency conversion unavailable for ${from} to ${to} on ${date}`,
      });
    }

    const data = await res.json();
    const rate = data?.rates?.[to];

    if (rate == null || typeof rate !== "number") {
      console.error(
        `Frankfurter response missing rate for ${to}:`,
        JSON.stringify(data),
      );
      return json(422, {
        error: `Currency conversion unavailable for ${from} to ${to} on ${date}`,
      });
    }

    const converted_amount = Math.round(amount * rate * 100) / 100;

    return json(200, {
      converted_amount,
      rate,
      rate_date: data.date, // May differ from requested date (weekends/holidays)
      source: "frankfurter",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("convert-currency error:", message);
    return json(500, { error: "Failed to convert currency" });
  }
});
