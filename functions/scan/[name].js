// Cloudflare Pages Function: serves the scan from R2 at /scan/<name>. Pages caps static files at
// 25MB and the scan is ~225MB, so it lives in an R2 bucket (bound as SCANS in wrangler.toml) and
// is streamed from here, on the same origin as the games (no CORS, no rate-limited r2.dev URL).
async function serve({ params, env, request }, withBody) {
  const key = String(params.name);
  if (!/^[\w.-]+$/.test(key)) return new Response("Not found", { status: 404 });
  const head = await env.SCANS.head(key);
  if (!head) return new Response("Not found", { status: 404 });
  const headers = new Headers({
    "content-type": "application/octet-stream",
    "cache-control": "public, max-age=604800",
    etag: head.httpEtag,
  });
  // a returning player's browser already has it
  if (request.headers.get("if-none-match") === head.httpEtag) return new Response(null, { status: 304, headers });
  headers.set("content-length", String(head.size));
  if (!withBody) return new Response(null, { headers });
  const obj = await env.SCANS.get(key);
  if (!obj) return new Response("Not found", { status: 404 });
  return new Response(obj.body, { headers });
}

export const onRequestGet = (ctx) => serve(ctx, true);
export const onRequestHead = (ctx) => serve(ctx, false);
