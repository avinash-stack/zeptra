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

    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!anthropicKey) {
      console.error("ANTHROPIC_API_KEY not configured");
      return json(200, {});
    }

    const body = await req.json().catch(() => null);
    if (!body) {
      return json(200, {});
    }

    const { description, vendor, categories } = body as {
      description?: string;
      vendor?: string;
      categories?: { id: string; name: string }[];
    };

    // Guard: too short or no categories
    if (!description || description.length < 5) return json(200, {});
    if (!categories || categories.length === 0) return json(200, {});

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
      return json(200, {});
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

    return json(200, {});
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("suggest-category error:", message);
    // Never block the user
    return json(200, {});
  }
});
