import type { Biome } from "./types";
import { meadowBiome } from "./meadow";
import { moonBiome } from "./moon";
import { skyBiome } from "./sky";
import { jungleBiome } from "./jungle";
import { oceanBiome } from "./ocean";

// Registry of every available biome. Order here is the order they
// appear in the menu picker.
// Jungle is temporarily unlisted while its look gets more love — the
// biome module stays (the ocean reuses its palm factory, and kids with
// a stored jungle biomeId fall back to the meadow via getBiome).
export const BIOMES: Biome[] = [meadowBiome, moonBiome, skyBiome, oceanBiome];
void jungleBiome;
export type BiomeId = (typeof BIOMES)[number]["id"];

const byId = new Map(BIOMES.map((b) => [b.id, b]));

export function getBiome(id: string | undefined | null): Biome {
  if (id) {
    const found = byId.get(id);
    if (found) return found;
  }
  return meadowBiome;
}

export type { Biome } from "./types";
