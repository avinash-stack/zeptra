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

const textEncoder = new TextEncoder();
const maxReceiptBytes = 10 * 1024 * 1024;

async function hmac(key: Uint8Array | CryptoKey, data: string): Promise<Uint8Array> {
  const cryptoKey = key instanceof CryptoKey
    ? key
    : await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, textEncoder.encode(data));
  return new Uint8Array(signature);
}

async function sha256(data: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", textEncoder.encode(data));
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function toHex(buffer: Uint8Array): string {
  return Array.from(buffer)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function getSignatureKey(
  key: string,
  dateStamp: string,
  regionName: string,
  serviceName: string,
): Promise<Uint8Array> {
  const kSecret = textEncoder.encode("AWS4" + key);
  const kDate = await hmac(kSecret, dateStamp);
  const kRegion = await hmac(kDate, regionName);
  const kService = await hmac(kRegion, serviceName);
  return await hmac(kService, "aws4_request");
}

async function createPresignedGetUrl(
  accessKeyId: string,
  secretAccessKey: string,
  region: string,
  bucket: string,
  key: string,
  expiresInSeconds = 120,
) {
  const method = "GET";
  const service = "s3";
  const host = `${bucket}.s3.${region}.amazonaws.com`;
  const endpoint = `https://${host}/${key}`;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.substring(0, 8);
  const canonicalUri = "/" + key.split("/").map(encodeURIComponent).join("/");
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const credential = encodeURIComponent(`${accessKeyId}/${credentialScope}`);
  const canonicalQuerystring = `X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=${credential}&X-Amz-Date=${amzDate}&X-Amz-Expires=${expiresInSeconds}&X-Amz-SignedHeaders=host`;
  const canonicalHeaders = `host:${host}\n`;
  const canonicalRequest = `${method}\n${canonicalUri}\n${canonicalQuerystring}\n${canonicalHeaders}\nhost\nUNSIGNED-PAYLOAD`;
  const canonicalRequestHash = await sha256(canonicalRequest);
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${credentialScope}\n${canonicalRequestHash}`;
  const signingKey = await getSignatureKey(secretAccessKey, dateStamp, region, service);
  const signature = toHex(await hmac(signingKey, stringToSign));
  return `${endpoint}?${canonicalQuerystring}&X-Amz-Signature=${signature}`;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(i, i + chunkSize));
  }
  return btoa(binary);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const geminiApiKey = Deno.env.get("GEMINI_API_KEY");
    if (!geminiApiKey) {
      console.error("GEMINI_API_KEY not configured");
      return json(500, { error: "OCR provider is not configured" });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const accessKeyId = Deno.env.get("AWS_ACCESS_KEY_ID");
    const secretAccessKey = Deno.env.get("AWS_SECRET_ACCESS_KEY");
    const region = Deno.env.get("AWS_REGION");
    const bucket = Deno.env.get("AWS_S3_BUCKET");
    if (!supabaseUrl || !serviceRoleKey || !accessKeyId || !secretAccessKey || !region || !bucket) {
      return json(500, { error: "Missing OCR storage configuration" });
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

    const { receipt_key } = body as { receipt_key?: string };
    if (!receipt_key) {
      return json(400, { error: "receipt_key is required" });
    }
    if (!receipt_key.startsWith(`receipts/${caller.id}/`)) {
      return json(403, { error: "Receipt does not belong to the authenticated user" });
    }

    // Download the receipt image
    const receiptUrl = await createPresignedGetUrl(
      accessKeyId,
      secretAccessKey,
      region,
      bucket,
      receipt_key,
    );
    const imageRes = await fetch(receiptUrl);
    if (!imageRes.ok) {
      return json(400, { error: "Could not fetch receipt image" });
    }
    const contentLength = Number(imageRes.headers.get("content-length") || "0");
    if (contentLength > maxReceiptBytes) {
      return json(400, { error: "Receipt file exceeds 10MB limit" });
    }

    // Detect MIME type from Content-Type header, fallback to jpeg
    const contentType = imageRes.headers.get("content-type") || "image/jpeg";
    const mimeType = contentType.split(";")[0].trim();

    const imageBuffer = await imageRes.arrayBuffer();
    if (imageBuffer.byteLength > maxReceiptBytes) {
      return json(400, { error: "Receipt file exceeds 10MB limit" });
    }
    const base64Image = arrayBufferToBase64(imageBuffer);

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
      return json(502, { error: "OCR provider failed" });
    }

    const geminiData = await geminiRes.json();
    const rawText =
      geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || "";

    if (!rawText) {
      return json(502, { error: "OCR provider returned no text" });
    }

    // Strip markdown fences if Gemini wraps the JSON
    const cleaned = rawText.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();

    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      console.error("Failed to parse Gemini response:", cleaned.slice(0, 200));
      return json(502, { error: "OCR provider returned malformed data" });
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
    return json(500, { error: "OCR failed" });
  }
});
