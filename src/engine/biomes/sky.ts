import * as THREE from "three";
import type { Biome, BiomeContext } from "./types";
import {
  freshSeed,
  makeFlower,
  makeMushroom,
  makeSharedMeadowAssets,
  makeTree,
  mulberry32,
  type MeadowSharedAssets,
} from "../world";
import type { Obstacle } from "../world";
import { rollTimeOfDay, type TimeOfDay } from "./timeOfDay";

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
    const tod = rollTimeOfDay("sky", SKY_POOL);
    const m = SKY_MOODS[tod as keyof typeof SKY_MOODS];
    // Three.js's scene.background takes a Color; for the gradient we
    // use a CanvasTexture painted top-to-bottom from the chosen mood's
    // palette. Fog shares the lower gradient colour so the horizon
    // dissolves cleanly.
    const skyTex = makeSkyGradient(m.skyStops);
    scene.background = skyTex;
    scene.fog = new THREE.Fog(m.fogColor, 80, 220);

    const sun = new THREE.DirectionalLight(m.sunColor, m.sunIntensity);
    sun.position.set(m.sunPos[0], m.sunPos[1], m.sunPos[2]);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -45;
    sun.shadow.camera.right = 45;
    sun.shadow.camera.top = 45;
    sun.shadow.camera.bottom = -45;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 130;
    sun.shadow.bias = -0.0005;
    scene.add(sun);

    const fill = new THREE.HemisphereLight(m.hemiSky, m.hemiGround, m.hemiIntensity);
    scene.add(fill);

    const ambient = new THREE.AmbientLight(0xffffff, m.ambientIntensity);
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

// ─── Time-of-day moods ────────────────────────────────────────────────
// Sky-island visits roll one of three palettes per mount. The geometry
// (islands, rainbows, balloons) is unchanged — only the gradient,
// fog, and lighting differ.

type SkyMood = {
  // Gradient stops painted top→bottom, length 4. Each is (offset, css color).
  skyStops: Array<[number, string]>;
  fogColor: number;
  sunColor: number;
  sunIntensity: number;
  sunPos: [number, number, number];
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  ambientIntensity: number;
};

const SKY_MOODS: Record<Extract<TimeOfDay, "sky-dawn" | "sky-noon" | "sky-sunset">, SkyMood> = {
  // The original pink-dawn look — soft, warm, sun in the east.
  "sky-dawn": {
    skyStops: [
      [0, "#9bc6f0"],
      [0.45, "#fcd9e8"],
      [0.85, "#fde2c8"],
      [1, "#fde8d2"],
    ],
    fogColor: 0xfde2c8,
    sunColor: 0xfff2d6,
    sunIntensity: 1.4,
    sunPos: [18, 28, 12],
    hemiSky: 0xffe3c0,
    hemiGround: 0xa8c8e0,
    hemiIntensity: 0.55,
    ambientIntensity: 0.35,
  },
  // High noon — clean blue gradient, white sun overhead, brighter fill.
  "sky-noon": {
    skyStops: [
      [0, "#67aee8"],
      [0.45, "#9fcaf0"],
      [0.85, "#cfe6f6"],
      [1, "#e5f1f9"],
    ],
    fogColor: 0xcfe6f6,
    sunColor: 0xffffff,
    sunIntensity: 1.55,
    sunPos: [10, 32, 8],
    hemiSky: 0xcfe6f6,
    hemiGround: 0x9adf7d,
    hemiIntensity: 0.6,
    ambientIntensity: 0.4,
  },
  // Warm sunset — lavender at the zenith, orange near the horizon, low
  // raking sun. Same readability as dawn, different palette.
  "sky-sunset": {
    skyStops: [
      [0, "#7e6ab8"],
      [0.4, "#e08aa8"],
      [0.8, "#ffb074"],
      [1, "#ffd2a6"],
    ],
    fogColor: 0xffb074,
    sunColor: 0xff9a5a,
    sunIntensity: 1.2,
    sunPos: [26, 14, 6],
    hemiSky: 0xffc59a,
    hemiGround: 0x6f6692,
    hemiIntensity: 0.5,
    ambientIntensity: 0.4,
  },
};

const SKY_POOL = ["sky-dawn", "sky-noon", "sky-sunset"] as const;

function buildProps(ctx: BiomeContext): void {
  const { group, obstacles, tick, worldRadius, setTerrainHeight, setWalkable, setCelebrationCenter } = ctx;

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

  // End-of-game celebration anchors on the central island (radius 7,
  // height 5). The kid gets teleported there at finale time and all
  // 26 letters arrange around them on a single walkable surface.
  // ringRadius 4.6 keeps every letter well inside the 7-unit island
  // edge with room to spare for trees and mushrooms.
  setCelebrationCenter({ x: 0, z: 0, ringRadius: 4.6 });

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
  // has a reason to drive around. The shared meadow-prop pool is
  // built once for the whole biome — every island reuses the same
  // trunk / stem / petal materials and geometries.
  const sharedMeadow = makeSharedMeadowAssets();
  for (const isl of ISLANDS) {
    const islandGroup = makeIsland(isl);
    group.add(islandGroup);
    populateIsland(isl, group, obstacles, tick, sharedMeadow);
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
  // breathes so the sky feels alive even when the kid is still.
  // Variation comes from FOUR shape variants (puff, fluffy,
  // stretched, wispy), wide size jitter, and per-cloud speed/phase.
  const cloudRand = mulberry32(freshSeed());
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
    // Asymmetric scale shaping — most clouds aren't perfect spheres,
    // they're stretched along one axis. We bake that into the base
    // and let the pulse breathe on top of it.
    scaleX: number;
    scaleY: number;
    scaleZ: number;
    pulseAmp: number;
    pulseSpeed: number;
    pulsePhase: number;
    // Yaw drift so the cloud rotates as it ambles — sells the idea
    // it's not a rigid prop, it's a soft volume catching the wind.
    yawSpeed: number;
    yawPhase: number;
  };
  const cloudAnims: CloudAnim[] = [];

  // Mid-altitude clouds at island level for parallax depth. Mix of
  // shapes + speeds so no two read as the same prop.
  const skyCloudMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 1,
  });
  for (let i = 0; i < 18; i++) {
    const variant = pickCloudVariant(cloudRand);
    const c = makeCloudVariant(variant, cloudRand, skyCloudMat);
    const angle = cloudRand() * Math.PI * 2;
    const orbitR = 28 + cloudRand() * 38; // 28–66 — wider band than before
    const baseY = 3 + cloudRand() * 16; // 3–19 — taller layer
    c.position.set(Math.cos(angle) * orbitR, baseY, Math.sin(angle) * orbitR);
    const baseScale = 0.9 + cloudRand() * 2.4; // 0.9–3.3 — much wider size jitter
    // Stretch ratios: most clouds are wider than they are tall.
    const scaleX = 0.85 + cloudRand() * 0.6;
    const scaleY = 0.55 + cloudRand() * 0.5;
    const scaleZ = 0.85 + cloudRand() * 0.6;
    c.scale.set(baseScale * scaleX, baseScale * scaleY, baseScale * scaleZ);
    c.rotation.y = cloudRand() * Math.PI * 2;
    group.add(c);
    cloudAnims.push({
      obj: c,
      cx: 0, cz: 0,
      orbitR,
      // Speed varies wildly — fastest cloud is ~5× the slowest.
      angSpeed: (cloudRand() < 0.5 ? 1 : -1) * (0.008 + cloudRand() * 0.04),
      angPhase: angle,
      bobAmp: 0.2 + cloudRand() * 0.7,
      bobSpeed: 0.18 + cloudRand() * 0.45,
      bobPhase: cloudRand() * Math.PI * 2,
      baseY,
      baseScale,
      scaleX, scaleY, scaleZ,
      pulseAmp: 0.04 + cloudRand() * 0.09,
      pulseSpeed: 0.3 + cloudRand() * 0.6,
      pulsePhase: cloudRand() * Math.PI * 2,
      yawSpeed: (cloudRand() - 0.5) * 0.06,
      yawPhase: cloudRand() * Math.PI * 2,
    });
  }

  // Cloud floor far below — same variation kit and the same white
  // colour as the upper layer. Earlier versions tinted them peach to
  // suggest a horizon glow, but it read as tan rocks; plain white
  // reads cleanly as "more clouds, further down".
  const floorMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 1,
  });
  for (let i = 0; i < 26; i++) {
    const variant = pickCloudVariant(cloudRand);
    const cluster = makeCloudVariant(variant, cloudRand, floorMat);
    const x = (cloudRand() - 0.5) * 160;
    const z = (cloudRand() - 0.5) * 160;
    const baseY = -7 - cloudRand() * 9;
    cluster.position.set(x, baseY, z);
    const baseScale = 1.6 + cloudRand() * 2.6;
    const scaleX = 1.0 + cloudRand() * 0.7;
    const scaleY = 0.5 + cloudRand() * 0.45;
    const scaleZ = 1.0 + cloudRand() * 0.7;
    cluster.scale.set(baseScale * scaleX, baseScale * scaleY, baseScale * scaleZ);
    cluster.rotation.y = cloudRand() * Math.PI * 2;
    group.add(cluster);
    cloudAnims.push({
      obj: cluster,
      cx: x, cz: z,
      orbitR: 0.4 + cloudRand() * 1.6,
      angSpeed: (cloudRand() < 0.5 ? 1 : -1) * (0.02 + cloudRand() * 0.06),
      angPhase: cloudRand() * Math.PI * 2,
      bobAmp: 0.3 + cloudRand() * 0.45,
      bobSpeed: 0.14 + cloudRand() * 0.18,
      bobPhase: cloudRand() * Math.PI * 2,
      baseY,
      baseScale,
      scaleX, scaleY, scaleZ,
      pulseAmp: 0.03 + cloudRand() * 0.06,
      pulseSpeed: 0.2 + cloudRand() * 0.35,
      pulsePhase: cloudRand() * Math.PI * 2,
      yawSpeed: (cloudRand() - 0.5) * 0.04,
      yawPhase: cloudRand() * Math.PI * 2,
    });
  }
  // Single tick for every cloud — cheaper than one closure per cloud.
  tick.push((_dt, t) => {
    for (const a of cloudAnims) {
      const ang = a.angPhase + t * a.angSpeed;
      a.obj.position.x = a.cx + Math.cos(ang) * a.orbitR;
      a.obj.position.z = a.cz + Math.sin(ang) * a.orbitR;
      a.obj.position.y = a.baseY + Math.sin(t * a.bobSpeed + a.bobPhase) * a.bobAmp;
      const breathe = 1 + Math.sin(t * a.pulseSpeed + a.pulsePhase) * a.pulseAmp;
      const s = a.baseScale * breathe;
      a.obj.scale.set(s * a.scaleX, s * a.scaleY, s * a.scaleZ);
      a.obj.rotation.y = a.yawPhase + t * a.yawSpeed;
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
function makeSkyGradient(stops: Array<[number, string]>): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 4;
  c.height = 256;
  const g = c.getContext("2d")!;
  const grad = g.createLinearGradient(0, 0, 0, c.height);
  for (const [offset, color] of stops) grad.addColorStop(offset, color);
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
  tick: Array<(dt: number, t: number) => void>,
  shared: MeadowSharedAssets,
): void {
  const propRand = mulberry32(Math.floor(Math.abs(isl.x * 31 + isl.z * 17 + 99)) | 1);
  // Larger islands get more props; the 7-radius central island has
  // more room than the 4.5-radius outer ones.
  // Lighter prop counts so the islands stay easy to navigate around —
  // letters need clear lanes between props for the kid to walk up to
  // them. Flowers stay generous because they're soft (drive-through).
  const propBudget = isl.id === "center"
    ? { trees: 2, mushrooms: 2, flowers: 16 }
    : { trees: 1, mushrooms: 1, flowers: 7 };
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
    const tree = makeTree(hue, scale, shared);
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
    const m = makeMushroom(hue, shared);
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
    const f = makeFlower(hue, shared);
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
// little ropes connecting them. Used as ambient sky decoration
// drifting around the play zone.
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

// ─── Cloud variation ──────────────────────────────────────────────────
// Four shape variants the cloud generators randomly pick from. Each
// variant is a small group of overlapping spheres with a distinctive
// silhouette so the sky reads as a mix of cloud types instead of one
// repeated stamp.
type CloudVariant = "puff" | "fluffy" | "stretched" | "wispy";

function pickCloudVariant(rand: () => number): CloudVariant {
  const r = rand();
  if (r < 0.22) return "puff";
  if (r < 0.62) return "fluffy";
  if (r < 0.85) return "stretched";
  return "wispy";
}

function makeCloudVariant(
  variant: CloudVariant,
  rand: () => number,
  mat: THREE.MeshStandardMaterial
): THREE.Group {
  const g = new THREE.Group();
  // Per-variant sphere layouts — [x, y, z, radius]. Authored by hand
  // so each variant has a recognizable silhouette and varies enough
  // when randomized that two clouds of the same variant don't look
  // like clones.
  let layout: Array<[number, number, number, number]>;
  switch (variant) {
    case "puff":
      // Compact 2-3 sphere blob — small, round, drifts higher up.
      layout = [
        [0, 0, 0, 1.0],
        [0.8, 0.05, 0.1, 0.75],
        [-0.65, -0.05, 0.05, 0.7],
      ];
      break;
    case "fluffy":
      // The classic 4-5 sphere cumulus shape — what most clouds default to.
      layout = [
        [0, 0, 0, 1.4],
        [1.3, -0.1, 0, 1.0],
        [-1.2, 0.1, 0.2, 1.1],
        [0.4, 0.25, -0.2, 0.95],
        [-0.4, 0.3, 0.2, 0.85],
      ];
      break;
    case "stretched":
      // Long horizontal cloud — overlapping spheres along the major
      // axis so the silhouette reads as one elongated cloud, NOT a
      // string of beads. Each sphere overlaps its neighbours by ~50%
      // of its radius, with secondary spheres layered above/below to
      // bulk it out vertically.
      layout = [
        [0, 0, 0, 1.2],
        [1.0, 0.05, 0, 1.05],
        [-1.0, 0.0, 0, 1.05],
        [1.95, -0.05, 0.1, 0.9],
        [-1.95, 0.05, -0.1, 0.9],
        [2.7, -0.1, 0, 0.7],
        [-2.7, -0.1, 0, 0.7],
        [0.4, 0.35, 0.3, 0.85],
        [-0.4, 0.35, -0.3, 0.85],
      ];
      break;
    case "wispy":
      // Flat, spread-out shape — a thin cloud where you can almost see
      // through to the sky behind. Spheres overlap so the cloud reads
      // as a single soft volume rather than separate puffs.
      layout = [
        [0, 0, 0, 1.0],
        [1.0, -0.05, 0.3, 0.85],
        [-1.0, 0, -0.25, 0.85],
        [1.85, -0.1, -0.05, 0.7],
        [-1.85, 0.05, 0.15, 0.7],
        [0.2, -0.15, 0.75, 0.75],
        [-0.1, 0.1, -0.8, 0.7],
      ];
      break;
  }
  // Per-cloud jitter on each sphere position + radius so two clouds
  // of the same variant differ. Jitter is small enough that the
  // variant's silhouette still reads.
  for (const [x, y, z, r] of layout) {
    const jx = (rand() - 0.5) * 0.18;
    const jy = (rand() - 0.5) * 0.12;
    const jz = (rand() - 0.5) * 0.18;
    const jr = 1 + (rand() - 0.5) * 0.18;
    const s = new THREE.Mesh(new THREE.SphereGeometry(r * jr, 12, 9), mat);
    s.position.set(x + jx, y + jy, z + jz);
    g.add(s);
  }
  return g;
}
