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
      return json(500, { error: "Missing Supabase configuration" });
    }
    if (!anthropicKey) {
      console.error("ANTHROPIC_API_KEY not configured");
      return json(500, { error: "AI provider is not configured" });
    }

    const body = await req.json().catch(() => null);
    if (!body?.expense_id) {
      return json(400, { error: "expense_id is required" });
    }

    const expense_id = String(body.expense_id);

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: authData, error: authError } = await supabase.auth.getUser(token);
    if (authError || !authData.user) {
      return json(401, { error: "Invalid auth token" });
    }
    const callerId = authData.user.id;

    // 1. Fetch target expense
    const { data: expense } = await supabase
      .from("expenses")
      .select("*, expense_categories(name), users!user_id(name, org_id)")
      .eq("id", expense_id)
      .single();

    if (!expense) return json(404, { error: "Expense not found" });

    const orgId = expense.org_id || expense.users?.org_id;
    if (!orgId) {
      return json(500, { error: "Expense is missing organization scope" });
    }

    const [{ data: callerProfile }, { data: callerRoles }] = await Promise.all([
      supabase.from("users").select("org_id").eq("id", callerId).single(),
      supabase.from("user_roles").select("role").eq("user_id", callerId),
    ]);
    const roleNames = (callerRoles || []).map((r: { role: string }) => r.role);
    const isOrgPrivileged = callerProfile?.org_id === orgId &&
      (roleNames.includes("admin") || roleNames.includes("finance"));
    const isSubmitter = expense.user_id === callerId;
    const isCurrentApprover = expense.current_approver_id === callerId;
    const { data: directReport } = await supabase
      .from("users")
      .select("id")
      .eq("id", expense.user_id)
      .eq("manager_id", callerId)
      .maybeSingle();

    if (!isSubmitter && !isCurrentApprover && !isOrgPrivileged && !directReport) {
      return json(403, { error: "You are not allowed to analyze this expense" });
    }

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
    const { data: orgData } = await supabase
      .from("expenses")
      .select("amount")
      .eq("org_id", orgId)
      .eq("category_id", expense.category_id)
      .gte(
        "submitted_at",
        new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
      )
      .limit(500);

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

    let text = "{}";
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

    if (claudeRes.ok) {
      const claudeData = await claudeRes.json();
      text = claudeData.content?.[0]?.text?.trim() || "{}";
    } else {
      console.warn("Anthropic API failed, falling back to Gemini:", await claudeRes.text());
      const geminiKey = Deno.env.get("GEMINI_API_KEY");
      if (!geminiKey) {
         return json(502, { error: "AI provider failed and no fallback configured" });
      }
      const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 200, responseMimeType: "application/json" }
        })
      });
      if (!geminiRes.ok) {
         console.error("Gemini fallback failed:", await geminiRes.text());
         return json(502, { error: "All AI providers failed" });
      }
      const geminiData = await geminiRes.json();
      text = geminiData.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "{}";
    }

    const clean = text.replace(/```json|```/g, "").trim();

    let analysis = { ...defaultAnalysis };
    try {
      const parsed = JSON.parse(clean);
      analysis = {
        risk_level: ["low", "medium", "high"].includes(parsed?.risk_level)
          ? parsed.risk_level
          : "low",
        flags: Array.isArray(parsed?.flags)
          ? parsed.flags.filter((f: unknown) => typeof f === "string")
          : [],
        suggestion: typeof parsed?.suggestion === "string"
          ? parsed.suggestion.slice(0, 200)
          : "",
      };
    } catch {
      // Use default
    }

    // 6. Save to expense
    await supabase
      .from("expenses")
      .update({ ai_analysis: analysis })
      .eq("id", expense_id)
      .eq("org_id", orgId);

    return json(200, analysis);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("analyze-expense error:", message);
    return json(500, { error: "Failed to analyze expense" });
  }
});
