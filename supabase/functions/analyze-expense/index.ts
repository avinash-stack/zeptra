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

const defaultAnalysis = { risk_level: "low", flags: [], suggestion: "" };

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
      return json(200, defaultAnalysis);
    }
    if (!anthropicKey) {
      console.error("ANTHROPIC_API_KEY not configured");
      return json(200, defaultAnalysis);
    }

    const body = await req.json().catch(() => null);
    if (!body?.expense_id) {
      return json(400, { error: "expense_id is required" });
    }

    const expense_id = String(body.expense_id);

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // 1. Fetch target expense
    const { data: expense } = await supabase
      .from("expenses")
      .select("*, expense_categories(name), users!user_id(name, org_id)")
      .eq("id", expense_id)
      .single();

    if (!expense) return json(404, { error: "Expense not found" });

    // 2. Submitter's last 10 expenses in same category
    const { data: history } = await supabase
      .from("expenses")
      .select("amount, submitted_at, description, status")
      .eq("user_id", expense.user_id)
      .eq("category_id", expense.category_id)
      .neq("id", expense_id)
      .order("submitted_at", { ascending: false })
      .limit(10);

    const amounts = (history || []).map((e: any) => Number(e.amount));
    const personalAvg =
      amounts.length > 0
        ? amounts.reduce((a: number, b: number) => a + b, 0) / amounts.length
        : null;
    const personalMax = amounts.length > 0 ? Math.max(...amounts) : null;

    // 3. Org average for this category (last 90 days)
    // expenses has no org_id — get org users first, then query their expenses
    const { data: orgUsers } = await supabase
      .from("users")
      .select("id")
      .eq("org_id", expense.users.org_id);
    const orgUserIds = (orgUsers || []).map((u: any) => u.id);

    const { data: orgData } = orgUserIds.length > 0
      ? await supabase
        .from("expenses")
        .select("amount")
        .in("user_id", orgUserIds)
        .eq("category_id", expense.category_id)
        .gte(
          "submitted_at",
          new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
        )
      : { data: [] };

    const orgAmounts = (orgData || []).map((e: any) => Number(e.amount));
    const orgAvg =
      orgAmounts.length > 0
        ? orgAmounts.reduce((a: number, b: number) => a + b, 0) /
        orgAmounts.length
        : null;

    // 4. Duplicate check (same user, amount, category within 7 days)
    const { data: dupes } = await supabase
      .from("expenses")
      .select("id")
      .eq("user_id", expense.user_id)
      .eq("category_id", expense.category_id)
      .eq("amount", expense.amount)
      .neq("id", expense_id)
      .gte(
        "submitted_at",
        new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      );

    const possibleDuplicate = (dupes || []).length > 0;

    // 5. Call Claude
    const prompt = `Analyze this expense for potential issues or anomalies.

Employee: ${expense.users.name}
Category: ${expense.expense_categories.name}
Amount: ${expense.currency} ${expense.amount}
Description: ${expense.description}
Date submitted: ${expense.submitted_at}
${personalAvg ? `Employee's personal average for ${expense.expense_categories.name}: ${expense.currency} ${personalAvg.toFixed(2)}` : "No expense history in this category"}
${personalMax ? `Employee's max in this category: ${expense.currency} ${personalMax}` : ""}
${orgAvg ? `Organization average for ${expense.expense_categories.name}: ${expense.currency} ${orgAvg.toFixed(2)}` : ""}
${possibleDuplicate ? "WARNING: A similar expense (same amount, category) was submitted within the last 7 days." : ""}

Reply with ONLY valid JSON (no markdown, no explanation):
{
  "risk_level": "low" | "medium" | "high",
  "flags": ["flag1", "flag2"],
  "suggestion": "one sentence recommendation for the approver"
}

Risk level guide:
- low: normal expense, nothing unusual
- medium: one concern worth noting (slightly high, weekend, round number)
- high: multiple red flags or possible duplicate

Flags examples (use only what actually applies):
"Amount significantly above personal average"
"Amount significantly above org average"
"Possible duplicate submission"
"Round number amount - possible estimate"
"Submitted on weekend"
"No expense history in this category"
"Very high absolute amount"`;

    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 200,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!claudeRes.ok) {
      console.error("Anthropic API error:", await claudeRes.text());
      return json(200, defaultAnalysis);
    }

    const claudeData = await claudeRes.json();
    const text = claudeData.content?.[0]?.text?.trim() || "{}";
    const clean = text.replace(/```json|```/g, "").trim();

    let analysis = { ...defaultAnalysis };
    try {
      analysis = JSON.parse(clean);
    } catch {
      // Use default
    }

    // 6. Save to expense
    await supabase
      .from("expenses")
      .update({ ai_analysis: analysis })
      .eq("id", expense_id);

    return json(200, analysis);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("analyze-expense error:", message);
    return json(200, defaultAnalysis);
  }
});
