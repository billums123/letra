// POST /api/ping?ev=<event>&k=v… — the anonymous counter behind the
// web build's "did a stranger's kid actually play" numbers.
//
// One KV key per event, counted on read by /api/stats. Writing a key
// per event instead of incrementing a counter is deliberate: KV has
// no atomic increment, so two pings landing together would lose one.
// Keys expire after 90 days.
//
// What is stored: the day, the event name, and the whitelisted
// dimensions from the query string. What is NOT stored: the IP, the
// user agent, a cookie, a device id, or anything else from the
// request. There is no way to connect a key to a person or a device,
// which is the whole point — see /privacy.
//
// Setup, once, in the Cloudflare dashboard (Pages project → Settings):
//   Bindings → KV namespace → variable name PINGS → a namespace named
//   LETRA_PINGS. Without the binding this returns 204 and stores
//   nothing, so a missing binding can never break the game.

interface KVLike {
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
}

interface Env {
  PINGS?: KVLike;
}

// Dimensions the client may send. Anything else is dropped.
const ALLOWED = new Set(["game", "biome", "surface", "again", "days", "src"]);
const NINETY_DAYS = 60 * 60 * 24 * 90;

export const onRequestPost = async ({ request, env }: { request: Request; env: Env }) => {
  const url = new URL(request.url);
  const ev = url.searchParams.get("ev") ?? "";
  if (!/^[a-z]{1,12}$/.test(ev)) return new Response(null, { status: 204 });

  const dims: string[] = [];
  for (const [k, v] of url.searchParams) {
    if (!ALLOWED.has(k)) continue;
    const clean = v.replace(/[^a-z0-9_-]/gi, "").slice(0, 24);
    if (clean) dims.push(`${k}=${clean}`);
  }
  dims.sort();

  const day = new Date().toISOString().slice(0, 10);
  const key = `p:${day}:${ev}:${dims.join("&")}:${crypto.randomUUID()}`;
  try {
    await env.PINGS?.put(key, "1", { expirationTtl: NINETY_DAYS });
  } catch {
    // A KV hiccup is not the kid's problem.
  }
  return new Response(null, { status: 204 });
};
