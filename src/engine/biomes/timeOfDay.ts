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

// Roll a fresh mood from the supplied pool, avoiding whichever one
// played last for this biome. If the pool has only one entry we just
// return it (no variety possible).
export function rollTimeOfDay(biomeId: string, pool: readonly TimeOfDay[]): TimeOfDay {
  if (pool.length === 0) throw new Error(`rollTimeOfDay: empty pool for ${biomeId}`);
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
