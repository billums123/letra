import * as THREE from "three";
import type { Biome, BiomeContext } from "./types";
import { freshSeed, makeCloud, makeFlower, makeMushroom, makeTree, mulberry32 } from "../world";
import type { Obstacle } from "../world";

// Sky-islands biome. A handful of grassy floating islands at varying
// heights, all connected by rainbow bridges. Designed so the kid
// physically cannot fall off — every walkable surface is fenced by a
// dense ring of invisible obstacle circles, with gaps only where a
// rainbow connects. The engine's existing collision push keeps the
// avatar contained without any new engine-side logic.
//
// Vertical navigation is handled entirely through the terrain
// sampler: `setTerrainHeight` reports the height of whichever island
// or rainbow path the avatar is currently over, so driving onto a
// rainbow naturally lifts the avatar up the arch and back down onto
// the next island.

// Island layout. Positions are in world XZ; height is the top of the
// island disc (the avatar's effective Y when standing on it).
type IslandSpec = {
  id: string;
  x: number;
  z: number;
  radius: number;
  height: number;
};

const ISLANDS: IslandSpec[] = [
  { id: "center", x: 0, z: 0, radius: 7, height: 5 },
  { id: "nw", x: -16, z: -16, radius: 4.5, height: 7 },
  { id: "ne", x: 16, z: -16, radius: 4.5, height: 9 },
  { id: "se", x: 16, z: 16, radius: 4.5, height: 4 },
  { id: "sw", x: -16, z: 16, radius: 4.5, height: 11 },
];

// Rainbow connectivity. Each entry is (fromId, toId). Drawn as an arch
// from edge of `from` to edge of `to` in the direction connecting their
// centres. All outer islands connect to the centre (so any island is
// reachable in at most two hops), plus two perimeter rainbows for
// variety so the kid can also do a lap around the outside.
const CONNECTIONS: Array<[string, string]> = [
  ["center", "nw"],
  ["center", "ne"],
  ["center", "se"],
  ["center", "sw"],
  ["nw", "ne"],
  ["se", "sw"],
];

const RAINBOW_WALK_WIDTH = 3.0; // walkable corridor width — kid walks directly on the rainbow
const RAINBOW_PEAK_BASE = 1.4; // arch height above the higher endpoint
const ISLAND_OVERLAP = 0.6; // rainbow path overshoots into the island so the seam reads continuous

// Rainbow stripe colours, painted across the path width from one rail
// to the other. Six parallel stripes running ALONG the path direction
// give the kid the classic Mario-Rainbow-Road look: walking forward,
// they're moving down a striped rainbow ribbon.
const RAINBOW_COLORS = [0xff5b5b, 0xffae3a, 0xffe247, 0x52d36b, 0x4ca7ff, 0x9b6bff];

export const skyBiome: Biome = {
  id: "sky",
  label: "Sky",
  emoji: "☁️",
  recommendedAvatar: "rocket",
  applyScene(scene) {
    const prevBg = scene.background;
    const prevFog = scene.fog;
    // Soft pink-into-blue gradient sky. Three.js's scene.background
    // takes a Color; for the gradient we use a CanvasTexture painted
    // top-to-bottom with the dawn palette. Fog shares the lower
    // gradient colour so the horizon dissolves cleanly.
    const skyTex = makeSkyGradient();
    scene.background = skyTex;
    scene.fog = new THREE.Fog(0xfde2c8, 80, 220);

    // Bright warm sun from the upper east, soft cool fill from below
    // so the underside of every island doesn't go pure black.
    const sun = new THREE.DirectionalLight(0xfff2d6, 1.4);
    sun.position.set(18, 28, 12);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -28;
    sun.shadow.camera.right = 28;
    sun.shadow.camera.top = 28;
    sun.shadow.camera.bottom = -28;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 90;
    sun.shadow.bias = -0.0005;
    scene.add(sun);

    const fill = new THREE.HemisphereLight(0xffe3c0, 0xa8c8e0, 0.55);
    scene.add(fill);

    const ambient = new THREE.AmbientLight(0xffffff, 0.35);
    scene.add(ambient);

    return () => {
      scene.remove(sun);
      scene.remove(fill);
      scene.remove(ambient);
      sun.dispose();
      skyTex.dispose();
      scene.background = prevBg;
      scene.fog = prevFog;
    };
  },
  buildProps,
};

function buildProps(ctx: BiomeContext): void {
  const { group, obstacles, tick, worldRadius, setTerrainHeight, setWalkable } = ctx;

  const islandsById = new Map(ISLANDS.map((i) => [i.id, i]));

  // ── Resolve every connection to a concrete path ───────────────────
  // Each rainbow runs from a point on island A's edge to a point on
  // island B's edge along the line connecting their centres. We
  // overshoot slightly into each island so the seam where the path
  // meets the island top is hidden under the grass.
  type Path = {
    a: IslandSpec;
    b: IslandSpec;
    // Endpoints are anchor positions in world XZ — these are the
    // boundary between "on island" and "on rainbow" for the terrain
    // sampler. Walking onto a rainbow lifts the avatar smoothly
    // because at t=0 the rainbow height equals the island height.
    sx: number; sz: number;
    ex: number; ez: number;
    length: number;
    angleA: number; // angle on island A pointing toward island B
    angleB: number; // angle on island B pointing toward island A
    peak: number;
  };
  const paths: Path[] = [];
  for (const [fromId, toId] of CONNECTIONS) {
    const a = islandsById.get(fromId);
    const b = islandsById.get(toId);
    if (!a || !b) continue;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const dist = Math.hypot(dx, dz);
    const ux = dx / dist;
    const uz = dz / dist;
    const sx = a.x + ux * (a.radius - ISLAND_OVERLAP);
    const sz = a.z + uz * (a.radius - ISLAND_OVERLAP);
    const ex = b.x - ux * (b.radius - ISLAND_OVERLAP);
    const ez = b.z - uz * (b.radius - ISLAND_OVERLAP);
    const length = Math.hypot(ex - sx, ez - sz);
    paths.push({
      a, b,
      sx, sz, ex, ez,
      length,
      angleA: Math.atan2(uz, ux),
      angleB: Math.atan2(-uz, -ux),
      peak: RAINBOW_PEAK_BASE + Math.min(length * 0.05, 1.4),
    });
  }

  // ── Terrain sampler ──────────────────────────────────────────────
  // Returns the height of the walkable surface at (x, z). Islands win
  // over rainbows in their own footprint; rainbow corridors take over
  // outside island footprints. Over the void, returns 0 — the avatar
  // can't actually reach those positions because of the invisible
  // wall ring, but if it does (numerical edge case), 0 means "fall to
  // the abyss" rather than spawn a new universe of walkable space.
  // The corridor check is gentle (uses RAINBOW_WALK_WIDTH * 0.5 + a
  // small slop) so the seam at the island boundary is forgiving.
  const corridorHalf = RAINBOW_WALK_WIDTH * 0.5;
  const sampleGround = (x: number, z: number): number => {
    let best = 0;
    let onSurface = false;
    for (const isl of ISLANDS) {
      const d = Math.hypot(x - isl.x, z - isl.z);
      if (d <= isl.radius) {
        if (!onSurface || isl.height > best) {
          best = isl.height;
          onSurface = true;
        }
      }
    }
    for (const p of paths) {
      // Project (x, z) onto the path segment to find t and perpendicular
      // distance. If we're inside the corridor, sample the arch height.
      const px = p.ex - p.sx;
      const pz = p.ez - p.sz;
      const denom = p.length * p.length;
      if (denom < 0.0001) continue;
      const t = ((x - p.sx) * px + (z - p.sz) * pz) / denom;
      if (t < 0 || t > 1) continue;
      const cx = p.sx + px * t;
      const cz = p.sz + pz * t;
      const perpDist = Math.hypot(x - cx, z - cz);
      if (perpDist > corridorHalf) continue;
      const archY = Math.sin(t * Math.PI) * p.peak;
      const surfaceY = p.a.height + (p.b.height - p.a.height) * t + archY;
      if (!onSurface || surfaceY > best) {
        best = surfaceY;
        onSurface = true;
      }
    }
    return onSurface ? best : 0;
  };
  setTerrainHeight(sampleGround);

  // Walkable predicate — true if (x, z) is on an island top or on a
  // rainbow corridor. The engine's per-frame walkable clamp uses
  // this to revert any avatar move that would step into the void;
  // games' pickClearSpawn uses it to keep letters on real surfaces.
  // Definition is intentionally generous (full island radius, full
  // corridor width) so the player can roam right up to the edge —
  // the clamp on the ENGINE side stops them only at the moment they
  // would otherwise leave a surface.
  const isWalkableXZ = (x: number, z: number): boolean => {
    for (const isl of ISLANDS) {
      if (Math.hypot(x - isl.x, z - isl.z) <= isl.radius) return true;
    }
    for (const p of paths) {
      const px = p.ex - p.sx;
      const pz = p.ez - p.sz;
      const denom = p.length * p.length;
      if (denom < 0.0001) continue;
      const t = ((x - p.sx) * px + (z - p.sz) * pz) / denom;
      if (t < 0 || t > 1) continue;
      const cx = p.sx + px * t;
      const cz = p.sz + pz * t;
      const perpDist = Math.hypot(x - cx, z - cz);
      if (perpDist <= corridorHalf) return true;
    }
    return false;
  };
  setWalkable(isWalkableXZ);

  // ── Containment ──────────────────────────────────────────────────
  // No invisible-obstacle ring here. The engine's per-frame walkable
  // clamp (using the predicate registered above) reverts any move
  // that would step off an island or rainbow corridor. That's far
  // simpler than a chain of collision circles and avoids edge cases
  // where the avatar gets trapped between rings at island/rainbow
  // seams. The clamp also handles wall-sliding so the kid can drive
  // along an island edge without stuttering.

  // ── Island visuals ───────────────────────────────────────────────
  // Each island: green grass top disc, brown soil ring, conical
  // underside tapering to a point. Some scenery on top so the kid
  // has a reason to drive around.
  for (const isl of ISLANDS) {
    const islandGroup = makeIsland(isl);
    group.add(islandGroup);
    populateIsland(isl, group, obstacles, tick);
  }

  // ── Rainbows ─────────────────────────────────────────────────────
  for (const p of paths) {
    const arc = makeRainbow(p);
    group.add(arc);
  }

  // ── Sky atmosphere ───────────────────────────────────────────────
  // Drifting + breathing clouds. Two layers: a mid-altitude band
  // around island level (parallax depth) and a soft cloud sea below
  // the islands so peeking past an edge shows something other than
  // empty fog. Each cloud orbits its anchor at a slow speed and
  // breathes (subtle scale pulse) so the sky always feels alive.
  const cloudRand = mulberry32(freshSeed());
  // Per-cloud animation state. Building it once and pushing a single
  // tick callback is cheaper than registering one per cloud.
  type CloudAnim = {
    obj: THREE.Object3D;
    cx: number; cz: number;
    orbitR: number;
    angSpeed: number;
    angPhase: number;
    bobAmp: number;
    bobSpeed: number;
    bobPhase: number;
    baseY: number;
    baseScale: number;
    pulseAmp: number;
    pulseSpeed: number;
    pulsePhase: number;
  };
  const cloudAnims: CloudAnim[] = [];
  // Mid-altitude clouds at island level for parallax depth.
  for (let i = 0; i < 14; i++) {
    const angle = cloudRand() * Math.PI * 2;
    const orbitR = 35 + cloudRand() * 25;
    const c = makeCloud();
    const baseY = 4 + cloudRand() * 12;
    const cx = 0;
    const cz = 0;
    c.position.set(Math.cos(angle) * orbitR, baseY, Math.sin(angle) * orbitR);
    const baseScale = 1.4 + cloudRand() * 1.6;
    c.scale.setScalar(baseScale);
    group.add(c);
    cloudAnims.push({
      obj: c,
      cx, cz,
      orbitR,
      angSpeed: 0.012 + cloudRand() * 0.015, // very slow drift around the play zone
      angPhase: angle,
      bobAmp: 0.3 + cloudRand() * 0.4,
      bobSpeed: 0.25 + cloudRand() * 0.2,
      bobPhase: cloudRand() * Math.PI * 2,
      baseY,
      baseScale,
      pulseAmp: 0.05 + cloudRand() * 0.06, // ±5–11% scale breathing
      pulseSpeed: 0.4 + cloudRand() * 0.4,
      pulsePhase: cloudRand() * Math.PI * 2,
    });
  }
  // Cloud floor far below — tinted slightly so they read as a
  // distant sea of clouds, not just stage fog.
  const floorMat = new THREE.MeshStandardMaterial({
    color: 0xfff0e6,
    roughness: 1,
    emissive: 0xffd9b6,
    emissiveIntensity: 0.05,
  });
  for (let i = 0; i < 22; i++) {
    const x = (cloudRand() - 0.5) * 160;
    const z = (cloudRand() - 0.5) * 160;
    const cluster = new THREE.Group();
    const sizes: Array<[number, number, number, number]> = [
      [0, 0, 0, 1.6],
      [1.5, -0.1, 0, 1.2],
      [-1.4, 0.1, 0.3, 1.3],
      [0.5, 0.2, -0.3, 1.0],
    ];
    for (const [sx, sy, sz, sr] of sizes) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(sr, 12, 8), floorMat);
      s.position.set(sx, sy, sz);
      cluster.add(s);
    }
    const baseY = -8 - cloudRand() * 6;
    cluster.position.set(x, baseY, z);
    const baseScale = 2.2 + cloudRand() * 1.8;
    cluster.scale.setScalar(baseScale);
    group.add(cluster);
    // Floor clouds barely move horizontally (they're meant to read as
    // a distant carpet) but breathe slightly so the layer doesn't
    // look frozen when the kid stops moving.
    cloudAnims.push({
      obj: cluster,
      cx: x, cz: z,
      orbitR: 0.8 + cloudRand() * 1.2, // tiny wobble, not a real orbit
      angSpeed: 0.04 + cloudRand() * 0.04,
      angPhase: cloudRand() * Math.PI * 2,
      bobAmp: 0.4 + cloudRand() * 0.3,
      bobSpeed: 0.18 + cloudRand() * 0.12,
      bobPhase: cloudRand() * Math.PI * 2,
      baseY,
      baseScale,
      pulseAmp: 0.04 + cloudRand() * 0.04,
      pulseSpeed: 0.3 + cloudRand() * 0.3,
      pulsePhase: cloudRand() * Math.PI * 2,
    });
  }
  // Single tick for every cloud — cheaper than one closure per cloud.
  tick.push((_dt, t) => {
    for (const a of cloudAnims) {
      const ang = a.angPhase + t * a.angSpeed;
      a.obj.position.x = a.cx + Math.cos(ang) * a.orbitR;
      a.obj.position.z = a.cz + Math.sin(ang) * a.orbitR;
      a.obj.position.y = a.baseY + Math.sin(t * a.bobSpeed + a.bobPhase) * a.bobAmp;
      const s = a.baseScale * (1 + Math.sin(t * a.pulseSpeed + a.pulsePhase) * a.pulseAmp);
      a.obj.scale.setScalar(s);
    }
  });

  // ── Hot-air balloons drifting around the play zone ───────────────
  // Replaces the meadow's butterflies. Each balloon orbits a random
  // anchor at slow speed so the sky has a constant gentle motion.
  const balloonRand = mulberry32(freshSeed());
  for (let i = 0; i < 4; i++) {
    const orbitR = 12 + balloonRand() * 18;
    const cx = (balloonRand() - 0.5) * 20;
    const cz = (balloonRand() - 0.5) * 20;
    const speed = 0.07 + balloonRand() * 0.08;
    const phase = balloonRand() * Math.PI * 2;
    const baseY = 14 + balloonRand() * 8;
    const hue = balloonRand();
    const balloon = makeBalloon(hue);
    group.add(balloon);
    tick.push((_dt, t) => {
      const ang = t * speed + phase;
      balloon.position.x = cx + Math.cos(ang) * orbitR;
      balloon.position.z = cz + Math.sin(ang) * orbitR;
      balloon.position.y = baseY + Math.sin(t * 0.4 + phase) * 0.6;
      balloon.rotation.y = ang + Math.PI / 2;
    });
  }

  // Touch worldRadius once so the unused-var lint doesn't flag it —
  // we deliberately ignore the world's circular clamp here because
  // every reachable surface lives well inside it.
  void worldRadius;
}

// ─── Sky gradient texture ─────────────────────────────────────────────
// A small canvas painted top-to-bottom with the dawn palette, used as
// the scene background. CanvasTexture is the lightweight way to get a
// gradient sky in three.js without writing a custom shader.
function makeSkyGradient(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 4;
  c.height = 256;
  const g = c.getContext("2d")!;
  const grad = g.createLinearGradient(0, 0, 0, c.height);
  grad.addColorStop(0, "#9bc6f0"); // pale blue zenith
  grad.addColorStop(0.45, "#fcd9e8"); // pink mid
  grad.addColorStop(0.85, "#fde2c8"); // peach near horizon
  grad.addColorStop(1, "#fde8d2"); // soft horizon
  g.fillStyle = grad;
  g.fillRect(0, 0, c.width, c.height);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

// ─── Island visuals ───────────────────────────────────────────────────
function makeIsland(isl: IslandSpec): THREE.Group {
  const g = new THREE.Group();

  // Grass top — a short cylinder with the vertices on the top face
  // displaced slightly outward so the grass edge ruffles. We bake
  // some vertex-colour variation in too so the top isn't a flat
  // green slab.
  const topThickness = 0.6;
  const grassGeo = new THREE.CylinderGeometry(isl.radius, isl.radius * 0.94, topThickness, 32, 1, false);
  const grassPositions = grassGeo.attributes.position;
  const grassColors = new Float32Array(grassPositions.count * 3);
  const baseGreen = new THREE.Color(0x7fcf66);
  const lightGreen = new THREE.Color(0xa8e08a);
  const darkGreen = new THREE.Color(0x5fae50);
  const tmpC = new THREE.Color();
  for (let i = 0; i < grassPositions.count; i++) {
    const x = grassPositions.getX(i);
    const z = grassPositions.getZ(i);
    const noise = Math.sin(x * 1.7 + z * 1.3) * 0.5 + 0.5;
    tmpC.copy(baseGreen);
    if (noise > 0.55) tmpC.lerp(lightGreen, (noise - 0.55) * 1.4);
    else tmpC.lerp(darkGreen, (0.55 - noise) * 1.0);
    grassColors[i * 3 + 0] = tmpC.r;
    grassColors[i * 3 + 1] = tmpC.g;
    grassColors[i * 3 + 2] = tmpC.b;
  }
  grassGeo.setAttribute("color", new THREE.BufferAttribute(grassColors, 3));
  const grassMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    color: 0xffffff,
    roughness: 0.95,
  });
  const grass = new THREE.Mesh(grassGeo, grassMat);
  grass.position.set(isl.x, isl.height - topThickness * 0.5, isl.z);
  grass.receiveShadow = true;
  grass.castShadow = true;
  g.add(grass);

  // Soil ring — fat cylinder under the grass, tapering inward.
  const soilHeight = 1.4;
  const soilGeo = new THREE.CylinderGeometry(isl.radius * 0.94, isl.radius * 0.7, soilHeight, 24, 1, false);
  const soilMat = new THREE.MeshStandardMaterial({
    color: 0x8a5a32,
    roughness: 1,
  });
  const soil = new THREE.Mesh(soilGeo, soilMat);
  soil.position.set(isl.x, isl.height - topThickness - soilHeight * 0.5, isl.z);
  soil.receiveShadow = true;
  soil.castShadow = true;
  g.add(soil);

  // Underside cone — long cone tapering to a point so the island
  // reads as a chunk of land that's been ripped from the ground and
  // floated up into the sky.
  const coneHeight = isl.radius * 1.3;
  const coneGeo = new THREE.ConeGeometry(isl.radius * 0.7, coneHeight, 18, 1, true);
  const coneMat = new THREE.MeshStandardMaterial({
    color: 0x6a4220,
    roughness: 1,
    side: THREE.DoubleSide,
  });
  const cone = new THREE.Mesh(coneGeo, coneMat);
  cone.position.set(isl.x, isl.height - topThickness - soilHeight - coneHeight * 0.5, isl.z);
  // Cone points up by default; flip so the tip is below.
  cone.rotation.x = Math.PI;
  cone.castShadow = true;
  g.add(cone);

  // Pebble fringe along the rim where soil meets grass — small
  // rocks scattered around the edge, breaks up the silhouette.
  const pebbleRand = mulberry32(Math.floor(Math.abs(isl.x * 13 + isl.z * 7) + 1) | 1);
  const pebbleMat = new THREE.MeshStandardMaterial({ color: 0x9c8470, roughness: 1 });
  for (let i = 0; i < 18; i++) {
    const a = pebbleRand() * Math.PI * 2;
    const r = isl.radius * 0.92 + pebbleRand() * 0.12;
    const size = 0.15 + pebbleRand() * 0.18;
    const p = new THREE.Mesh(new THREE.DodecahedronGeometry(size, 0), pebbleMat);
    p.position.set(
      isl.x + Math.cos(a) * r,
      isl.height + size * 0.4,
      isl.z + Math.sin(a) * r
    );
    p.rotation.set(pebbleRand() * Math.PI, pebbleRand() * Math.PI, pebbleRand() * Math.PI);
    p.castShadow = true;
    g.add(p);
  }

  return g;
}

// Drop trees / mushrooms / flowers on top of an island. Picks spots
// inside the island radius minus a buffer so nothing pokes off the
// edge. Each prop sits at the island's top height — driving over it
// uses the existing soft/hard collision rules from the meadow.
function populateIsland(
  isl: IslandSpec,
  group: THREE.Group,
  obstacles: Obstacle[],
  tick: Array<(dt: number, t: number) => void>
): void {
  const propRand = mulberry32(Math.floor(Math.abs(isl.x * 31 + isl.z * 17 + 99)) | 1);
  // Larger islands get more props; the 7-radius central island has
  // more room than the 4.5-radius outer ones.
  const propBudget = isl.id === "center" ? { trees: 3, mushrooms: 4, flowers: 18 } : { trees: 1, mushrooms: 2, flowers: 9 };
  const placed: Array<{ x: number; z: number; r: number }> = [];

  function findSpot(selfR: number): { x: number; z: number } | null {
    const buffer = 0.6 + selfR;
    for (let attempt = 0; attempt < 24; attempt++) {
      const a = propRand() * Math.PI * 2;
      const d = propRand() * (isl.radius - buffer);
      const x = isl.x + Math.cos(a) * d;
      const z = isl.z + Math.sin(a) * d;
      let clear = true;
      for (const p of placed) {
        if (Math.hypot(x - p.x, z - p.z) < p.r + selfR + 0.4) {
          clear = false;
          break;
        }
      }
      if (clear) {
        placed.push({ x, z, r: selfR });
        return { x, z };
      }
    }
    return null;
  }

  // Trees — same makeTree from the meadow but scaled a bit smaller so
  // they don't dominate the modest islands.
  for (let i = 0; i < propBudget.trees; i++) {
    const scale = 0.7 + propRand() * 0.4;
    const radius = 1.4 * scale;
    const spot = findSpot(radius);
    if (!spot) continue;
    const hue = 100 + propRand() * 40;
    const tree = makeTree(hue, scale);
    tree.group.position.set(spot.x, isl.height, spot.z);
    tree.group.rotation.y = propRand() * Math.PI * 2;
    group.add(tree.group);
    obstacles.push({ x: spot.x, z: spot.z, radius, onBump: tree.shake });
    tick.push(tree.update);
  }

  for (let i = 0; i < propBudget.mushrooms; i++) {
    const radius = 0.55;
    const spot = findSpot(radius);
    if (!spot) continue;
    const hue = propRand() * 360;
    const m = makeMushroom(hue);
    m.group.position.set(spot.x, isl.height, spot.z);
    m.group.rotation.y = propRand() * Math.PI * 2;
    group.add(m.group);
    obstacles.push({ x: spot.x, z: spot.z, radius, onBump: m.shake });
    tick.push(m.update);
  }

  for (let i = 0; i < propBudget.flowers; i++) {
    const radius = 0.3;
    const spot = findSpot(radius);
    if (!spot) continue;
    const hue = propRand() * 360;
    const f = makeFlower(hue);
    f.group.position.set(spot.x, isl.height, spot.z);
    f.group.rotation.y = propRand() * Math.PI * 2;
    group.add(f.group);
    obstacles.push({ x: spot.x, z: spot.z, radius: 0.32, onBump: f.shake, solid: false });
    tick.push(f.update);
  }
}

// ─── Rainbow visuals ──────────────────────────────────────────────────
// A rainbow is six parallel cylindrical bars laid side-by-side across
// the path width, arching from one island to the next. Each bar is a
// TubeGeometry so the cross-section is round — no sharp edges. The
// bars sit so their TOPS form a flat walkable plane at the surface
// height the terrain sampler reports, letting the kid drive across
// the rainbow as if it were a striped road.
function makeRainbow(p: {
  a: IslandSpec; b: IslandSpec;
  sx: number; sz: number; ex: number; ez: number;
  length: number;
  peak: number;
}): THREE.Group {
  const g = new THREE.Group();

  const segments = 32;
  const dx = p.ex - p.sx;
  const dz = p.ez - p.sz;
  const ux = dx / p.length;
  const uz = dz / p.length;
  const perpX = -uz;
  const perpZ = ux;
  const halfWalk = RAINBOW_WALK_WIDTH * 0.5;
  const stripeWidth = RAINBOW_WALK_WIDTH / RAINBOW_COLORS.length;
  // Tube radius is slightly less than half the stripe slot so adjacent
  // bars sit just shy of touching — a visible micro-gap reads as
  // "separate cylindrical stripes" rather than a single fused slab.
  const tubeRadius = stripeWidth * 0.46;

  for (let i = 0; i < RAINBOW_COLORS.length; i++) {
    const offsetCenter = -halfWalk + stripeWidth * (i + 0.5);
    // Build the centreline curve for this stripe. The Y is the same
    // arch profile every stripe shares; the X/Z is the path offset
    // perpendicular by this stripe's lateral position. We drop the
    // tube's centre by `tubeRadius` below the arch so the TOP of the
    // tube lines up with the surface height the terrain sampler
    // reports. Result: kid stands on a flat-feeling rainbow plane,
    // visually composed of six round bars.
    const points: THREE.Vector3[] = [];
    for (let j = 0; j <= segments; j++) {
      const t = j / segments;
      const cx = p.sx + dx * t + perpX * offsetCenter;
      const cz = p.sz + dz * t + perpZ * offsetCenter;
      const archY = Math.sin(t * Math.PI) * p.peak;
      const cy = p.a.height + (p.b.height - p.a.height) * t + archY - tubeRadius;
      points.push(new THREE.Vector3(cx, cy, cz));
    }
    const curve = new THREE.CatmullRomCurve3(points);
    const tubeGeo = new THREE.TubeGeometry(curve, segments, tubeRadius, 14, false);
    const mat = new THREE.MeshStandardMaterial({
      color: RAINBOW_COLORS[i],
      roughness: 0.55,
      emissive: new THREE.Color(RAINBOW_COLORS[i]).multiplyScalar(0.25),
      emissiveIntensity: 0.4,
    });
    const tube = new THREE.Mesh(tubeGeo, mat);
    tube.castShadow = false;
    tube.receiveShadow = true;
    g.add(tube);
  }

  return g;
}

// Hot-air balloon — sphere envelope (with stripes), basket below,
// little ropes connecting them. Used as ambient sky decoration drifting
// around the play zone.
function makeBalloon(hue: number): THREE.Group {
  const g = new THREE.Group();
  const colorA = new THREE.Color().setHSL(hue, 0.7, 0.55);
  const colorB = new THREE.Color().setHSL((hue + 0.5) % 1, 0.7, 0.7);
  // Envelope — slightly stretched sphere with stripes painted via
  // alternating wedge meshes. We use two interleaved cones at top and
  // bottom rather than a textured sphere because the kid-friendly
  // look reads better as flat colour blocks than a noisy texture.
  const envelopeGeo = new THREE.SphereGeometry(1.4, 16, 12);
  const envelopeA = new THREE.Mesh(envelopeGeo, new THREE.MeshStandardMaterial({ color: colorA, roughness: 0.5 }));
  envelopeA.scale.y = 1.25;
  envelopeA.castShadow = true;
  g.add(envelopeA);
  // Stripe — torus around the equator for a candy-cane effect.
  const stripeMat = new THREE.MeshStandardMaterial({ color: colorB, roughness: 0.45 });
  for (let i = 0; i < 4; i++) {
    const stripe = new THREE.Mesh(new THREE.TorusGeometry(1.4, 0.06, 8, 24), stripeMat);
    stripe.rotation.x = Math.PI / 2;
    stripe.position.y = -0.7 + i * 0.45;
    stripe.scale.set(1, 1, 0.95);
    g.add(stripe);
  }
  // Basket
  const basket = new THREE.Mesh(
    new THREE.BoxGeometry(0.6, 0.4, 0.6),
    new THREE.MeshStandardMaterial({ color: 0x9c6a36, roughness: 0.95 })
  );
  basket.position.y = -2.4;
  basket.castShadow = true;
  g.add(basket);
  // Ropes
  const ropeMat = new THREE.MeshStandardMaterial({ color: 0x5a3f22, roughness: 0.9 });
  for (const sx of [-1, 1] as const) {
    for (const sz of [-1, 1] as const) {
      const rope = new THREE.Mesh(
        new THREE.CylinderGeometry(0.02, 0.02, 1.5, 4),
        ropeMat
      );
      rope.position.set(sx * 0.27, -1.45, sz * 0.27);
      rope.rotation.z = sx * 0.06;
      rope.rotation.x = sz * 0.06;
      g.add(rope);
    }
  }
  return g;
}
