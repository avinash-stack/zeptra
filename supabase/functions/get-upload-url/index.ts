import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (status: number, payload: Record<string, unknown>) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const textEncoder = new TextEncoder();
const maxReceiptBytes = 10 * 1024 * 1024;
const allowedMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);

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
  const kSigning = await hmac(kService, "aws4_request");
  return kSigning;
}

async function createPresignedUrl(
  accessKeyId: string,
  secretAccessKey: string,
  region: string,
  bucket: string,
  key: string,
  fileSize: number,
  fileType: string,
  expiresInSeconds = 300,
) {
  const method = "PUT";
  const service = "s3";
  const host = `${bucket}.s3.${region}.amazonaws.com`;
  const endpoint = `https://${host}/${key}`;

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ""); // YYYYMMDDTHHMMSSZ
  const dateStamp = amzDate.substring(0, 8); // YYYYMMDD

  // AWS requires URI encoding of path segments
  const canonicalUri = "/" + key.split("/").map(encodeURIComponent).join("/");
  
  // Query string must be sorted by parameter name
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const credential = encodeURIComponent(`${accessKeyId}/${credentialScope}`);
  const canonicalQuerystring = `X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=${credential}&X-Amz-Date=${amzDate}&X-Amz-Expires=${expiresInSeconds}&X-Amz-SignedHeaders=content-length%3Bcontent-type%3Bhost`;

  const canonicalHeaders = `content-length:${fileSize}\ncontent-type:${fileType}\nhost:${host}\n`;
  const signedHeaders = "content-length;content-type;host";
  const payloadHash = "UNSIGNED-PAYLOAD"; // standard for presigned URLs

  const canonicalRequest = `${method}\n${canonicalUri}\n${canonicalQuerystring}\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;
  const canonicalRequestHash = await sha256(canonicalRequest);

  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${credentialScope}\n${canonicalRequestHash}`;

  const signingKey = await getSignatureKey(secretAccessKey, dateStamp, region, service);
  const signature = toHex(await hmac(signingKey, stringToSign));

  return `${endpoint}?${canonicalQuerystring}&X-Amz-Signature=${signature}`;
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
    const accessKeyId = Deno.env.get("AWS_ACCESS_KEY_ID");
    const secretAccessKey = Deno.env.get("AWS_SECRET_ACCESS_KEY");
    const region = Deno.env.get("AWS_REGION");
    const bucket = Deno.env.get("AWS_S3_BUCKET");

    if (!supabaseUrl || !serviceRoleKey || !accessKeyId || !secretAccessKey || !region || !bucket) {
      console.error("Supabase or AWS configuration missing");
      return json(500, { error: "AWS configuration missing" });
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

    if (body?.action === "get_download_url") {
      const receipt_key = String(body.receipt_key ?? "").trim();
      if (!receipt_key) {
        return json(400, { error: "receipt_key is required" });
      }

      const callerId = authData.user.id;
      let authorized = false;

      // 1. Owner authorization (receipt key format receipts/owner_id/...)
      if (receipt_key.startsWith(`receipts/${callerId}/`)) {
        authorized = true;
      }

      // 2. Non-owner authorization (manager, admin, finance of same org)
      if (!authorized) {
        const [{ data: callerProfile }, { data: callerRoles }] = await Promise.all([
          admin.from("users").select("org_id").eq("id", callerId).single(),
          admin.from("user_roles").select("role").eq("user_id", callerId),
        ]);
        const callerOrgId = callerProfile?.org_id;
        const callerRoleNames = (callerRoles || []).map((r: { role: string }) => r.role);

        const { data: expense } = await admin
          .from("expenses")
          .select("*, users!user_id(org_id)")
          .eq("receipt_url", receipt_key)
          .maybeSingle();

        if (expense) {
          const submitterOrgId = expense.users?.org_id || expense.org_id;
          const isSameOrg = callerOrgId && callerOrgId === submitterOrgId;

          if (isSameOrg) {
            const isCurrentApprover = expense.current_approver_id === callerId;
            const isOrgPrivileged = callerRoleNames.includes("admin") || callerRoleNames.includes("finance");
            
            const { data: directReport } = await admin
              .from("users")
              .select("id")
              .eq("id", expense.user_id)
              .eq("manager_id", callerId)
              .maybeSingle();

            if (isCurrentApprover || isOrgPrivileged || directReport) {
              authorized = true;
            }
          }
        }
      }

      if (!authorized) {
        return json(403, { error: "You are not authorized to access this receipt" });
      }

      const download_url = await createPresignedGetUrl(
        accessKeyId,
        secretAccessKey,
        region,
        bucket,
        receipt_key,
      );

      return json(200, { download_url });
    }

    if (!body?.file_name || !body?.file_type || typeof body?.file_size !== "number") {
      return json(400, { error: "file_name, file_type, and file_size are required" });
    }
    if (!allowedMimeTypes.has(String(body.file_type))) {
      return json(400, { error: "Unsupported receipt file type" });
    }
    if (body.file_size <= 0 || body.file_size > maxReceiptBytes) {
      return json(400, { error: "Receipt file exceeds 10MB limit" });
    }

    const sanitizedFileName = body.file_name.replace(/[^a-zA-Z0-9.-]/g, "_");
    const key = `receipts/${authData.user.id}/${Date.now()}-${sanitizedFileName}`;

    const upload_url = await createPresignedUrl(
      accessKeyId,
      secretAccessKey,
      region,
      bucket,
      key,
      body.file_size,
      String(body.file_type),
    );

    return json(200, { upload_url, receipt_key: key });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("get-upload-url error:", message);
    return json(500, { error: "Failed to generate upload URL" });
  }
});
