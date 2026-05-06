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

// Roll a fresh mood from the supplied pool, avoiding whichever one
// played last for this biome. If the pool has only one entry we just
// return it (no variety possible).
export function rollTimeOfDay(biomeId: string, pool: readonly TimeOfDay[]): TimeOfDay {
  if (pool.length === 0) throw new Error(`rollTimeOfDay: empty pool for ${biomeId}`);
  // Forced override wins when it's a member of this biome's pool.
  if (forcedTOD && pool.includes(forcedTOD)) {
    lastByBiome.set(biomeId, forcedTOD);
    return forcedTOD;
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
