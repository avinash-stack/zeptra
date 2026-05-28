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
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json(401, { error: "Missing bearer token" });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      return json(500, { error: "Missing Supabase configuration" });
    }
    if (!anthropicKey) {
      console.error("ANTHROPIC_API_KEY not configured");
      return json(500, { error: "AI provider is not configured" });
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: authData, error: authError } = await admin.auth.getUser(token);
    if (authError || !authData.user) {
      return json(401, { error: "Invalid auth token" });
    }

    const body = await req.json().catch(() => null);
    if (!body) {
      return json(400, { error: "Invalid request payload" });
    }

    const { description, vendor, categories } = body as {
      description?: string;
      vendor?: string;
      categories?: { id: string; name: string }[];
    };

    if (!description || description.length < 5) {
      return json(400, { error: "description must be at least 5 characters" });
    }
    if (!Array.isArray(categories) || categories.length === 0) {
      return json(400, { error: "categories are required" });
    }

    const prompt = `You are an expense categorization assistant.
Given this expense description: "${description}"${vendor ? ` from vendor: "${vendor}"` : ""}

Available categories: ${categories.map((c) => c.name).join(", ")}

Reply with ONLY the single most appropriate category name from the list above, exactly as written. No explanation, no punctuation, just the category name.
If none fit well, reply with the closest match.`;

    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 50,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!claudeRes.ok) {
      console.error("Anthropic API error:", await claudeRes.text());
      return json(502, { error: "AI provider failed" });
    }

    const claudeData = await claudeRes.json();
    const suggested = claudeData.content?.[0]?.text?.trim() || "";

    // Match against actual category names (case-insensitive)
    const match = categories.find(
      (c) => c.name.toLowerCase() === suggested.toLowerCase(),
    );

    if (match) {
      return json(200, { id: match.id, name: match.name });
    }

    return json(404, { error: "No matching category returned" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("suggest-category error:", message);
    return json(500, { error: "Failed to suggest category" });
  }
});
