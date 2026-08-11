import type { Biome } from "./types";
import { meadowBiome } from "./meadow";
import { moonBiome } from "./moon";
import { skyBiome } from "./sky";
import { jungleBiome } from "./jungle";
import { oceanBiome } from "./ocean";

// Registry of every available biome. Order here is the order they
// appear in the menu picker.
export const BIOMES: Biome[] = [meadowBiome, moonBiome, skyBiome, jungleBiome, oceanBiome];
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
