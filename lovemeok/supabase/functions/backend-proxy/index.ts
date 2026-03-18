// backend-proxy v1
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const TARGET_API_URL = Deno.env.get("EXTERNAL_API_URL");
  if (!TARGET_API_URL) {
    return new Response(
      JSON.stringify({ error: "EXTERNAL_API_URL not configured", fn: "backend-proxy" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  console.log("backend-proxy invoked, method:", req.method);

  let rawBody = "";
  try {
    rawBody = await req.text();
  } catch {
    return new Response(
      JSON.stringify({ error: "Cannot read request body" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  console.log("body length:", rawBody.length, "preview:", rawBody.substring(0, 200));

  if (!rawBody || rawBody.trim().length === 0) {
    return new Response(
      JSON.stringify({ error: "Empty request body" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  let endpoint: string;
  let method: string;
  let bodyPayload: unknown;

  try {
    const parsed = JSON.parse(rawBody);
    endpoint = parsed.endpoint || "";
    method = parsed.method || "GET";
    bodyPayload = parsed.body;
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid JSON" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  if (!endpoint || !endpoint.startsWith("/") || endpoint.includes("..")) {
    return new Response(
      JSON.stringify({ error: "Invalid endpoint" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    const init: RequestInit = {
      method,
      headers: { "Content-Type": "application/json", "Bypass-Tunnel-Reminder": "true" },
    };
    if (bodyPayload && method !== "GET" && method !== "HEAD") {
      init.body = JSON.stringify(bodyPayload);
    }

    const targetUrl = `${TARGET_API_URL}${endpoint}`;
    console.log(`Proxy -> ${method} ${targetUrl}`);

    const resp = await fetch(targetUrl, init);
    const text = await resp.text();
    console.log(`Response: ${resp.status}, len=${text.length}`);

    if (!resp.ok) {
      return new Response(
        JSON.stringify({ error: `Upstream ${resp.status}`, details: text }),
        { status: resp.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    try {
      JSON.parse(text);
      return new Response(text, {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch {
      return new Response(
        JSON.stringify({ raw: text }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Fetch error:", msg);
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
