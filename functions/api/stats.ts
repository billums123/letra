// GET /api/stats?key=<STATS_KEY>&days=14
//
// Counts the keys /api/ping wrote, one JSON object per day:
//   { "2026-09-21": { "visit?again=0&src=ad": 41, "round?biome=ocean&game=spell&surface=sea": 12, … } }
//
// Guarded by STATS_KEY, an environment variable you set on the Pages
// project (Settings → Variables). Nothing here identifies anyone;
// the key just keeps the raw totals off the open internet.

interface KVLike {
  list(opts: { prefix: string; cursor?: string; limit?: number }): Promise<{
    keys: { name: string }[];
    list_complete: boolean;
    cursor?: string;
  }>;
}

interface Env {
  PINGS?: KVLike;
  STATS_KEY?: string;
}

export const onRequestGet = async ({ request, env }: { request: Request; env: Env }) => {
  const url = new URL(request.url);
  if (!env.STATS_KEY || url.searchParams.get("key") !== env.STATS_KEY) {
    return new Response("Not found", { status: 404 });
  }
  if (!env.PINGS) return Response.json({ error: "PINGS binding missing" }, { status: 500 });

  const days = Math.min(60, Math.max(1, Number(url.searchParams.get("days") ?? 14) || 14));
  const out: Record<string, Record<string, number>> = {};

  for (let i = 0; i < days; i++) {
    const day = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
    const counts: Record<string, number> = {};
    let cursor: string | undefined;
    do {
      const page = await env.PINGS.list({ prefix: `p:${day}:`, cursor, limit: 1000 });
      for (const k of page.keys) {
        // p:<day>:<ev>:<dims>:<uuid>
        const [, , ev, dims] = k.name.split(":");
        const label = dims ? `${ev}?${dims}` : ev;
        counts[label] = (counts[label] ?? 0) + 1;
      }
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
    if (Object.keys(counts).length) out[day] = counts;
  }
  return Response.json(out);
};
