import * as THREE from "three";
import type { Biome, BiomeContext } from "./biomes/types";

// Deterministic pseudo-random — fed a different seed each session so the
// world layout shuffles on every reload.
export function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Random uint seed for a new mulberry32 instance. Each prop pool gets
// its own seed so changing the count of one (e.g. trees) doesn't ripple
// into the placement of another (e.g. mushrooms).
export function freshSeed(): number {
  return (Math.random() * 0xffffffff) | 0;
}

export const WORLD_RADIUS = 50;

// An obstacle the player and letters should avoid. We model every world
// prop as a vertical cylinder (good enough for the round-ish shapes we
// have: hills, trees, mushrooms). Only objects within the play zone end
// up in this list — the distant skirt and ground itself are excluded
// because nothing collides with them. onBump fires on the rising edge
// of a player collision so the prop can react (e.g. a tree shaking).
export type Obstacle = {
  x: number;
  z: number;
  radius: number;
  onBump?: (intensity: number) => void;
  // When false, the obstacle doesn't push the player out — it just
  // fires onBump while overlapping. Used for soft props like flowers
  // that should wiggle when driven over but never block the kid.
  solid?: boolean;
};

export type WorldHandles = {
  group: THREE.Group;
  worldRadius: number;
  obstacles: Obstacle[];
  // Per-frame animations (drifting butterflies, water shimmer, tree
  // shake decay, etc.). The Engine wires each of these into its actor
  // list.
  tick: Array<(dt: number, t: number) => void>;
};

// Tries up to maxAttempts random spots inside scatterRadius (ring with
// optional minRadius hole) until one is clear of every prop already in
// `obstacles` and `taken`. Returns null if nothing fits — caller can
// just skip that prop. Stops the world from generating overlapping
// trees, mushrooms, boulders, etc.
export function findOpenSpot(
  rand: () => number,
  scatterRadius: number,
  selfRadius: number,
  obstacles: Obstacle[],
  options: { minRadius?: number; pad?: number; maxAttempts?: number } = {}
): { x: number; z: number } | null {
  const { minRadius = 0, pad = 0.4, maxAttempts = 40 } = options;
  for (let i = 0; i < maxAttempts; i++) {
    const x = (rand() - 0.5) * scatterRadius * 2;
    const z = (rand() - 0.5) * scatterRadius * 2;
    const d = Math.hypot(x, z);
    if (d > scatterRadius || d < minRadius) continue;
    let clear = true;
    for (const o of obstacles) {
      if (Math.hypot(x - o.x, z - o.z) < o.radius + selfRadius + pad) {
        clear = false;
        break;
      }
    }
    if (clear) return { x, z };
  }
  return null;
}

// Builds the world for the supplied biome. The biome owns its props
// (ground, scenery, sky-furniture); buildWorld is the dispatcher that
// hands the biome a context to populate. Engine adds the resulting
// group to the scene and wires the tick callbacks into its actor loop.
export type WorldBuildResult = WorldHandles & {
  // Biomes that deform the ground register a sampler via
  // ctx.setTerrainHeight; we expose it back to the engine here so it
  // can offset the avatar's Y each frame to follow the surface.
  terrainHeight: ((x: number, z: number) => number) | null;
  // Biomes with non-contiguous walkable surfaces register a predicate
  // via ctx.setWalkable; pickClearSpawn consults it so letters spawn
  // only on islands / paths instead of in the void.
  isWalkable: ((x: number, z: number) => boolean) | null;
  // Optional override for the end-of-game dance celebration anchor.
  // When set, games should teleport the player there and arrange
  // letters around it instead of around the player's last position.
  celebrationCenter: { x: number; z: number; ringRadius?: number } | null;
};

export function buildWorld(
  biome: Biome,
  getPlayerPosition: () => THREE.Vector3 | null = () => null
): WorldBuildResult {
  const group = new THREE.Group();
  group.name = `World:${biome.id}`;
  const obstacles: Obstacle[] = [];
  const tick: Array<(dt: number, t: number) => void> = [];
  let terrainHeight: ((x: number, z: number) => number) | null = null;
  let isWalkable: ((x: number, z: number) => boolean) | null = null;
  let celebrationCenter: { x: number; z: number; ringRadius?: number } | null = null;
  const ctx: BiomeContext = {
    group,
    obstacles,
    tick,
    worldRadius: WORLD_RADIUS,
    random: Math.random,
    getPlayerPosition,
    setTerrainHeight: (fn) => {
      terrainHeight = fn;
    },
    setWalkable: (fn) => {
      isWalkable = fn;
    },
    setCelebrationCenter: (c) => {
      celebrationCenter = c;
    },
  };
  biome.buildProps(ctx);
  return { group, worldRadius: WORLD_RADIUS, obstacles, tick, terrainHeight, isWalkable, celebrationCenter };
}

// The original meadow content is now the body of `buildMeadow` so it
// can be referenced from the biome registry. Keeping it inline here
// rather than splitting into another file because the prop factories
// it uses already live in this module.
export function buildMeadow(ctx: BiomeContext): void {
  const { group, obstacles, tick, worldRadius } = ctx;

  // Ground — large green disc
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(worldRadius + 30, 64),
    new THREE.MeshStandardMaterial({ color: 0x86d36a, roughness: 1 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);

  // Distant skirt — smaller darker disc behind for depth
  const skirt = new THREE.Mesh(
    new THREE.RingGeometry(worldRadius + 30, worldRadius + 80, 48),
    new THREE.MeshStandardMaterial({ color: 0x6db854, roughness: 1, side: THREE.DoubleSide })
  );
  skirt.rotation.x = -Math.PI / 2;
  skirt.position.y = -0.05;
  skirt.receiveShadow = true;
  group.add(skirt);

  // (No perimeter ring of boulders — the world clamp + green disc
  // alone form the edge. Earlier versions ringed the play area in
  // boulders, which read as a fence around the meadow.)

  // ── Pond ────────────────────────────────────────────────────────────────
  // Off-centre lily pond with a fountain. Always lives at a fixed
  // anchor so the kid can use it as a landmark.
  const pond = makePond();
  const pondPos = { x: 14, z: -16 };
  pond.group.position.set(pondPos.x, 0, pondPos.z);
  group.add(pond.group);
  obstacles.push({ x: pondPos.x, z: pondPos.z, radius: pond.radius });
  tick.push(pond.tick);

  // Hills — soft spheres in the distance. We push them fully outside
  // the play area (inner edge ≥ WORLD_RADIUS + 4) so the kid can't
  // bump up against them at all and props don't need to spawn-check
  // around them. Sample box is enlarged to give the rejection filter
  // enough viable positions for the bigger hills.
  const hillRand = mulberry32(freshSeed());
  let hillsPlaced = 0;
  let hillAttempts = 0;
  while (hillsPlaced < 18 && hillAttempts < 240) {
    hillAttempts++;
    const r = 8 + hillRand() * 14;
    const x = (hillRand() - 0.5) * 200;
    const z = (hillRand() - 0.5) * 200;
    // Require the hill's INNER edge to sit beyond the play area.
    // Math.hypot − r is the closest the hill's visible mass gets to
    // the origin; we want that to clear WORLD_RADIUS by a small pad.
    if (Math.hypot(x, z) - r < WORLD_RADIUS + 4) continue;
    const hue = 95 + hillRand() * 35;
    const hill = new THREE.Mesh(
      new THREE.SphereGeometry(r, 16, 12),
      new THREE.MeshStandardMaterial({ color: new THREE.Color(`hsl(${hue}, 55%, 55%)`), roughness: 0.95 })
    );
    hill.position.set(x, r * 0.3 - 0.5, z);
    hill.castShadow = false;
    hill.receiveShadow = true;
    group.add(hill);
    hillsPlaced++;
  }

  // Trees — packed inside the boundary ring. Each one wraps its foliage
  // in a pivoting sub-group so a player bump can shake just the leaves
  // without uprooting the trunk.
  const treeRand = mulberry32(freshSeed());
  for (let i = 0; i < 26; i++) {
    const scale = 0.9 + treeRand() * 0.7;
    const radius = 1.4 * scale;
    const spot = findOpenSpot(treeRand, worldRadius - 4, radius, obstacles, { minRadius: 8 });
    if (!spot) continue;
    const hue = 100 + treeRand() * 40;
    const tree = makeTree(hue, scale);
    tree.group.position.set(spot.x, 0, spot.z);
    tree.group.rotation.y = treeRand() * Math.PI * 2;
    group.add(tree.group);
    obstacles.push({ x: spot.x, z: spot.z, radius, onBump: tree.shake });
    tick.push(tree.update);
  }

  // Mushrooms — wiggle like trees when a kid bumps into them.
  const mushRand = mulberry32(freshSeed());
  for (let i = 0; i < 22; i++) {
    const radius = 0.7;
    const spot = findOpenSpot(mushRand, worldRadius - 4, radius, obstacles, { minRadius: 6 });
    if (!spot) continue;
    const hue = mushRand() * 360;
    const m = makeMushroom(hue);
    m.group.position.set(spot.x, 0, spot.z);
    m.group.rotation.y = mushRand() * Math.PI * 2;
    group.add(m.group);
    obstacles.push({ x: spot.x, z: spot.z, radius, onBump: m.shake });
    tick.push(m.update);
  }

  // Boulders — chunky scattered rocks for visual variety + collision.
  // Bumped from 8 to 16 since the perimeter ring of boulders is gone
  // and we want the meadow to still feel populated with rocks.
  const boulderRand = mulberry32(freshSeed());
  for (let i = 0; i < 16; i++) {
    const size = 0.9 + boulderRand() * 0.7;
    const radius = size * 0.8;
    const spot = findOpenSpot(boulderRand, worldRadius - 6, radius, obstacles, { minRadius: 6 });
    if (!spot) continue;
    const hue = (boulderRand() * 360) | 0;
    const b = makeBoulder(size, hue);
    b.position.set(spot.x, 0, spot.z);
    b.rotation.y = boulderRand() * Math.PI * 2;
    group.add(b);
    obstacles.push({ x: spot.x, z: spot.z, radius });
  }

  // Flowers — soft contact: the kid drives right over them (solid:
  // false on the obstacle skips the position push) but the flower
  // head wobbles when bumped, just like trees and mushrooms.
  const flowerRand = mulberry32(freshSeed());
  for (let i = 0; i < 60; i++) {
    const spot = findOpenSpot(flowerRand, worldRadius - 3, 0.3, obstacles, { minRadius: 0, pad: 0.1, maxAttempts: 12 });
    if (!spot) continue;
    const hue = flowerRand() * 360;
    const f = makeFlower(hue);
    f.group.position.set(spot.x, 0, spot.z);
    f.group.rotation.y = flowerRand() * Math.PI * 2;
    group.add(f.group);
    obstacles.push({ x: spot.x, z: spot.z, radius: 0.32, onBump: f.shake, solid: false });
    tick.push(f.update);
  }

  // Butterflies — drift in lazy arcs above the play zone.
  const butterflyRand = mulberry32(freshSeed());
  for (let i = 0; i < 5; i++) {
    const orbitR = 4 + butterflyRand() * 14;
    const cx = (butterflyRand() - 0.5) * 30;
    const cz = (butterflyRand() - 0.5) * 30;
    const speed = 0.4 + butterflyRand() * 0.5;
    const phase = butterflyRand() * Math.PI * 2;
    const baseY = 1.0 + butterflyRand() * 1.5;
    const hue = butterflyRand() * 360;
    const b = makeButterfly(hue);
    group.add(b.group);
    tick.push((_dt, t) => {
      const ang = t * speed + phase;
      b.group.position.x = cx + Math.cos(ang) * orbitR;
      b.group.position.z = cz + Math.sin(ang) * orbitR;
      b.group.position.y = baseY + Math.sin(t * 2 + phase) * 0.4;
      b.group.rotation.y = ang + Math.PI / 2;
      // Flap on Z, not Y — Y was rotating the wings around the
      // butterfly's vertical axis, which read as the wings sliding
      // horizontally instead of flapping up and down.
      const flap = Math.sin(t * 18 + phase) * 0.9;
      b.wingL.rotation.set(0, 0, flap);
      b.wingR.rotation.set(0, 0, -flap);
    });
  }

  // Clouds
  const cloudRand = mulberry32(freshSeed());
  for (let i = 0; i < 11; i++) {
    const x = (cloudRand() - 0.5) * 200;
    const z = (cloudRand() - 0.5) * 200;
    const y = 18 + cloudRand() * 10;
    const scale = 1 + cloudRand() * 1;
    const c = makeCloud();
    c.position.set(x, y, z);
    c.scale.setScalar(scale);
    group.add(c);
  }

  // buildMeadow doesn't need to return anything — its job is to fill
  // ctx.group / .obstacles / .tick. The dispatcher wraps it.
}

// Picks a position within `radius` of (0,0) that's clear of every obstacle
// (and other already-placed letters). Falls back to a random retry up to 60
// times; if it can't find a spot the caller gets a position anyway — better
// to overlap one tree than to fail the whole game.
export function pickClearSpawn(
  obstacles: Obstacle[],
  taken: { x: number; z: number; radius: number }[],
  bounds: { minRadius: number; maxRadius: number },
  selfRadius: number,
  rng: () => number,
  // Optional walkable filter. Biomes with non-contiguous surfaces (e.g.
  // sky islands separated by void) register one via setWalkable; we
  // reject any candidate position the predicate says isn't walkable
  // so letters don't spawn floating between islands.
  isWalkable?: ((x: number, z: number) => boolean) | null
): { x: number; z: number } {
  const { minRadius, maxRadius } = bounds;
  // Cap maxRadius so we don't try to spawn letters past the world edge —
  // the player can't reach them there anyway. Keeps a half-letter buffer
  // inside the boundary boulders.
  const cappedMax = Math.min(maxRadius, WORLD_RADIUS - selfRadius - 2);
  const cappedMin = Math.min(minRadius, cappedMax - 0.1);
  // For non-contiguous biomes the rejection rate is high (most random
  // points fall in the void) — bump the attempt budget so we still
  // find a valid spot most of the time.
  const attemptBudget = isWalkable ? 240 : 60;
  for (let attempt = 0; attempt < attemptBudget; attempt++) {
    const angle = rng() * Math.PI * 2;
    const dist = cappedMin + rng() * (cappedMax - cappedMin);
    const x = Math.cos(angle) * dist;
    const z = Math.sin(angle) * dist;
    if (isWalkable && !isWalkable(x, z)) continue;
    let clear = true;
    for (const o of obstacles) {
      if (Math.hypot(x - o.x, z - o.z) < o.radius + selfRadius + 0.4) {
        clear = false;
        break;
      }
    }
    if (clear) {
      for (const t of taken) {
        if (Math.hypot(x - t.x, z - t.z) < t.radius + selfRadius + 1.2) {
          clear = false;
          break;
        }
      }
    }
    if (clear) return { x, z };
  }
  // Last-resort: place on the inner ring along an angle that hasn't been used.
  const fallbackAngle = rng() * Math.PI * 2;
  return {
    x: Math.cos(fallbackAngle) * cappedMin,
    z: Math.sin(fallbackAngle) * cappedMin,
  };
}

// Returns a tree as { group, shake, update } so the world can wire its
// shake-on-bump animation into the engine's actor loop. Foliage lives in
// its own pivoting sub-group so the trunk stays planted while the leaves
// wobble.
export function makeTree(hue: number, scale: number) {
  const g = new THREE.Group();
  g.scale.setScalar(scale);
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.22, 0.32, 1.4, 8),
    new THREE.MeshStandardMaterial({ color: 0x7a4a22, roughness: 1 })
  );
  trunk.position.y = 0.7;
  trunk.castShadow = true;
  trunk.receiveShadow = true;
  g.add(trunk);

  const foliage = new THREE.Group();
  // Pivot at the top of the trunk so the wobble pivots from there.
  foliage.position.y = 1.4;
  g.add(foliage);

  const leafColor = new THREE.Color(`hsl(${hue}, 60%, 45%)`);
  const leafMat = new THREE.MeshStandardMaterial({ color: leafColor, roughness: 0.9 });
  for (let i = 0; i < 3; i++) {
    const c = new THREE.Mesh(new THREE.ConeGeometry(1.2 - i * 0.3, 1.6 - i * 0.4, 8), leafMat);
    // Original tree-space y was 2.0 + i*0.8; subtract the foliage pivot
    // (1.4) so the leaves end up at the same world heights.
    c.position.y = 0.6 + i * 0.8;
    c.castShadow = true;
    foliage.add(c);
  }

  // Shake state — driven by the per-frame `update`, kicked by `shake`.
  let shakeT = 0; // 0..1, decays linearly over ~0.45s
  let amp = 0;
  return {
    group: g,
    shake: (intensity: number = 1) => {
      // Re-engage on every bump so a kid that's actively pressing into
      // a tree sees continuous shaking, but cap so we don't accumulate.
      shakeT = 1;
      amp = Math.max(amp, Math.min(0.28, 0.18 * intensity + 0.08));
    },
    update: (dt: number, t: number) => {
      if (shakeT <= 0) {
        if (foliage.rotation.x !== 0 || foliage.rotation.z !== 0) {
          foliage.rotation.x = 0;
          foliage.rotation.z = 0;
        }
        return;
      }
      shakeT = Math.max(0, shakeT - dt * 2.2);
      // Two-axis sinusoidal wobble; phase mismatch makes the wobble feel
      // organic instead of metronomic.
      const wobbleZ = Math.sin(t * 28) * amp * shakeT;
      const wobbleX = Math.cos(t * 23) * amp * 0.55 * shakeT;
      foliage.rotation.z = wobbleZ;
      foliage.rotation.x = wobbleX;
      if (shakeT === 0) amp = 0;
    },
  };
}

export function makeMushroom(hue: number) {
  const m = new THREE.Group();
  const stem = new THREE.Mesh(
    new THREE.CylinderGeometry(0.18, 0.22, 0.6, 10),
    new THREE.MeshStandardMaterial({ color: 0xf6f1d6, roughness: 0.8 })
  );
  stem.position.y = 0.3;
  stem.castShadow = true;
  m.add(stem);

  // Cap + spots live in a pivot sub-group anchored at the top of the
  // stem so a player bump tilts the cap (like a tree's foliage)
  // without uprooting the stem.
  const capPivot = new THREE.Group();
  capPivot.position.y = 0.6;
  m.add(capPivot);

  const capMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(`hsl(${hue}, 80%, 55%)`),
    roughness: 0.7,
  });
  // The cap geometry is an OPEN hemisphere (no underside face). With
  // the default FrontSide shadowSide the depth pass sees a hollow
  // shell and casts a thin ring instead of a solid dome shadow.
  // DoubleSide on the shadow pass closes the shell for shadow
  // mapping while keeping the regular render unchanged.
  capMat.shadowSide = THREE.DoubleSide;
  const cap = new THREE.Mesh(
    new THREE.SphereGeometry(0.5, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2),
    capMat
  );
  cap.position.y = 0.15;
  cap.castShadow = true;
  capPivot.add(cap);

  // Spots
  const spotMat = new THREE.MeshStandardMaterial({ color: 0xf6f1d6 });
  for (let i = 0; i < 3; i++) {
    const s = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8), spotMat);
    s.position.set(
      Math.cos(i * 2.3) * 0.28,
      0.25,
      Math.sin(i * 2.3) * 0.28
    );
    capPivot.add(s);
  }

  // Same shake mechanic as makeTree but punchier — bigger amplitude
  // and a slightly longer decay so a kid bumping a mushroom sees a
  // proper boingy wobble.
  let shakeT = 0;
  let amp = 0;
  return {
    group: m,
    shake: (intensity: number = 1) => {
      shakeT = 1;
      amp = Math.max(amp, Math.min(0.85, 0.55 * intensity + 0.25));
    },
    update: (dt: number, t: number) => {
      if (shakeT <= 0) {
        if (capPivot.rotation.x !== 0 || capPivot.rotation.z !== 0) {
          capPivot.rotation.x = 0;
          capPivot.rotation.z = 0;
        }
        return;
      }
      shakeT = Math.max(0, shakeT - dt * 2.4);
      capPivot.rotation.z = Math.sin(t * 36) * amp * shakeT;
      capPivot.rotation.x = Math.cos(t * 31) * amp * 0.6 * shakeT;
      if (shakeT === 0) amp = 0;
    },
  };
}

export function makeCloud() {
  const c = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 });
  const sizes = [
    [0, 0, 0, 1.4],
    [1.3, -0.1, 0, 1.0],
    [-1.2, 0.1, 0.2, 1.1],
    [0.4, 0.2, -0.2, 0.9],
  ];
  for (const [x, y, z, r] of sizes) {
    const s = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 10), mat);
    s.position.set(x, y, z);
    c.add(s);
  }
  return c;
}

// Chunky decorative boulder.
export function makeBoulder(size: number, hue: number) {
  const g = new THREE.Group();
  const baseColor = new THREE.Color(`hsl(${hue}, 18%, 56%)`);
  const mat = new THREE.MeshStandardMaterial({ color: baseColor, roughness: 1 });
  const main = new THREE.Mesh(new THREE.DodecahedronGeometry(size, 0), mat);
  main.position.y = size * 0.45;
  main.castShadow = true;
  main.receiveShadow = true;
  g.add(main);
  const small = new THREE.Mesh(new THREE.DodecahedronGeometry(size * 0.45, 0), mat);
  small.position.set(size * 0.7, size * 0.25, size * 0.2);
  small.rotation.set(0.3, 0.6, 0.1);
  small.castShadow = true;
  g.add(small);
  return g;
}

// Lily pond with a fountain at the centre. The water surface scales in
// and out gently, ripples expand from the fountain, and lily pads bob,
// rotate, and drift around their anchor so the pond reads as alive
// instead of a frozen blue disc.
export function makePond() {
  const group = new THREE.Group();
  const radius = 3.4;

  // Mud rim
  const rim = new THREE.Mesh(
    new THREE.CylinderGeometry(radius + 0.4, radius + 0.6, 0.18, 32),
    new THREE.MeshStandardMaterial({ color: 0x6a4a28, roughness: 1 })
  );
  rim.position.y = 0.05;
  rim.receiveShadow = true;
  group.add(rim);

  // Water — a thin disc raised slightly above the ground.
  const waterMat = new THREE.MeshStandardMaterial({
    color: 0x5cb6e6,
    roughness: 0.4,
    metalness: 0.05,
    emissive: 0x1a4a6a,
    emissiveIntensity: 0.15,
  });
  const water = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, 0.16, 32),
    waterMat
  );
  water.position.y = 0.12;
  water.receiveShadow = true;
  group.add(water);

  // Concentric ripples emanating from the fountain. We allocate a small
  // pool of ring meshes and recycle them by resetting their phase on
  // overflow — cheaper than spawning new geometry every cycle.
  const RIPPLE_COUNT = 3;
  const ripples: { mesh: THREE.Mesh; phase: number; mat: THREE.MeshBasicMaterial }[] = [];
  const rippleGeo = new THREE.RingGeometry(0.35, 0.5, 32);
  for (let i = 0; i < RIPPLE_COUNT; i++) {
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.45,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const r = new THREE.Mesh(rippleGeo, mat);
    r.rotation.x = -Math.PI / 2;
    // Sit fractionally above the water surface so they aren't z-fighting.
    r.position.y = 0.21;
    group.add(r);
    ripples.push({ mesh: r, phase: i / RIPPLE_COUNT, mat });
  }

  // Lily pads — Pac-Man-shaped wedges (CylinderGeometry with thetaLength
  // less than 2π leaves a notch in the side, the way real lily pads
  // have a slit from rim to centre). Each pad gets its own slow rotation
  // and drift around its anchor.
  type Pad = {
    mesh: THREE.Mesh;
    bud?: THREE.Mesh;
    cx: number;
    cz: number;
    bobPhase: number;
    rotSpeed: number;
    driftR: number;
    driftSpeed: number;
    driftPhase: number;
  };
  const pads: Pad[] = [];
  const padMat = new THREE.MeshStandardMaterial({ color: 0x6cbf3a, roughness: 0.8 });
  const padShineMat = new THREE.MeshStandardMaterial({ color: 0x8fd86b, roughness: 0.7, emissive: 0x224811, emissiveIntensity: 0.1 });
  const flowerMat = new THREE.MeshStandardMaterial({ color: 0xffe9f1, roughness: 0.7 });
  for (let i = 0; i < 4; i++) {
    const padR = 0.5 + (i % 2) * 0.08;
    const a = (i / 4) * Math.PI * 2 + 0.3;
    const dist = radius * 0.55;
    // CylinderGeometry signature includes thetaStart + thetaLength on
    // the side panel; leave a 0.5 rad notch for the lily-pad slit.
    const padGeo = new THREE.CylinderGeometry(padR, padR, 0.06, 18, 1, false, 0, Math.PI * 2 - 0.5);
    // Slightly two-tone shading: top is brighter than the underside.
    const pad = new THREE.Mesh(padGeo, i % 2 === 0 ? padMat : padShineMat);
    const cx = Math.cos(a) * dist;
    const cz = Math.sin(a) * dist;
    pad.position.set(cx, 0.21, cz);
    // Rotate so the slit faces a randomized direction.
    pad.rotation.y = a + Math.PI;
    pad.receiveShadow = true;
    group.add(pad);
    let bud: THREE.Mesh | undefined;
    if (i % 2 === 0) {
      bud = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), flowerMat);
      bud.position.set(cx, 0.34, cz);
      group.add(bud);
    }
    pads.push({
      mesh: pad,
      bud,
      cx,
      cz,
      bobPhase: i * 0.7,
      rotSpeed: 0.12 + i * 0.03,
      driftR: 0.06 + (i % 2) * 0.05,
      driftSpeed: 0.4 + i * 0.1,
      driftPhase: i * 1.1,
    });
  }

  // Fountain — stone base with a thin water column and arcing droplets.
  const fountain = new THREE.Group();
  fountain.position.y = 0.18; // sit on the water surface
  group.add(fountain);

  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x8a8076, roughness: 1 });
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.55, 0.7, 0.5, 14),
    stoneMat
  );
  base.position.y = 0.25;
  base.castShadow = true;
  fountain.add(base);
  const bowl = new THREE.Mesh(
    new THREE.CylinderGeometry(0.78, 0.55, 0.18, 18),
    new THREE.MeshStandardMaterial({ color: 0x9c9285, roughness: 0.9 })
  );
  bowl.position.y = 0.6;
  fountain.add(bowl);
  // Inner bowl water — a small inset disc so the fountain reads as
  // collecting water in the bowl before spilling over.
  const innerWater = new THREE.Mesh(
    new THREE.CylinderGeometry(0.5, 0.5, 0.05, 18),
    waterMat
  );
  innerWater.position.y = 0.7;
  fountain.add(innerWater);

  // Spout — a thin emissive water column rising from the bowl. Scales
  // gently so it pulses like a real fountain.
  const spoutMat = new THREE.MeshStandardMaterial({
    color: 0xb8e8ff,
    transparent: true,
    opacity: 0.7,
    emissive: 0x4ab0e8,
    emissiveIntensity: 0.4,
    roughness: 0.4,
  });
  const spout = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.1, 0.55, 10),
    spoutMat
  );
  spout.position.y = 1.0;
  fountain.add(spout);

  // Droplets — small spheres that arc out from the top of the spout.
  // We re-use a fixed pool, animating each one along a continuous
  // parabolic cycle. y = peak * 4 * cycle * (1 - cycle) gives a clean
  // up-and-back arch from cycle ∈ [0, 1].
  const DROPLET_COUNT = 14;
  type Droplet = { mesh: THREE.Mesh; phase: number; angle: number; reach: number; peak: number; speed: number };
  const droplets: Droplet[] = [];
  const dropMat = new THREE.MeshStandardMaterial({
    color: 0xc8eeff,
    emissive: 0x4ab0e8,
    emissiveIntensity: 0.35,
    roughness: 0.5,
  });
  for (let i = 0; i < DROPLET_COUNT; i++) {
    const d = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8), dropMat);
    fountain.add(d);
    droplets.push({
      mesh: d,
      phase: i / DROPLET_COUNT,
      angle: (i / DROPLET_COUNT) * Math.PI * 2,
      reach: 0.55 + (i % 3) * 0.15,
      peak: 0.7 + (i % 4) * 0.18,
      speed: 0.55 + (i % 5) * 0.05,
    });
  }

  return {
    group,
    radius,
    tick: (_dt: number, t: number) => {
      // Lily pads — bob + slow rotation + small drift around anchor.
      for (const p of pads) {
        const bob = Math.sin(t * 1.4 + p.bobPhase) * 0.02;
        const dx = Math.cos(t * p.driftSpeed + p.driftPhase) * p.driftR;
        const dz = Math.sin(t * p.driftSpeed + p.driftPhase) * p.driftR;
        p.mesh.position.x = p.cx + dx;
        p.mesh.position.z = p.cz + dz;
        p.mesh.position.y = 0.21 + bob;
        p.mesh.rotation.y += p.rotSpeed * 0.016;
        if (p.bud) {
          p.bud.position.x = p.cx + dx;
          p.bud.position.z = p.cz + dz;
          p.bud.position.y = 0.34 + bob;
        }
      }
      // Subtle water surface shimmer — emissive breathing + tiny scale
      // wobble so the disc edge laps in and out.
      waterMat.emissiveIntensity = 0.15 + Math.sin(t * 0.7) * 0.05;
      water.scale.x = 1 + Math.sin(t * 0.9) * 0.012;
      water.scale.z = 1 + Math.cos(t * 0.9) * 0.012;
      // Ripples — each ring expands outward from the fountain centre,
      // fading as it grows.
      for (const r of ripples) {
        const cycle = (t * 0.45 + r.phase) % 1;
        const scale = 0.4 + cycle * (radius / 0.5) * 0.95;
        r.mesh.scale.set(scale, scale, scale);
        r.mat.opacity = (1 - cycle) * 0.45;
      }
      // Spout pulses gently to feel alive.
      spout.scale.y = 1 + Math.sin(t * 4) * 0.06;
      // Droplets — continuous arc cycle. Scale toward zero at the end
      // so they "land" cleanly instead of popping out of view.
      for (const d of droplets) {
        const cycle = ((t * d.speed) + d.phase) % 1;
        const dist = d.reach * cycle;
        const height = 1.25 + d.peak * 4 * cycle * (1 - cycle);
        d.mesh.position.x = Math.cos(d.angle) * dist;
        d.mesh.position.z = Math.sin(d.angle) * dist;
        d.mesh.position.y = height;
        const fade = cycle < 0.85 ? 1 : 1 - (cycle - 0.85) / 0.15;
        d.mesh.scale.setScalar(0.7 + 0.5 * fade);
      }
    },
  };
}

// Cute upright flower — stem + 5 petal-spheres + yellow centre. The
// flower head sits in a pivot sub-group so it can wobble when a kid
// drives over it without lifting the stem off the ground.
export function makeFlower(hue: number) {
  const g = new THREE.Group();
  const stem = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.05, 0.4, 6),
    new THREE.MeshStandardMaterial({ color: 0x4f9b3a, roughness: 1 })
  );
  stem.position.y = 0.2;
  stem.castShadow = true;
  g.add(stem);
  const headPivot = new THREE.Group();
  headPivot.position.y = 0.4;
  g.add(headPivot);
  const petalColor = new THREE.Color(`hsl(${hue}, 80%, 70%)`);
  const petalMat = new THREE.MeshStandardMaterial({ color: petalColor, roughness: 0.8 });
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const petal = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 8), petalMat);
    petal.position.set(Math.cos(a) * 0.13, 0.02, Math.sin(a) * 0.13);
    petal.castShadow = true;
    headPivot.add(petal);
  }
  const centre = new THREE.Mesh(
    new THREE.SphereGeometry(0.07, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0xffe066, roughness: 0.7 })
  );
  centre.position.y = 0.04;
  centre.castShadow = true;
  headPivot.add(centre);

  // Squish state — 1 means fully flattened, 0 means standing tall.
  // Decays smoothly back to 0 with a tiny overshoot so the flower
  // springs back up like grass after being stepped on.
  let squishT = 0;
  let lastBumpAt = 0;
  return {
    group: g,
    shake: (intensity: number = 1) => {
      // Held for ~0.4s before recovery starts so a kid driving across
      // a row of flowers leaves a clear trail of flattened ones.
      squishT = Math.min(1, Math.max(squishT, 0.6 + intensity * 0.4));
      lastBumpAt = performance.now();
    },
    update: (dt: number, _t: number) => {
      // Hold the squish briefly after a bump, then ease back up with
      // a cubic so the recovery has a satisfying spring.
      const heldFor = (performance.now() - lastBumpAt) / 1000;
      const HOLD = 0.35;
      const RECOVER = 1.1;
      if (squishT > 0) {
        if (heldFor > HOLD) {
          squishT = Math.max(0, squishT - dt / RECOVER);
        }
      }
      // Y-scale: 1 when fresh, 0.18 when squashed — petal head almost
      // touching the ground.
      const k = squishT;
      const yScale = 1 - k * 0.82;
      g.scale.set(1 + k * 0.25, yScale, 1 + k * 0.25); // petals splay out as it flattens
      // Tilt the head a bit while squashed so it doesn't read as a
      // perfectly symmetric pancake.
      headPivot.rotation.z = Math.sin(lastBumpAt * 0.0173) * 0.4 * k;
      headPivot.rotation.x = Math.cos(lastBumpAt * 0.0211) * 0.35 * k;
    },
  };
}

// Butterfly — body + two flapping wings.
export function makeButterfly(hue: number) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.04, 0.18, 6),
    new THREE.MeshStandardMaterial({ color: 0x3a2a14, roughness: 0.8 })
  );
  body.rotation.x = Math.PI / 2;
  group.add(body);
  const wingMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(`hsl(${hue}, 80%, 65%)`),
    roughness: 0.7,
    side: THREE.DoubleSide,
  });
  const wingGeo = new THREE.SphereGeometry(0.22, 10, 8);
  wingGeo.scale(1, 0.05, 0.85);
  const wingL = new THREE.Group();
  const wingLMesh = new THREE.Mesh(wingGeo, wingMat);
  wingLMesh.position.x = -0.22;
  wingL.add(wingLMesh);
  group.add(wingL);
  const wingR = new THREE.Group();
  const wingRMesh = new THREE.Mesh(wingGeo, wingMat);
  wingRMesh.position.x = 0.22;
  wingR.add(wingRMesh);
  group.add(wingR);
  return { group, wingL, wingR };
}
