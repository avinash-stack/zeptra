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
    const geminiApiKey = Deno.env.get("GEMINI_API_KEY");
    if (!geminiApiKey) {
      console.error("GEMINI_API_KEY not configured");
      return json(200, {});
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      return json(500, { error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in function environment" });
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json(401, { error: "Missing bearer token" });
    }
    const token = authHeader.replace("Bearer ", "");

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: { user: caller }, error: authErr } = await admin.auth.getUser(token);
    if (authErr || !caller) return json(401, { error: 'Invalid token' });

    const body = await req.json().catch(() => null);
    if (!body) {
      return json(400, { error: "Invalid request payload" });
    }

    const { receipt_url } = body as { receipt_url?: string };
    if (!receipt_url) {
      return json(400, { error: "receipt_url is required" });
    }

    // Download the receipt image
    const imageRes = await fetch(receipt_url);
    if (!imageRes.ok) {
      return json(400, { error: "Could not fetch receipt image" });
    }

    // Detect MIME type from Content-Type header, fallback to jpeg
    const contentType = imageRes.headers.get("content-type") || "image/jpeg";
    const mimeType = contentType.split(";")[0].trim();

    const imageBuffer = await imageRes.arrayBuffer();
    const base64Image = btoa(
      String.fromCharCode(...new Uint8Array(imageBuffer)),
    );

    // Call Gemini API with structured extraction prompt
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiApiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  inlineData: {
                    mimeType,
                    data: base64Image,
                  },
                },
                {
                  text: `You are an expert at reading Indian business receipts and invoices. Extract structured data from this receipt image.

Return ONLY valid JSON, no markdown, no explanation:
{
  "amount": number or null (the final payable amount, excluding nothing),
  "date": "YYYY-MM-DD" or null (parse DD/MM/YYYY Indian format — month is second segment),
  "vendor": "string" or null (business name at top of receipt),
  "currency": "INR" (default) or detected currency code,
  "suggested_description": "string" (vendor name + brief context, e.g. "Swiggy — team lunch"),
  "gst_number": "string" or null (15-character GSTIN if present),
  "hsn_codes": [{"code": "string", "description": "string", "amount": number}] or [],
  "cgst": number or null,
  "sgst": number or null,
  "igst": number or null,
  "total_gst_amount": number or null
}

Rules:
- amount should be the "Grand Total" or "Total Payable" figure
- If GSTIN is present, it is 15 characters: 2-digit state code + 10-char PAN + 1 entity + 1 checksum
- If you see CGST + SGST, igst should be null (intra-state transaction)
- If you see IGST, cgst and sgst should be null (inter-state transaction)
- Return null for any field you cannot find with confidence`,
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 1024,
          },
        }),
      },
    );

    if (!geminiRes.ok) {
      console.error("Gemini API error:", await geminiRes.text());
      return json(200, {});
    }

    const geminiData = await geminiRes.json();
    const rawText =
      geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || "";

    if (!rawText) {
      return json(200, {});
    }

    // Strip markdown fences if Gemini wraps the JSON
    const cleaned = rawText.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();

    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      console.error("Failed to parse Gemini response:", cleaned.slice(0, 200));
      return json(200, {});
    }

    // Return the structured result — only include fields that have values
    return json(200, {
      amount: parsed.amount ?? null,
      date: parsed.date ?? null,
      vendor: parsed.vendor ?? null,
      currency: parsed.currency ?? "INR",
      suggested_description: parsed.suggested_description ?? null,
      gst_number: parsed.gst_number ?? null,
      hsn_codes: Array.isArray(parsed.hsn_codes) ? parsed.hsn_codes : [],
      cgst: parsed.cgst ?? null,
      sgst: parsed.sgst ?? null,
      igst: parsed.igst ?? null,
      total_gst_amount: parsed.total_gst_amount ?? null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("ocr-receipt error:", message);
    // Graceful fallback: never throw, return empty
    return json(200, {});
  }
});
