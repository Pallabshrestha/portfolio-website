/**
 * CORS relay for NVIDIA NIM.
 *
 * NVIDIA's inference endpoint sends no CORS headers, so a browser refuses the
 * request before it is even sent. This Worker is the one hop that fixes that:
 * it forwards the request unchanged and adds the headers NVIDIA omits.
 *
 * It deliberately holds no API key. The caller's own key is forwarded from the
 * Authorization header and never logged or stored, so deploying this does not
 * put a secret of yours on the internet, and a stranger who finds the URL still
 * needs their own NVIDIA key to get anything out of it.
 *
 * Deploy:
 *   npm install -g wrangler
 *   wrangler login
 *   wrangler deploy
 * Then paste the printed https://...workers.dev URL into PostBoost's "Relay URL".
 */

const ALLOWED_ORIGINS = [
  "https://www.pallabshrestha.com.np",
  "https://pallabshrestha.com.np"
];
const UPSTREAM = "https://integrate.api.nvidia.com/v1/chat/completions";
const MAX_BODY_BYTES = 2 * 1024 * 1024;   // images are already capped client-side

export default {
  async fetch(request) {
    const origin = request.headers.get("Origin") || "";
    const allowed = ALLOWED_ORIGINS.includes(origin);
    const cors = {
      "Access-Control-Allow-Origin": allowed ? origin : ALLOWED_ORIGINS[0],
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, Accept",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin"
    };

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "POST") return json({ error: "This relay accepts POST only." }, 405, cors);

    // Origin checking stops casual reuse from other websites. It is not real
    // authentication - anything that is not a browser can claim any origin -
    // which is why the relay never holds a key of its own.
    if (!allowed) return json({ error: "Origin not allowed." }, 403, cors);

    const auth = request.headers.get("Authorization") || "";
    if (!/^Bearer\s+nvapi-/.test(auth)) {
      return json({ error: "Missing or malformed NVIDIA key. Send Authorization: Bearer nvapi-..." }, 401, cors);
    }

    const body = await request.text();
    if (body.length > MAX_BODY_BYTES) return json({ error: "Payload too large." }, 413, cors);

    let upstream;
    try {
      upstream = await fetch(UPSTREAM, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json", "Authorization": auth },
        body
      });
    } catch (e) {
      return json({ error: "Could not reach NVIDIA: " + e.message }, 502, cors);
    }

    // Pass the upstream status through untouched so the page can tell a bad key
    // (401) from exhausted credits (429) from a real outage (5xx).
    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: { ...cors, "Content-Type": "application/json" }
    });
  }
};

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json" } });
}
