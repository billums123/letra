// Anonymous event pings for the web build.
//
// Answers three questions the launch plan needs and nothing else: did
// a visitor start a round, did they finish a word, and had this
// device played before. Each ping is a fire-and-forget POST to
// /api/ping carrying an event name and a few whitelisted dimensions.
// No identifier goes with it — not a cookie, not a device id, not a
// session. "Had this device played before" is a boolean the app
// already keeps in localStorage, sent as a 0 or a 1.
//
// Off in dev (there is no Pages Function behind vite) and off in the
// mobile build, where the Kids-category privacy label says "data not
// collected" and means it.

import { useGameStore } from "../state/store";

const ENABLED =
  !import.meta.env.DEV && import.meta.env.VITE_TARGET !== "mobile" && typeof navigator !== "undefined";

const LAST_VISIT_KEY = "letra:lastVisit";

type Dims = Record<string, string | number | undefined>;

function send(ev: string, dims: Dims): void {
  if (!ENABLED) return;
  try {
    const params = new URLSearchParams({ ev });
    for (const [k, v] of Object.entries(dims)) {
      if (v === undefined || v === "") continue;
      params.set(k, String(v));
    }
    const url = `/api/ping?${params.toString()}`;
    if (typeof navigator.sendBeacon === "function") {
      navigator.sendBeacon(url);
    } else {
      void fetch(url, { method: "POST", keepalive: true }).catch(() => undefined);
    }
  } catch {
    // A counter must never be able to break the game.
  }
}

function biome(): string {
  try {
    return useGameStore.getState().biomeId;
  } catch {
    return "";
  }
}

// Once per page load. `again` is whether this device has visited
// before; `days` is how long ago, capped at 30 so the value carries
// no more precision than the question needs. `src` is the tag /go
// and /hello attach so ad and bio traffic can be told apart.
export function pingVisit(): void {
  if (!ENABLED) return;
  let last = 0;
  try {
    last = Number(localStorage.getItem(LAST_VISIT_KEY) ?? 0) || 0;
  } catch {
    // localStorage may be unavailable; still worth counting the visit.
  }
  const now = Date.now();
  const days = last ? Math.min(30, Math.round((now - last) / 86_400_000)) : 0;
  let src = "";
  try {
    src = new URLSearchParams(window.location.search).get("src") ?? "";
  } catch {
    /* no query string is fine */
  }
  send("visit", { again: last ? 1 : 0, days, src });
  try {
    localStorage.setItem(LAST_VISIT_KEY, String(now));
  } catch {
    /* ignore */
  }
}

// A round began. `surface` is the engine's surface id (sea, seafloor,
// sun…) so the ocean's pull shows up as its own line.
export function pingRound(game: "spell" | "sound" | "alpha", surface?: string): void {
  send("round", { game, biome: biome(), surface });
}

// A word was finished, a sound matched, or a leg of the alphabet found.
export function pingDone(game: "spell" | "sound" | "alpha"): void {
  send("done", { game, biome: biome() });
}
