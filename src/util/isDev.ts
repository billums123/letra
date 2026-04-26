// Whether the editor / test pages and other authoring UI should be visible.
//
// "Dev mode" today = Vite's import.meta.env.DEV OR running on a local
// hostname. The hostname check covers cases where someone serves a
// production build via `npm run preview` from their laptop and still
// wants the authoring tools available; the env flag covers `npm run dev`.
//
// In a real production deploy (custom domain, Cloudflare/Vercel/etc.)
// neither check matches, so all dev tooling stays hidden from kids.

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "[::1]"]);

export function isDev(): boolean {
  if (typeof window === "undefined") return false;
  if (import.meta.env?.DEV) return true;
  const host = window.location.hostname;
  if (LOCAL_HOSTS.has(host)) return true;
  // *.local mDNS hostnames (eg. tanner-mbp.local) and .lan, .home, etc.
  if (/\.(local|lan|home|internal)$/i.test(host)) return true;
  return false;
}
