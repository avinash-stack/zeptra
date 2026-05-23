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

/**
 * Extract the largest plausible expense amount from OCR text.
 * Looks for currency symbols followed by decimal numbers, or standalone decimals.
 */
function extractAmount(text: string): string | undefined {
  // Match patterns like $123.45, ₹1,234.56, 1234.00, etc.
  const patterns = [
    /(?:[$₹€£¥])\s*([\d,]+\.?\d{0,2})/g,
    /(?:total|amount|grand\s*total|net|due|payable)[:\s]*(?:[$₹€£¥])?\s*([\d,]+\.\d{2})/gi,
    /(\d{1,3}(?:,\d{3})*\.\d{2})/g,
  ];

  const candidates: number[] = [];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const num = parseFloat(match[1].replace(/,/g, ""));
      if (num > 0 && num < 10_000_000) {
        candidates.push(num);
      }
    }
  }

  if (candidates.length === 0) return undefined;

  // Prefer the amount near "total" keywords — otherwise pick the largest
  const totalMatch = text.match(
    /(?:total|grand\s*total|amount\s*due|net\s*amount|payable)[:\s]*(?:[$₹€£¥])?\s*([\d,]+\.\d{2})/i,
  );
  if (totalMatch) {
    const totalNum = parseFloat(totalMatch[1].replace(/,/g, ""));
    if (totalNum > 0) return totalNum.toFixed(2);
  }

  // Fallback: largest plausible amount
  const sorted = candidates.sort((a, b) => b - a);
  return sorted[0].toFixed(2);
}

/**
 * Extract a date from OCR text. Returns YYYY-MM-DD or undefined.
 */
function extractDate(text: string): string | undefined {
  // Common date formats
  const patterns: [RegExp, (m: RegExpMatchArray) => string | null][] = [
    // DD/MM/YYYY or DD-MM-YYYY
    [
      /(\d{1,2})[\/\-](\d{1,2})[\/\-](20\d{2})/,
      (m) => {
        const d = parseInt(m[1]), mo = parseInt(m[2]), y = parseInt(m[3]);
        if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
          return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        }
        return null;
      },
    ],
    // YYYY-MM-DD (ISO)
    [
      /(20\d{2})-(\d{1,2})-(\d{1,2})/,
      (m) => {
        const y = parseInt(m[1]), mo = parseInt(m[2]), d = parseInt(m[3]);
        if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
          return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        }
        return null;
      },
    ],
    // Month DD, YYYY (e.g., "Jan 15, 2025")
    [
      /(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2}),?\s+(20\d{2})/i,
      (m) => {
        const months: Record<string, string> = {
          jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
          jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
        };
        const monthStr = m[0].slice(0, 3).toLowerCase();
        const mo = months[monthStr];
        if (!mo) return null;
        const d = parseInt(m[1]), y = parseInt(m[2]);
        if (d >= 1 && d <= 31) {
          return `${y}-${mo}-${String(d).padStart(2, "0")}`;
        }
        return null;
      },
    ],
    // DD Month YYYY (e.g., "15 January 2025")
    [
      /(\d{1,2})\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(20\d{2})/i,
      (m) => {
        const months: Record<string, string> = {
          jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
          jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
        };
        const monthMatch = m[0].match(/(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i);
        if (!monthMatch) return null;
        const mo = months[monthMatch[0].slice(0, 3).toLowerCase()];
        if (!mo) return null;
        const d = parseInt(m[1]), y = parseInt(m[2]);
        if (d >= 1 && d <= 31) {
          return `${y}-${mo}-${String(d).padStart(2, "0")}`;
        }
        return null;
      },
    ],
  ];

  for (const [regex, parser] of patterns) {
    const match = text.match(regex);
    if (match) {
      const result = parser(match);
      if (result) return result;
    }
  }
  return undefined;
}

/**
 * Extract vendor/merchant name from OCR text.
 * Typically the first prominent line of a receipt.
 */
function extractVendor(text: string): string | undefined {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 2 && l.length < 60);

  // Skip lines that look like dates, amounts, or addresses
  const skipPatterns = [
    /^\d+[\/\-]/,
    /^[$₹€£¥]/,
    /^\d+\.\d{2}$/,
    /^tel|^phone|^fax|^email|^www|^http/i,
    /^\d+\s+(street|st|ave|road|rd|blvd)/i,
    /^invoice|^receipt|^bill|^tax/i,
  ];

  for (const line of lines.slice(0, 5)) {
    if (skipPatterns.some((p) => p.test(line))) continue;
    // Return the first non-skipped prominent line
    return line;
  }
  return undefined;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const visionApiKey = Deno.env.get("GOOGLE_VISION_API_KEY");
    if (!visionApiKey) {
      return json(500, { error: "GOOGLE_VISION_API_KEY not configured" });
    }

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

    const imageBuffer = await imageRes.arrayBuffer();
    const base64Image = btoa(
      String.fromCharCode(...new Uint8Array(imageBuffer)),
    );

    // Call Google Cloud Vision API
    const visionRes = await fetch(
      `https://vision.googleapis.com/v1/images:annotate?key=${visionApiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requests: [
            {
              image: { content: base64Image },
              features: [{ type: "DOCUMENT_TEXT_DETECTION", maxResults: 1 }],
            },
          ],
        }),
      },
    );

    const visionData = await visionRes.json();

    if (!visionRes.ok) {
      console.error("Vision API error:", visionData);
      // Return empty result — don't break the flow
      return json(200, {});
    }

    const fullText =
      visionData?.responses?.[0]?.fullTextAnnotation?.text || "";

    if (!fullText) {
      // No text detected — return empty
      return json(200, {});
    }

    // Parse fields from OCR text
    const amount = extractAmount(fullText);
    const date = extractDate(fullText);
    const vendor = extractVendor(fullText);
    const suggested_description = vendor
      ? `${vendor}${amount ? ` — expense` : ""}`
      : undefined;

    return json(200, {
      amount,
      date,
      vendor,
      suggested_description,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("ocr-receipt error:", message);
    // Graceful fallback: never throw, return empty
    return json(200, {});
  }
});
