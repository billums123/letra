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

// Shared materials + geometries for procedural meadow props. Hoisting
// the fixed-color materials (trunk brown, mushroom-stem cream, flower
// stem green, butterfly body) and reusable geometries (cone leaf
// shapes, stem cylinders, petal sphere) collapses hundreds of
// per-prop allocations into a single pool. Per-instance varied colors
// (leaf hue, mushroom cap hue, flower petal hue, butterfly wing hue)
// stay per-instance — sharing those would kill the visual variety.
//
// Lifetime: the bag is created per buildMeadow / buildSkyIslands call
// (i.e. per engine mount). On engine.dispose(), the scene traversal
// disposes every material and geometry once via Three.js' idempotent
// dispose(). Multiple Mesh objects pointing at the same shared
// material just call dispose() multiple times — Three.js handles the
// no-op cleanly. Next engine mount creates a fresh bag.
export type MeadowSharedAssets = {
  trunkMat: THREE.MeshStandardMaterial;
  trunkGeo: THREE.CylinderGeometry;
  // Three concentric cone sizes: index 0 is the base cone, 2 is the tip.
  leafGeos: [THREE.ConeGeometry, THREE.ConeGeometry, THREE.ConeGeometry];
  mushroomStemMat: THREE.MeshStandardMaterial;
  mushroomStemGeo: THREE.CylinderGeometry;
  mushroomSpotMat: THREE.MeshStandardMaterial;
  mushroomSpotGeo: THREE.SphereGeometry;
  mushroomCapGeo: THREE.SphereGeometry;
  flowerStemMat: THREE.MeshStandardMaterial;
  flowerStemGeo: THREE.CylinderGeometry;
  flowerCentreMat: THREE.MeshStandardMaterial;
  flowerCentreGeo: THREE.SphereGeometry;
  flowerPetalGeo: THREE.SphereGeometry;
  butterflyBodyMat: THREE.MeshStandardMaterial;
  butterflyBodyGeo: THREE.CylinderGeometry;
  butterflyWingGeo: THREE.SphereGeometry;
};

export function makeSharedMeadowAssets(): MeadowSharedAssets {
  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.32, 1.4, 8);
  const mushroomStemGeo = new THREE.CylinderGeometry(0.18, 0.22, 0.6, 10);
  // Open hemisphere — same shape every mushroom uses; per-instance
  // color is on the material, not geometry.
  const mushroomCapGeo = new THREE.SphereGeometry(0.5, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  const butterflyWingGeo = new THREE.SphereGeometry(0.22, 10, 8);
  butterflyWingGeo.scale(1, 0.05, 0.85);
  return {
    trunkMat: new THREE.MeshStandardMaterial({ color: 0x7a4a22, roughness: 1 }),
    trunkGeo,
    leafGeos: [
      new THREE.ConeGeometry(1.2, 1.6, 8),
      new THREE.ConeGeometry(0.9, 1.2, 8),
      new THREE.ConeGeometry(0.6, 0.8, 8),
    ],
    mushroomStemMat: new THREE.MeshStandardMaterial({ color: 0xf6f1d6, roughness: 0.8 }),
    mushroomStemGeo,
    mushroomSpotMat: new THREE.MeshStandardMaterial({ color: 0xf6f1d6 }),
    mushroomSpotGeo: new THREE.SphereGeometry(0.07, 8, 8),
    mushroomCapGeo,
    flowerStemMat: new THREE.MeshStandardMaterial({ color: 0x4f9b3a, roughness: 1 }),
    flowerStemGeo: new THREE.CylinderGeometry(0.04, 0.05, 0.4, 6),
    flowerCentreMat: new THREE.MeshStandardMaterial({ color: 0xffe066, roughness: 0.7 }),
    flowerCentreGeo: new THREE.SphereGeometry(0.07, 10, 8),
    flowerPetalGeo: new THREE.SphereGeometry(0.1, 8, 8),
    butterflyBodyMat: new THREE.MeshStandardMaterial({ color: 0x3a2a14, roughness: 0.8 }),
    butterflyBodyGeo: new THREE.CylinderGeometry(0.04, 0.04, 0.18, 6),
    butterflyWingGeo,
  };
}

// ─── Ground-texture helpers ──────────────────────────────────────────
// The meadow ground and the sky-island grass tops both started life as
// flat single-colour discs and read as bland next to the chunkier
// props. These helpers give both biomes the same toolkit: a heavily
// tessellated disc geometry that can carry vertex-colour variation,
// an overlay of small grass tufts (tiny upright triangular blades
// merged into one Mesh per scatter), and an overlay of low-poly
// ground patches (lighter grass, longer grass, exposed dirt). Used
// together, the floor reads as living texture instead of paint.

export type GrassPalette = {
  base: number;       // dominant green
  light: number;      // sun-bleached highlight
  dark: number;       // shaded undergrowth
  patchLight: number; // pale clover-ish patch
  patchDark: number;  // long-grass patch
  patchDirt: number;  // exposed-earth patch
};

export const MEADOW_GRASS_PALETTE: GrassPalette = {
  base: 0x86d36a,
  light: 0xb8e696,
  dark: 0x5fa84a,
  patchLight: 0xd4ecaa,
  patchDark: 0x4f8c3a,
  patchDirt: 0x9c7a4e,
};

export const SKY_GRASS_PALETTE: GrassPalette = {
  base: 0x7fcf66,
  light: 0xb1de8a,
  dark: 0x5fa850,
  patchLight: 0xc9e89e,
  patchDark: 0x4d8c3a,
  patchDirt: 0x9c7a4e,
};

// Tessellated horizontal disc — concentric rings of vertices so vertex
// colours and per-vertex displacements can paint patterns across the
// interior. THREE.CircleGeometry only puts one vertex at the centre
// and the rest on the rim, which is why a CircleGeometry-based ground
// can't hold any vertex-driven texture inside the play zone.
//
// Geometry is built directly in the XZ plane (y = 0). Caller does NOT
// rotate the resulting mesh — it's already horizontal.
export function makeGrassyDiscGeometry(radius: number, rings: number, segments: number): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  positions.push(0, 0, 0);
  for (let r = 1; r <= rings; r++) {
    const ringR = (r / rings) * radius;
    for (let s = 0; s < segments; s++) {
      const theta = (s / segments) * Math.PI * 2;
      positions.push(Math.cos(theta) * ringR, 0, Math.sin(theta) * ringR);
    }
  }
  // Inner fan — centre to first ring. Winding (centre, b, a) where b
  // is the larger-angle vertex faces +Y, given XZ angles increase CCW
  // when viewed from +Y.
  for (let s = 0; s < segments; s++) {
    const a = 1 + s;
    const b = 1 + ((s + 1) % segments);
    indices.push(0, b, a);
  }
  // Outer rings — quad strips between consecutive rings, two triangles
  // each. Winding chosen so the upper face points +Y.
  for (let r = 1; r < rings; r++) {
    const innerStart = 1 + (r - 1) * segments;
    const outerStart = 1 + r * segments;
    for (let s = 0; s < segments; s++) {
      const i0 = innerStart + s;
      const i1 = innerStart + ((s + 1) % segments);
      const o0 = outerStart + s;
      const o1 = outerStart + ((s + 1) % segments);
      indices.push(i0, i1, o1);
      indices.push(i0, o1, o0);
    }
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geom.setIndex(indices);
  geom.computeVertexNormals();
  return geom;
}

// Paints the supplied tessellated geometry with grass-coloured vertex
// variation. Two layers of low-frequency sin noise pick the dominant
// blend (light highlights vs. dark shade), and a sparse "patch"
// overlay tints occasional clusters toward the palette's accent
// colours. Result: even before tufts/patches land on top, the disc
// reads as textured grass instead of a flat solid colour.
//
// `featureScale` stretches the noise period; pass > 1 for very large
// discs so the pattern doesn't repeat too often, < 1 for small
// island tops so the variation actually shows up at that size.
export function paintGrassVertexColors(
  geom: THREE.BufferGeometry,
  palette: GrassPalette,
  featureScale: number = 1
): void {
  const pos = geom.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const tmp = new THREE.Color();
  const cBase = new THREE.Color(palette.base);
  const cLight = new THREE.Color(palette.light);
  const cDark = new THREE.Color(palette.dark);
  const cPatchLight = new THREE.Color(palette.patchLight);
  const cPatchDark = new THREE.Color(palette.patchDark);
  const cDirt = new THREE.Color(palette.patchDirt);
  const f1 = 0.18 / featureScale;
  const f2 = 0.42 / featureScale;
  const f3 = 0.85 / featureScale;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const n1 = Math.sin(x * f1 + z * f1 * 0.7) * 0.5 + 0.5;
    const n2 = Math.sin(x * f2 - z * f2 * 0.9 + 1.7) * 0.5 + 0.5;
    const n3 = Math.sin(x * f3 + z * f3 * 1.1 + 4.2) * 0.5 + 0.5;
    const blend = n1 * 0.6 + n2 * 0.3 + n3 * 0.1;
    tmp.copy(cBase);
    // Halved the lerp coefficients vs. the first pass so the base
    // ground reads as gently variegated grass rather than zoned
    // light/dark bands. The dedicated patch overlay is what carries
    // the louder hue work — keeping the floor itself quiet means
    // patches and tufts have somewhere to read against.
    if (blend > 0.6) tmp.lerp(cLight, Math.min(0.6, (blend - 0.6) * 1.2));
    else if (blend < 0.38) tmp.lerp(cDark, Math.min(0.6, (0.38 - blend) * 1.1));
    // Sparse accent tinting where two noise layers happen to peak
    // together. The strength is dialled down (~0.28 ceiling) so this
    // adds soft hue drift rather than punching through as a second
    // layer of patches — the scatter mesh is already doing that job.
    const patchScore = (n2 - 0.65) + (n3 - 0.7);
    if (patchScore > 0.18) {
      const bucket = (n1 + n3) % 1;
      const target = bucket < 0.5 ? cPatchLight : bucket < 0.85 ? cPatchDark : cDirt;
      tmp.lerp(target, Math.min(0.28, patchScore * 0.7));
    }
    colors[i * 3 + 0] = tmp.r;
    colors[i * 3 + 1] = tmp.g;
    colors[i * 3 + 2] = tmp.b;
  }
  geom.setAttribute("color", new THREE.BufferAttribute(colors, 3));
}

// Builds one combined Mesh holding every blade of a scatter of grass
// tufts. A tuft is a small clump of upright triangular blades fanning
// outward from a centre — blade count, height, lean, and hue all
// jitter per tuft so no two clumps look stamped from the same prop.
// The cubic bias on the size jitter pushes most tufts toward "small
// sprig", so the field reads as a quiet base layer with occasional
// taller clumps rather than a uniform carpet.
export function makeGrassTufts(
  positions: Array<{ x: number; z: number; y: number }>,
  palette: GrassPalette,
  rng: () => number,
): THREE.Mesh {
  const verts: number[] = [];
  const idx: number[] = [];
  const colors: number[] = [];
  const cBase = new THREE.Color(palette.dark);
  const cTip = new THREE.Color(palette.light);
  const cBaseTuft = new THREE.Color();
  const cTipTuft = new THREE.Color();
  const tipMix = new THREE.Color();
  for (const { x, y, z } of positions) {
    const yaw = rng() * Math.PI * 2;
    // Cubic bias on the size sample — most tufts are tiny sprigs (≈
    // 0.45 scale), the long tail produces the occasional taller clump.
    const r0 = rng();
    const sizeJitter = 0.45 + r0 * r0 * r0 * 1.15;
    // Variable blade count (2–5) so density varies tuft to tuft.
    const bladesPerTuft = 2 + ((rng() * 4) | 0);
    // Per-tuft hue + lightness jitter so the field is a spread of
    // greens (yellower vs. bluer, brighter vs. shaded) rather than
    // one uniform palette green stamped repeatedly. ±0.05 hue is
    // enough variation to read without breaking palette cohesion.
    const hueShift = (rng() - 0.5) * 0.10;
    const lightShift = (rng() - 0.5) * 0.10;
    cBaseTuft.copy(cBase).offsetHSL(hueShift, 0, lightShift);
    cTipTuft.copy(cTip).offsetHSL(hueShift, 0, lightShift);
    const baseHalf = 0.030 + rng() * 0.020;
    for (let b = 0; b < bladesPerTuft; b++) {
      // Yaw jitter on each blade's angle breaks up any visible
      // rotational symmetry — the four-blades-at-90° pattern of the
      // old tufts is gone.
      const a = yaw + (b / bladesPerTuft) * Math.PI * 2 + (rng() - 0.5) * 0.55;
      const dirX = Math.cos(a);
      const dirZ = Math.sin(a);
      const offset = 0.020 + rng() * 0.04;
      const bcx = x + dirX * offset;
      const bcz = z + dirZ * offset;
      const perpX = -dirZ;
      const perpZ = dirX;
      const tipHeight = (0.16 + rng() * 0.22) * sizeJitter;
      const tipLean = (0.04 + rng() * 0.06) * sizeJitter;
      const baseY = y;
      const tipY = y + tipHeight;
      const i0 = verts.length / 3;
      verts.push(
        bcx + perpX * baseHalf, baseY, bcz + perpZ * baseHalf, // base left
        bcx - perpX * baseHalf, baseY, bcz - perpZ * baseHalf, // base right
        bcx + dirX * tipLean,   tipY,  bcz + dirZ * tipLean,   // tip
      );
      idx.push(i0, i0 + 1, i0 + 2);
      const tipShade = 0.55 + rng() * 0.45;
      tipMix.copy(cBaseTuft).lerp(cTipTuft, tipShade);
      colors.push(cBaseTuft.r, cBaseTuft.g, cBaseTuft.b);
      colors.push(cBaseTuft.r, cBaseTuft.g, cBaseTuft.b);
      colors.push(tipMix.r, tipMix.g, tipMix.b);
    }
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
  geom.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geom.setIndex(idx);
  geom.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    color: 0xffffff,
    roughness: 1,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return mesh;
}

export type GroundPatchKind = "light" | "dark" | "dirt";

// Builds one combined Mesh of soft tinted blobs that fade into the
// surrounding grass. Each patch is two concentric rings — a tinted
// inner core, and an outer ring whose vertex colour is lerped almost
// all the way back to the base grass tint. The result reads as a
// pigment wash bleeding into the soil rather than a stamped sticker;
// the polygonal "lined blotch" silhouette of a coarse one-ring fan
// disappears because by the time the geometry hits its outer edge
// the colour difference from the surrounding grass is sub-perceptual.
//
// 24 segments + a low-amplitude radial wobble keep each blob's
// silhouette curved and irregular without any visible facets.
export function makeGroundPatches(
  positions: Array<{ x: number; z: number; y: number; radius: number; kind: GroundPatchKind }>,
  palette: GrassPalette,
  rng: () => number,
): THREE.Mesh {
  const verts: number[] = [];
  const idx: number[] = [];
  const colors: number[] = [];
  const colorByKind: Record<GroundPatchKind, THREE.Color> = {
    light: new THREE.Color(palette.patchLight),
    dark: new THREE.Color(palette.patchDark),
    dirt: new THREE.Color(palette.patchDirt),
  };
  const cBase = new THREE.Color(palette.base);
  const tmp = new THREE.Color();
  const SEGS = 24;
  // Inner ring sits at ~0.45 of the patch radius. Most of the
  // silhouette is therefore "fading rim", which is what produces the
  // gradient look — the geometry is still a fan, but the colour
  // gradient kills any visible polygon edge.
  const INNER_FRAC = 0.45;
  for (const p of positions) {
    const c = colorByKind[p.kind];
    const startIdx = verts.length / 3;
    const phase = rng() * Math.PI * 2;
    // Per-patch tint strength so the field has both bold and barely-
    // visible blends rather than every patch reading at one
    // intensity. Dirt stays a touch stronger so "exposed earth"
    // still parses as a different kind of mark than shaded grass.
    const baseStrength = p.kind === "dirt" ? 0.45 : 0.30;
    const strength = baseStrength + rng() * 0.18;
    // Centre vertex — strongest tint of the patch, with a hair more
    // saturation so the gradient has somewhere to fall from.
    tmp.copy(cBase).lerp(c, Math.min(1, strength * 1.15));
    verts.push(p.x, p.y, p.z);
    colors.push(tmp.r, tmp.g, tmp.b);
    // Inner ring — full strength, with tiny per-vertex shade jitter
    // so the core isn't a perfectly flat disc of colour.
    for (let s = 0; s < SEGS; s++) {
      const theta = phase + (s / SEGS) * Math.PI * 2;
      const wob = 1 + 0.06 * Math.sin(theta * 3 + phase * 1.7)
                    + 0.04 * Math.sin(theta * 5 + phase * 0.4);
      const r = p.radius * INNER_FRAC * wob;
      tmp.copy(cBase).lerp(c, strength * (0.85 + rng() * 0.10));
      verts.push(p.x + Math.cos(theta) * r, p.y, p.z + Math.sin(theta) * r);
      colors.push(tmp.r, tmp.g, tmp.b);
    }
    // Outer ring — radius wobbles harder here for an organic
    // perimeter, but the colour is lerped almost all the way back to
    // base grass so the edge dissolves rather than ending in a hard
    // line. 8–18% of the tint at the rim is the sweet spot: visible
    // as the "edge of a blend" but not as a discrete shape.
    for (let s = 0; s < SEGS; s++) {
      const theta = phase + (s / SEGS) * Math.PI * 2;
      const wob = 1 + 0.10 * Math.sin(theta * 2 + phase * 1.2)
                    + 0.06 * Math.sin(theta * 5 + phase * 0.6)
                    + 0.04 * Math.sin(theta * 9 + phase * 2.1);
      const r = p.radius * wob;
      const edgeMix = strength * (0.08 + rng() * 0.10);
      tmp.copy(cBase).lerp(c, edgeMix);
      verts.push(p.x + Math.cos(theta) * r, p.y, p.z + Math.sin(theta) * r);
      colors.push(tmp.r, tmp.g, tmp.b);
    }
    // Triangulate. Centre = startIdx; inner ring follows; outer ring
    // after that. Inner cap (centre, b, a) faces +Y; quad strip from
    // inner to outer uses the same +Y winding as the disc helper.
    const innerStart = startIdx + 1;
    const outerStart = startIdx + 1 + SEGS;
    for (let s = 0; s < SEGS; s++) {
      const a = innerStart + s;
      const b = innerStart + ((s + 1) % SEGS);
      idx.push(startIdx, b, a);
      const oa = outerStart + s;
      const ob = outerStart + ((s + 1) % SEGS);
      idx.push(a, b, ob);
      idx.push(a, ob, oa);
    }
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
  geom.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geom.setIndex(idx);
  geom.computeVertexNormals();
  // polygonOffset pushes the patch's depth values toward the camera so
  // it always wins the z-test against the flat ground sitting just
  // below it. Without this, the tiny Y separation (~0.01–0.02) is
  // smaller than the depth buffer's per-pixel precision at typical
  // play distances and the two surfaces flicker against each other —
  // visible as cloudy/jittery noise that swims around as the camera
  // moves.
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    color: 0xffffff,
    roughness: 1,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const mesh = new THREE.Mesh(geom, mat);
  // No receiveShadow — these patches are decorative colour washes
  // sitting fractions of a unit above the underlying ground, and
  // having them participate in shadow comparison produces shadow
  // acne (sparkly cross-hatched flicker) on the patch surface as
  // tree / mushroom shadows pass over it. The colour gradient
  // itself already conveys the "darker" patches; missing real-time
  // shadow on a thin tinted blob isn't perceptible.
  mesh.receiveShadow = false;
  // castShadow stays false (default) — flat blobs casting shadows on
  // themselves is the same problem in reverse, and they're too thin
  // to throw a meaningful shadow anyway.
  return mesh;
}

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
  getPlayerPosition: () => THREE.Vector3 | null = () => null,
  launchPlayer: BiomeContext["launchPlayer"] = () => {},
  setPlayerVisible: BiomeContext["setPlayerVisible"] = () => {},
  setPlayerAblaze: BiomeContext["setPlayerAblaze"] = () => false,
  setCameraFocus: BiomeContext["setCameraFocus"] = () => {},
  launchToPlanet: BiomeContext["launchToPlanet"] = () => {},
  leavePlanet: BiomeContext["leavePlanet"] = () => {}
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
    launchPlayer,
    setPlayerVisible,
    setPlayerAblaze,
    setCameraFocus,
    launchToPlanet,
    leavePlanet,
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
  // One shared pool of fixed-color materials + reusable geometries
  // for the meadow's 100+ procedural props. Per-instance varied
  // colors (leaf hue, mushroom cap, flower petals, butterfly wings)
  // keep their own per-prop materials inside the factories.
  const shared = makeSharedMeadowAssets();

  // Ground — tessellated grass disc with vertex-coloured variation so
  // the play surface reads as living grass instead of a paint-bucket
  // green. 18 rings × 64 segments puts ~1100 verts on the floor —
  // tiny next to letters and props, but enough resolution for the
  // noise pattern to actually paint visible patches across the
  // interior. See paintGrassVertexColors for the noise mix.
  const groundRadius = worldRadius + 30;
  const groundGeo = makeGrassyDiscGeometry(groundRadius, 18, 64);
  paintGrassVertexColors(groundGeo, MEADOW_GRASS_PALETTE, 1);
  const ground = new THREE.Mesh(
    groundGeo,
    new THREE.MeshStandardMaterial({ vertexColors: true, color: 0xffffff, roughness: 1 }),
  );
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

  // Soft ground patches inside the play zone — gradient-blended tints
  // (greener, darker, dirt-brown) that fade smoothly into the
  // surrounding grass. The earlier scatter of blade-tufts read as
  // origami sprigs stamped on the floor rather than real grass, so
  // the textured-ground job is now done by patches + the vertex-
  // colour variation baked into the ground disc.
  const PLAY_OUTER = worldRadius - 1.5;
  const POND_BUFFER = pond.radius + 1.0;
  const patchRand = mulberry32(freshSeed());
  const patchPositions: Array<{ x: number; z: number; y: number; radius: number; kind: GroundPatchKind }> = [];
  let patchAttempts = 0;
  // Fewer, larger blobs vs. the previous denser-but-smaller layout —
  // because the new gradient style fades into the background, larger
  // soft washes read better than many small ones (which would just
  // dissolve back into the grass). Light/dark grass blends carry the
  // hue work; dirt is intentionally rare so it lands as a focal scuff.
  while (patchPositions.length < 22 && patchAttempts < 220) {
    patchAttempts++;
    const angle = patchRand() * Math.PI * 2;
    const dist = Math.sqrt(patchRand()) * PLAY_OUTER;
    const x = Math.cos(angle) * dist;
    const z = Math.sin(angle) * dist;
    if (Math.hypot(x - pondPos.x, z - pondPos.z) < POND_BUFFER) continue;
    const r = patchRand();
    const kind: GroundPatchKind = r < 0.55 ? "light" : r < 0.92 ? "dark" : "dirt";
    patchPositions.push({
      x, z,
      y: 0.012,
      radius: 1.1 + patchRand() * 1.7,
      kind,
    });
  }
  const patches = makeGroundPatches(patchPositions, MEADOW_GRASS_PALETTE, patchRand);
  group.add(patches);

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

  // ── Distant scenery ─────────────────────────────────────────────────
  // Trees, boulders, mushrooms and flower clumps scattered beyond the
  // play boundary so the area outside the invisible wall reads as a
  // continuing landscape instead of empty grass. None of these props
  // are added to `obstacles` (the kid can never reach them) or to
  // `tick` (no shake animation needed) — they exist purely as visual
  // background. They share the same factories as the foreground props
  // so the silhouette language is consistent; the only differences
  // are placement (always outside WORLD_RADIUS) and a slightly muted
  // hue range so the eye still picks the play zone as the primary
  // surface.
  //
  // Inner radius matches the hill rule (WORLD_RADIUS + 4) so distant
  // props sit just beyond the boundary, with a generous outer
  // sampling box so the band feels deep rather than ringed. A simple
  // overlap check against existing scenery prevents distant trees
  // from spawning on top of a hill.
  type DistantSpot = { x: number; z: number; radius: number };
  const distantSpots: DistantSpot[] = [];
  function findDistantSpot(rand: () => number, selfR: number, attempts = 30): DistantSpot | null {
    for (let i = 0; i < attempts; i++) {
      const x = (rand() - 0.5) * 200;
      const z = (rand() - 0.5) * 200;
      const d = Math.hypot(x, z);
      if (d < WORLD_RADIUS + 4 + selfR) continue;
      if (d > 95) continue; // beyond fog-fade — placing further is wasted
      let clear = true;
      for (const s of distantSpots) {
        if (Math.hypot(x - s.x, z - s.z) < s.radius + selfR + 1.0) {
          clear = false;
          break;
        }
      }
      if (!clear) continue;
      const spot = { x, z, radius: selfR };
      distantSpots.push(spot);
      return spot;
    }
    return null;
  }

  // Distant trees — slightly smaller scale band and a leaf hue
  // pushed toward the cooler/blue end so they recede visually.
  const distantTreeRand = mulberry32(freshSeed());
  for (let i = 0; i < 32; i++) {
    const scale = 0.85 + distantTreeRand() * 0.7;
    const spot = findDistantSpot(distantTreeRand, 1.6 * scale);
    if (!spot) continue;
    // 95–135° leans toward blue-green, which atmospheric perspective
    // would do anyway — fakes distance fade without an extra shader.
    const hue = 95 + distantTreeRand() * 40;
    const tree = makeTree(hue, scale, shared);
    tree.group.position.set(spot.x, 0, spot.z);
    tree.group.rotation.y = distantTreeRand() * Math.PI * 2;
    group.add(tree.group);
  }

  // Distant boulders — same factory as foreground rocks, larger
  // overall size range so they read at distance without crowding.
  const distantBoulderRand = mulberry32(freshSeed());
  for (let i = 0; i < 14; i++) {
    const size = 1.0 + distantBoulderRand() * 1.4;
    const spot = findDistantSpot(distantBoulderRand, size * 0.9);
    if (!spot) continue;
    const hue = (distantBoulderRand() * 360) | 0;
    const b = makeBoulder(size, hue);
    b.position.set(spot.x, 0, spot.z);
    b.rotation.y = distantBoulderRand() * Math.PI * 2;
    group.add(b);
  }

  // Distant mushroom clumps — placed in tight pairs/triples so they
  // read as natural clusters in the far field rather than evenly
  // spaced singletons.
  const distantMushRand = mulberry32(freshSeed());
  for (let i = 0; i < 10; i++) {
    const anchor = findDistantSpot(distantMushRand, 1.2);
    if (!anchor) continue;
    const clusterCount = 2 + ((distantMushRand() * 3) | 0); // 2–4 mushrooms per cluster
    for (let j = 0; j < clusterCount; j++) {
      const ox = (distantMushRand() - 0.5) * 1.8;
      const oz = (distantMushRand() - 0.5) * 1.8;
      const hue = distantMushRand() * 360;
      const m = makeMushroom(hue, shared);
      m.group.position.set(anchor.x + ox, 0, anchor.z + oz);
      m.group.rotation.y = distantMushRand() * Math.PI * 2;
      // Slight scale jitter so cluster members aren't identical.
      const ms = 0.85 + distantMushRand() * 0.45;
      m.group.scale.setScalar(ms);
      group.add(m.group);
    }
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
    const tree = makeTree(hue, scale, shared);
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
    const m = makeMushroom(hue, shared);
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
    const f = makeFlower(hue, shared);
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
    const b = makeButterfly(hue, shared);
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
  // Deterministic grid-sweep fallback. The random pass above can fail
  // when most positions in the ring are non-walkable (e.g. sky-islands
  // void) — this pass guarantees a walkable spot if one exists by
  // visiting every (angle, radius) cell in a coarse grid. We accept
  // overlapping a previously-taken letter spot before we'll ever
  // return a non-walkable position, since "two letters near each
  // other" is fixable in-game while "letter floating in the void" is
  // permanently unreachable.
  if (isWalkable) {
    const STEPS = 36;
    const RADII = 12;
    // Two passes: first respecting taken+obstacles, then relaxed if
    // nothing fit. Either way, isWalkable is non-negotiable.
    for (let pass = 0; pass < 2; pass++) {
      for (let ri = 0; ri < RADII; ri++) {
        const dist = cappedMin + (ri / Math.max(1, RADII - 1)) * (cappedMax - cappedMin);
        // Stagger the angle origin per radius so adjacent rings don't
        // line up — keeps the fallback from clustering on a spoke.
        const angleOffset = (ri * 0.137) * Math.PI * 2;
        for (let ai = 0; ai < STEPS; ai++) {
          const angle = angleOffset + (ai / STEPS) * Math.PI * 2;
          const x = Math.cos(angle) * dist;
          const z = Math.sin(angle) * dist;
          if (!isWalkable(x, z)) continue;
          let clear = true;
          for (const o of obstacles) {
            if (Math.hypot(x - o.x, z - o.z) < o.radius + selfRadius + 0.4) {
              clear = false;
              break;
            }
          }
          if (clear && pass === 0) {
            for (const t of taken) {
              if (Math.hypot(x - t.x, z - t.z) < t.radius + selfRadius + 0.6) {
                clear = false;
                break;
              }
            }
          }
          if (clear) return { x, z };
        }
      }
    }
    // Truly desperate: any walkable point at all, ignoring obstacles
    // and taken. Better than dropping into the void.
    for (let ri = 0; ri < RADII; ri++) {
      const dist = cappedMin + (ri / Math.max(1, RADII - 1)) * (cappedMax - cappedMin);
      for (let ai = 0; ai < STEPS; ai++) {
        const angle = (ai / STEPS) * Math.PI * 2;
        const x = Math.cos(angle) * dist;
        const z = Math.sin(angle) * dist;
        if (isWalkable(x, z)) return { x, z };
      }
    }
  }
  // No walkable filter (or it found nothing in any pass): legacy
  // fallback — drop on the inner ring.
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
export function makeTree(hue: number, scale: number, shared?: MeadowSharedAssets) {
  const g = new THREE.Group();
  g.scale.setScalar(scale);
  // Trunk: fixed color + dimensions across every tree, so we always
  // share when a pool is provided. Falling back to a fresh material +
  // geometry preserves backward compat for callers that don't pool.
  const trunkMat = shared?.trunkMat ?? new THREE.MeshStandardMaterial({ color: 0x7a4a22, roughness: 1 });
  const trunkGeo = shared?.trunkGeo ?? new THREE.CylinderGeometry(0.22, 0.32, 1.4, 8);
  const trunk = new THREE.Mesh(trunkGeo, trunkMat);
  trunk.position.y = 0.7;
  trunk.castShadow = true;
  trunk.receiveShadow = true;
  g.add(trunk);

  const foliage = new THREE.Group();
  // Pivot at the top of the trunk so the wobble pivots from there.
  foliage.position.y = 1.4;
  g.add(foliage);

  // Leaf hue is per-tree, so the material stays per-instance. The
  // three cone geometries are identical across every tree, though,
  // so they come from the shared pool when available.
  const leafColor = new THREE.Color(`hsl(${hue}, 60%, 45%)`);
  const leafMat = new THREE.MeshStandardMaterial({ color: leafColor, roughness: 0.9 });
  for (let i = 0; i < 3; i++) {
    const leafGeo = shared?.leafGeos[i] ?? new THREE.ConeGeometry(1.2 - i * 0.3, 1.6 - i * 0.4, 8);
    const c = new THREE.Mesh(leafGeo, leafMat);
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

export function makeMushroom(hue: number, shared?: MeadowSharedAssets) {
  const m = new THREE.Group();
  // Stem: same cream color + cylinder dimensions every time → share.
  const stemMat = shared?.mushroomStemMat ?? new THREE.MeshStandardMaterial({ color: 0xf6f1d6, roughness: 0.8 });
  const stemGeo = shared?.mushroomStemGeo ?? new THREE.CylinderGeometry(0.18, 0.22, 0.6, 10);
  const stem = new THREE.Mesh(stemGeo, stemMat);
  stem.position.y = 0.3;
  stem.castShadow = true;
  m.add(stem);

  // Cap + spots live in a pivot sub-group anchored at the top of the
  // stem so a player bump tilts the cap (like a tree's foliage)
  // without uprooting the stem.
  const capPivot = new THREE.Group();
  capPivot.position.y = 0.6;
  m.add(capPivot);

  // Cap color is per-mushroom (random hue), so the material stays
  // per-instance. The hemisphere geometry is identical across all
  // mushrooms — share when pool available.
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
  const capGeo =
    shared?.mushroomCapGeo ?? new THREE.SphereGeometry(0.5, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  const cap = new THREE.Mesh(capGeo, capMat);
  cap.position.y = 0.15;
  cap.castShadow = true;
  capPivot.add(cap);

  // Spots — same cream color + tiny sphere geometry every time → share.
  const spotMat = shared?.mushroomSpotMat ?? new THREE.MeshStandardMaterial({ color: 0xf6f1d6 });
  const spotGeo = shared?.mushroomSpotGeo ?? new THREE.SphereGeometry(0.07, 8, 8);
  for (let i = 0; i < 3; i++) {
    const s = new THREE.Mesh(spotGeo, spotMat);
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
export function makeFlower(hue: number, shared?: MeadowSharedAssets) {
  const g = new THREE.Group();
  // Stem: fixed green + dimensions → share.
  const stemMat = shared?.flowerStemMat ?? new THREE.MeshStandardMaterial({ color: 0x4f9b3a, roughness: 1 });
  const stemGeo = shared?.flowerStemGeo ?? new THREE.CylinderGeometry(0.04, 0.05, 0.4, 6);
  const stem = new THREE.Mesh(stemGeo, stemMat);
  stem.position.y = 0.2;
  stem.castShadow = true;
  g.add(stem);
  const headPivot = new THREE.Group();
  headPivot.position.y = 0.4;
  g.add(headPivot);
  // Petal color is per-flower (random hue), so the material stays
  // per-instance. The petal sphere geometry is identical across every
  // flower — share when pool available.
  const petalColor = new THREE.Color(`hsl(${hue}, 80%, 70%)`);
  const petalMat = new THREE.MeshStandardMaterial({ color: petalColor, roughness: 0.8 });
  const petalGeo = shared?.flowerPetalGeo ?? new THREE.SphereGeometry(0.1, 8, 8);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const petal = new THREE.Mesh(petalGeo, petalMat);
    petal.position.set(Math.cos(a) * 0.13, 0.02, Math.sin(a) * 0.13);
    petal.castShadow = true;
    headPivot.add(petal);
  }
  // Centre disc: fixed yellow + sphere → share.
  const centreMat = shared?.flowerCentreMat ?? new THREE.MeshStandardMaterial({ color: 0xffe066, roughness: 0.7 });
  const centreGeo = shared?.flowerCentreGeo ?? new THREE.SphereGeometry(0.07, 10, 8);
  const centre = new THREE.Mesh(centreGeo, centreMat);
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
export function makeButterfly(hue: number, shared?: MeadowSharedAssets) {
  const group = new THREE.Group();
  // Body: fixed dark color + cylinder → share. Wings vary per-butterfly
  // (random hue), so the material stays per-instance — but the squashed
  // sphere geometry is identical and is shared when a pool is provided.
  const bodyMat = shared?.butterflyBodyMat ?? new THREE.MeshStandardMaterial({ color: 0x3a2a14, roughness: 0.8 });
  const bodyGeo = shared?.butterflyBodyGeo ?? new THREE.CylinderGeometry(0.04, 0.04, 0.18, 6);
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.rotation.x = Math.PI / 2;
  group.add(body);
  const wingMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(`hsl(${hue}, 80%, 65%)`),
    roughness: 0.7,
    side: THREE.DoubleSide,
  });
  let wingGeo: THREE.SphereGeometry;
  if (shared?.butterflyWingGeo) {
    wingGeo = shared.butterflyWingGeo;
  } else {
    wingGeo = new THREE.SphereGeometry(0.22, 10, 8);
    wingGeo.scale(1, 0.05, 0.85);
  }
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
