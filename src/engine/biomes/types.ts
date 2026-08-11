import * as THREE from "three";
import type { Obstacle } from "../world";

// A biome is a complete environmental theme — sky / lighting / ground /
// scenery — that the engine can swap between without touching anything
// game-side. Each biome owns its own props and visual treatment so two
// biomes can look totally different (meadow vs. moon, etc.).

export type BiomeContext = {
  // The root group every prop should be added to.
  group: THREE.Group;
  // Push obstacles here for the engine's collision pass.
  obstacles: Obstacle[];
  // Push per-frame update callbacks here (drifting clouds, water
  // shimmer, etc). Engine wires them into its actor list.
  tick: Array<(dt: number, t: number) => void>;
  // Biomes should respect this when placing scenery so nothing
  // straddles the boundary clamp.
  worldRadius: number;
  // Per-call PRNG so each session shuffles. Biomes can seed their own
  // sub-rngs from this if they want to layer prop pools.
  random: () => number;
  // Live read of the player's world position. Returns null until the
  // engine finishes wiring the avatar (very early frames) or after
  // teardown. Biomes should null-check before reading. Used by props
  // that react to the player — e.g. moon aliens waving when bumped.
  getPlayerPosition: () => THREE.Vector3 | null;
  // Biomes that deform the ground (e.g. moon craters) call this with
  // a sampler so the engine can drop the avatar into terrain
  // depressions instead of hovering over them. Sampler returns the
  // ground Y at the supplied (x, z); 0 means flat ground.
  setTerrainHeight: (sampler: (x: number, z: number) => number) => void;
  // Biomes whose walkable surface is non-contiguous (e.g. sky islands
  // separated by void) call this to register a predicate. Games
  // consult it via `pickClearSpawn`'s walkable filter so letters /
  // props don't end up floating in the void between surfaces. Returns
  // true if (x, z) is somewhere the avatar can stand.
  setWalkable: (predicate: (x: number, z: number) => boolean) => void;
  // Optional override for where the end-of-game dance celebration
  // should anchor. Defaults to the player's current position; biomes
  // with a designated "main square" (e.g. sky islands' central island)
  // can register an explicit XZ so the player gets teleported there
  // and the ring of dancing letters fits in a known, large-enough
  // walkable area. ringRadius optionally tightens the letter ring for
  // small dance floors.
  setCelebrationCenter: (center: { x: number; z: number; ringRadius?: number }) => void;
  // Fling the avatar on a ballistic arc to (x, z). While airborne the
  // engine suspends input, collision, and terrain-follow, tumbles the
  // avatar, and keeps the camera tracking the flight; control returns
  // on touchdown. Biomes use this for launch gags (the jungle volcano
  // eruption). No-op if a flight is already in progress. onLand fires
  // the frame the avatar touches down.
  launchPlayer: (
    to: { x: number; z: number },
    opts?: { duration?: number; peakY?: number; onLand?: () => void }
  ) => void;
};

export type Biome = {
  id: string;
  label: string;
  emoji: string;
  // Suggested avatar for this biome — used by the picker so e.g. the
  // moon defaults to the rocket. Players can still override.
  recommendedAvatar?: "kid" | "car" | "rocket";
  // Apply this biome's background colour, fog, lights to the scene.
  // Returns a dispose function the engine calls on teardown so biome-
  // owned lights can be removed cleanly.
  applyScene: (scene: THREE.Scene) => () => void;
  // Build the biome's world props (ground, scenery, etc).
  buildProps: (ctx: BiomeContext) => void;
};
