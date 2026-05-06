// Per-biome time-of-day variants. Each game mount rolls a fresh mood
// so e.g. the meadow alternates between morning / midday / sunset /
// dusk visits without changing any geometry or gameplay. Lighting,
// sky, and fog are the only knobs touched.
//
// Two design notes:
//   1. Moods are *per biome* — meadow's "dusk" and moon's "deep night"
//      have nothing in common, so each biome owns its own mood table.
//      This module only provides the small machinery for rolling and
//      remembering the last pick so the same mood doesn't fire twice
//      in a row.
//   2. The roller persists the previous mood in module scope only
//      (no localStorage). Refreshing the page rolls fresh, which is
//      fine — the goal is variety within a single sit-down session.

export type TimeOfDay =
  // Meadow moods
  | "morning"
  | "midday"
  | "sunset"
  | "dusk"
  // Moon moods
  | "moon-night"
  | "moon-earthlit"
  // Sky moods
  | "sky-dawn"
  | "sky-noon"
  | "sky-sunset";

const lastByBiome = new Map<string, TimeOfDay>();

const VALID_TODS: TimeOfDay[] = [
  "morning",
  "midday",
  "sunset",
  "dusk",
  "moon-night",
  "moon-earthlit",
  "sky-dawn",
  "sky-noon",
  "sky-sunset",
];

// Read a `?tod=...` query param at module load so the URL still works
// as a one-shot override (e.g. /?tod=sunset). The value is mutable —
// the dev picker can also override it at runtime via setForcedTOD().
// Pools that don't include the forced mood ignore it and roll random.
function readForcedTOD(): TimeOfDay | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const v = params.get("tod");
  if (!v) return null;
  return (VALID_TODS as string[]).includes(v) ? (v as TimeOfDay) : null;
}

let forcedTOD: TimeOfDay | null = readForcedTOD();
const subscribers = new Set<() => void>();

// Most-recent rolled mood per biome, exposed for dev tooling (e.g. the
// HUD's small TOD readout). Returns null if a biome hasn't been mounted
// yet this session.
export function getLastTOD(biomeId: string): TimeOfDay | null {
  return lastByBiome.get(biomeId) ?? null;
}

export function getForcedTOD(): TimeOfDay | null {
  return forcedTOD;
}

// Set a runtime override and notify subscribers (the engine re-applies
// the biome scene in response). Pass null to clear the override and
// return to random rolls. Clears the lastByBiome cache so the next
// roll honours the new override even within the same biome session.
export function setForcedTOD(tod: TimeOfDay | null): void {
  forcedTOD = tod;
  lastByBiome.clear();
  for (const cb of subscribers) cb();
}

// Subscribe to forced-TOD changes. Returns an unsubscribe function.
// The engine subscribes once per mount so a runtime override triggers
// a scene re-apply.
export function subscribeForcedTOD(cb: () => void): () => void {
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
}

// Map the player's local clock to a mood inside the supplied pool.
// Each biome's pool contains a different set of moods, so we branch
// on what the pool actually offers. Returns null if none of the
// pool's members fit any time-band — the caller falls back to random
// in that case.
//
// Hour bands are intentionally generous: a kid playing at 8am should
// get "morning"; the same kid at 9pm should get "dusk" even though
// it's technically dark out. The bands cover the wraparound to
// overnight by treating evening as the "until 5am" catch-all.
function realTimeTOD(pool: readonly TimeOfDay[]): TimeOfDay | null {
  const hour = new Date().getHours();
  // Meadow pool: morning / midday / sunset / dusk.
  if (pool.includes("morning") || pool.includes("midday")) {
    if (hour >= 5 && hour < 10) return inPool("morning", pool);
    if (hour >= 10 && hour < 16) return inPool("midday", pool);
    if (hour >= 16 && hour < 19) return inPool("sunset", pool);
    return inPool("dusk", pool); // 19:00 – 04:59 (overnight)
  }
  // Moon pool: night vs. earthlit.
  if (pool.includes("moon-night") || pool.includes("moon-earthlit")) {
    if (hour >= 6 && hour < 18) return inPool("moon-earthlit", pool);
    return inPool("moon-night", pool);
  }
  // Sky pool: dawn / noon / sunset. Overnight folds into sunset since
  // it shares the warmer/dimmer palette.
  if (pool.includes("sky-dawn") || pool.includes("sky-noon")) {
    if (hour >= 5 && hour < 10) return inPool("sky-dawn", pool);
    if (hour >= 10 && hour < 16) return inPool("sky-noon", pool);
    return inPool("sky-sunset", pool); // 16:00 – 04:59
  }
  return null;
}

function inPool(t: TimeOfDay, pool: readonly TimeOfDay[]): TimeOfDay | null {
  return pool.includes(t) ? t : null;
}

// Pick a mood for this biome. Order of precedence:
//   1. Dev override (URL ?tod=… or the live picker)
//   2. The player's local time of day
//   3. Random with no-repeat (only used if the pool somehow has no
//      time-band coverage — defensive)
export function rollTimeOfDay(biomeId: string, pool: readonly TimeOfDay[]): TimeOfDay {
  if (pool.length === 0) throw new Error(`rollTimeOfDay: empty pool for ${biomeId}`);
  if (forcedTOD && pool.includes(forcedTOD)) {
    lastByBiome.set(biomeId, forcedTOD);
    return forcedTOD;
  }
  const realTime = realTimeTOD(pool);
  if (realTime) {
    lastByBiome.set(biomeId, realTime);
    return realTime;
  }
  if (pool.length === 1) {
    lastByBiome.set(biomeId, pool[0]);
    return pool[0];
  }
  const prev = lastByBiome.get(biomeId);
  const candidates = prev ? pool.filter((m) => m !== prev) : pool;
  const choice = candidates[Math.floor(Math.random() * candidates.length)];
  lastByBiome.set(biomeId, choice);
  return choice;
}
