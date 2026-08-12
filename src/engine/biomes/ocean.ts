import * as THREE from "three";
import type { Biome, BiomeContext } from "./types";
import { findOpenSpot, freshSeed, mulberry32, makeCloud } from "../world";
import { makePalmTree } from "./jungle";
import { rollTimeOfDay, type TimeOfDay } from "./timeOfDay";
import { playVolcanoRumble, playVolcanoBoom, playLavaPop, playSplash, playWoo } from "../../audio/sfx";

// Ocean biome — the kid putters around open water in a tugboat.
// Faceted low-poly waves undulate for real (the terrain sampler rides
// the same wave field, so the boat pitches and rolls over swells),
// fish arc out of the water, a very friendly sea monster cruises the
// horizon, and the landmark is a volcano island with a sea cave at
// the waterline. Drive into the cave and the mountain swallows you,
// rumbles, and blasts you out the top — splashdown wherever you land.
//
// Same launch machinery as the jungle volcano (ctx.launchPlayer); the
// only new mechanics here are water-specific dressing: the wave
// field, the cave trigger, and splash effects on water landings.

type OceanMood = {
  bg: number;
  fogColor: number;
  fogNear: number;
  fogFar: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  sunColor: number;
  sunIntensity: number;
  sunPos: [number, number, number];
  ambientColor: number;
  ambientIntensity: number;
};

const OCEAN_MOODS: Record<
  Extract<TimeOfDay, "ocean-dawn" | "ocean-day" | "ocean-sunset">,
  OceanMood
> = {
  // Soft pink-peach morning over calm water.
  "ocean-dawn": {
    bg: 0xffd9c4,
    fogColor: 0xffd9c4,
    fogNear: 55,
    fogFar: 150,
    hemiSky: 0xffe8d0,
    hemiGround: 0x3f7fae,
    hemiIntensity: 0.6,
    sunColor: 0xffd9a8,
    sunIntensity: 1.15,
    sunPos: [24, 14, 8],
    ambientColor: 0xffeee0,
    ambientIntensity: 0.45,
  },
  // Bright sailing weather — saturated sky, hard sun, long views.
  "ocean-day": {
    bg: 0x87d4ff,
    fogColor: 0x87d4ff,
    fogNear: 65,
    fogFar: 170,
    hemiSky: 0xfff7d6,
    hemiGround: 0x2f6f9e,
    hemiIntensity: 0.65,
    sunColor: 0xffffff,
    sunIntensity: 1.45,
    sunPos: [16, 26, 10],
    ambientColor: 0xffffff,
    ambientIntensity: 0.42,
  },
  // Golden-hour sea, volcano silhouetted against the sunset.
  "ocean-sunset": {
    bg: 0xffb27a,
    fogColor: 0xffb27a,
    fogNear: 50,
    fogFar: 145,
    hemiSky: 0xffc9a0,
    hemiGround: 0x3a5a80,
    hemiIntensity: 0.55,
    sunColor: 0xff9a56,
    sunIntensity: 1.25,
    sunPos: [28, 9, 6],
    ambientColor: 0xffd9b0,
    ambientIntensity: 0.45,
  },
};

const OCEAN_POOL = ["ocean-dawn", "ocean-day", "ocean-sunset"] as const;

// ── Volcano island constants ────────────────────────────────────────
const ISLAND = { x: -16, z: -12 };
const ISLAND_OUTER_R = 10;
const CRATER_RIM_R = 3.0;
const CRATER_FLOOR_R = 1.1;
const RIM_H = 5.2;
const FLOOR_H = 3.6;
// Sea-cave mouth: on the island perimeter, facing the world centre so
// the kid sees the dark opening from spawn.
const MOUTH_DIR = (() => {
  const len = Math.hypot(-ISLAND.x, -ISLAND.z);
  return { x: -ISLAND.x / len, z: -ISLAND.z / len };
})();
// How far along the mouth ray (from the island centre) things sit:
// the cave's back wall, the glowing arch, and the trigger point the
// boat has to reach. All inside the carved channel below.
const CAVE_WALL_ALONG = 2.6;
const CAVE_ARCH_ALONG = 4.55;
const MOUTH_ALONG = 4.7;
// Where the rumble drags the boat to — deep enough to sit in the dark
// under the tunnel roof, shy of the back-wall collision fence.
const SWALLOW_ALONG = 4.5;
const MOUTH = {
  x: ISLAND.x + MOUTH_DIR.x * MOUTH_ALONG,
  z: ISLAND.z + MOUTH_DIR.z * MOUTH_ALONG,
};
// Wide enough to swallow the whole channel: any line the boat can take
// through the inlet passes inside this circle, so approaching at an
// angle can't sneak past the trigger and bonk the back wall instead.
const MOUTH_TRIGGER_R = 2.2;
// Sea-level inlet carved into the cone so the boat can sail INTO the
// mountain instead of driving up its flank. Full-depth carve within
// CHANNEL_HALF_W of the mouth ray, feathering to untouched rock by
// CHANNEL_FADE_W; the carve only applies outward of the back wall.
const CHANNEL_HALF_W = 2.15;
const CHANNEL_FADE_W = 3.8;
// The inlet is dredged as well as carved: its floor is cut this far
// below sea level. The wave troughs reach about -0.22, so with the
// floor sitting at exactly y=0 the sea visibly drained out of the cave
// mouth on every swell and the boat looked beached on its way in.
// Dredging keeps water over the channel at all times.
//
// This lowers the *rendered seabed only*. islandHeight — what the boat
// drives on, what the collision fence probes, what the wake's
// over-water test reads — still bottoms out at 0, so the boat goes on
// floating at the wave surface all the way into the dark instead of
// sliding down into the trench.
const CHANNEL_DREDGE = 0.7;
function channelMask(lx: number, lz: number): number {
  const along = lx * MOUTH_DIR.x + lz * MOUTH_DIR.z;
  const wallBlend = smoothstep01((along - (CAVE_WALL_ALONG - 0.6)) / 1.2);
  if (wallBlend <= 0) return 1;
  const perp = Math.abs(lx * -MOUTH_DIR.z + lz * MOUTH_DIR.x);
  const carve = 1 - smoothstep01((perp - CHANNEL_HALF_W) / (CHANNEL_FADE_W - CHANNEL_HALF_W));
  return 1 - wallBlend * carve;
}
function islandHeight(x: number, z: number): number {
  const lx = x - ISLAND.x;
  const lz = z - ISLAND.z;
  return volcanoProfile(Math.hypot(lx, lz)) * channelMask(lx, lz);
}
const RUMBLE_SECONDS = 1.0;
const COOLDOWN_SECONDS = 3.5;

// ── Sandy islands (letters can land on these; palms live here) ─────
const SAND_ISLANDS = [
  { x: 18, z: 10, r: 5.0, h: 0.9 },
  { x: -6, z: 21, r: 4.0, h: 0.75 },
  { x: 11, z: -19, r: 4.4, h: 0.8 },
];

function smoothstep01(t: number): number {
  const k = Math.min(1, Math.max(0, t));
  return k * k * (3 - 2 * k);
}

function volcanoProfile(d: number): number {
  if (d >= ISLAND_OUTER_R) return 0;
  if (d <= CRATER_FLOOR_R) return FLOOR_H;
  if (d <= CRATER_RIM_R) {
    const t = (d - CRATER_FLOOR_R) / (CRATER_RIM_R - CRATER_FLOOR_R);
    return FLOOR_H + (RIM_H - FLOOR_H) * smoothstep01(t);
  }
  const t = (d - CRATER_RIM_R) / (ISLAND_OUTER_R - CRATER_RIM_R);
  return RIM_H * (1 - smoothstep01(t));
}

function sandHeight(x: number, z: number): number {
  let h = 0;
  for (const s of SAND_ISLANDS) {
    const d = Math.hypot(x - s.x, z - s.z);
    if (d < s.r) h = Math.max(h, s.h * (1 - smoothstep01(d / s.r)));
  }
  return h;
}

export const oceanBiome: Biome = {
  id: "ocean",
  label: "Ocean",
  emoji: "🌊",
  recommendedAvatar: "boat",
  applyScene(scene) {
    const prevBg = scene.background;
    const prevFog = scene.fog;
    const tod = rollTimeOfDay("ocean", OCEAN_POOL);
    const m = OCEAN_MOODS[tod as keyof typeof OCEAN_MOODS];
    scene.background = new THREE.Color(m.bg);
    scene.fog = new THREE.Fog(m.fogColor, m.fogNear, m.fogFar);
    const hemi = new THREE.HemisphereLight(m.hemiSky, m.hemiGround, m.hemiIntensity);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(m.sunColor, m.sunIntensity);
    sun.position.set(m.sunPos[0], m.sunPos[1], m.sunPos[2]);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -45;
    sun.shadow.camera.right = 45;
    sun.shadow.camera.top = 45;
    sun.shadow.camera.bottom = -45;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 110;
    sun.shadow.bias = -0.0005;
    scene.add(sun);
    const ambient = new THREE.AmbientLight(m.ambientColor, m.ambientIntensity);
    scene.add(ambient);
    return () => {
      scene.remove(hemi);
      scene.remove(sun);
      scene.remove(ambient);
      sun.dispose();
      scene.background = prevBg;
      scene.fog = prevFog;
    };
  },
  buildProps,
};

function buildProps(ctx: BiomeContext): void {
  const { group, obstacles, tick, worldRadius, getPlayerPosition, setTerrainHeight, launchPlayer } = ctx;

  // ── Wave field ───────────────────────────────────────────────────
  // Three traveling sines at different wavelengths/directions. waveT
  // is advanced by the tick below; the terrain sampler closes over it
  // so the boat (via the engine's terrain-follow + tilt) genuinely
  // rides the same swells the mesh shows.
  let waveT = 0;
  const waveHeight = (x: number, z: number): number => {
    return (
      Math.sin(x * 0.55 + waveT * 1.4) * 0.085 +
      Math.sin(z * 0.42 - waveT * 1.1 + 1.7) * 0.075 +
      Math.sin((x + z) * 0.3 + waveT * 0.8 + 4.0) * 0.06
    );
  };
  // Waves flatten as ground rises out of the sea (beaches, volcano).
  const sampleGround = (x: number, z: number): number => {
    const solid = islandHeight(x, z) + sandHeight(x, z);
    const damp = Math.max(0, 1 - solid * 3);
    return solid + waveHeight(x, z) * damp;
  };
  setTerrainHeight(sampleGround);

  // ── Water surface ────────────────────────────────────────────────
  // Faceted disc whose vertex Ys are re-sampled from the wave field
  // every frame. flatShading derives normals in-shader, so animating
  // positions is all it takes for the light to glitter across facets.
  // Vertex colours paint turquoise shallows around every island and
  // deep blue open water elsewhere.
  const WATER_RINGS = 26;
  const WATER_SEGS = 72;
  const waterRadius = worldRadius + 30;
  const waterGeo = (() => {
    const positions: number[] = [0, 0, 0];
    for (let r = 1; r <= WATER_RINGS; r++) {
      // Bias ring spacing toward the centre so the play zone gets the
      // most facet resolution.
      const t = r / WATER_RINGS;
      const ringR = t * t * 0.35 * waterRadius + t * 0.65 * waterRadius;
      for (let s = 0; s < WATER_SEGS; s++) {
        const th = (s / WATER_SEGS) * Math.PI * 2;
        positions.push(Math.cos(th) * ringR, 0, Math.sin(th) * ringR);
      }
    }
    const indices: number[] = [];
    for (let s = 0; s < WATER_SEGS; s++) {
      indices.push(0, 1 + ((s + 1) % WATER_SEGS), 1 + s);
    }
    for (let r = 1; r < WATER_RINGS; r++) {
      const inner = 1 + (r - 1) * WATER_SEGS;
      const outer = 1 + r * WATER_SEGS;
      for (let s = 0; s < WATER_SEGS; s++) {
        const i0 = inner + s;
        const i1 = inner + ((s + 1) % WATER_SEGS);
        const o0 = outer + s;
        const o1 = outer + ((s + 1) % WATER_SEGS);
        indices.push(i0, i1, o1, i0, o1, o0);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    g.setIndex(indices);
    g.computeVertexNormals();
    return g;
  })();
  {
    const pos = waterGeo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const deep = new THREE.Color(0x1f6fae);
    const mid = new THREE.Color(0x2f8fc4);
    const shallow = new THREE.Color(0x6fd4d8);
    const tmp = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      // Shallowness = proximity to any island shore.
      let sh = 0;
      const dv = Math.hypot(x - ISLAND.x, z - ISLAND.z);
      sh = Math.max(sh, 1 - Math.min(1, Math.max(0, dv - ISLAND_OUTER_R * 0.5) / 8));
      for (const s of SAND_ISLANDS) {
        const d = Math.hypot(x - s.x, z - s.z);
        sh = Math.max(sh, 1 - Math.min(1, Math.max(0, d - s.r * 0.4) / 6));
      }
      const n = Math.sin(x * 0.21 + z * 0.17) * 0.5 + 0.5;
      tmp.copy(deep).lerp(mid, n * 0.6);
      tmp.lerp(shallow, sh * 0.85);
      colors[i * 3 + 0] = tmp.r;
      colors[i * 3 + 1] = tmp.g;
      colors[i * 3 + 2] = tmp.b;
    }
    waterGeo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  }
  const water = new THREE.Mesh(
    waterGeo,
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      color: 0xffffff,
      roughness: 0.35,
      metalness: 0.05,
      flatShading: true,
    })
  );
  water.receiveShadow = true;
  group.add(water);
  // Animate only the verts near the play zone — the far skirt can sit
  // still under fog and nobody will ever know.
  {
    const pos = waterGeo.attributes.position;
    const animCount = (() => {
      let n = pos.count;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const z = pos.getZ(i);
        if (Math.hypot(x, z) > worldRadius + 12) {
          n = i;
          break;
        }
      }
      return n;
    })();
    tick.push((dt) => {
      waveT += dt;
      for (let i = 0; i < animCount; i++) {
        pos.setY(i, waveHeight(pos.getX(i), pos.getZ(i)));
      }
      pos.needsUpdate = true;
    });
  }
  // Deep-sea skirt beyond the water disc.
  const skirt = new THREE.Mesh(
    new THREE.RingGeometry(waterRadius - 2, waterRadius + 60, 48),
    new THREE.MeshStandardMaterial({ color: 0x175a90, roughness: 0.6, side: THREE.DoubleSide })
  );
  skirt.rotation.x = -Math.PI / 2;
  skirt.position.y = -0.12;
  group.add(skirt);

  // ── Boat wake — the water actually parting ───────────────────────
  // A ribbon rebuilt every frame along the avatar's recent path over
  // water. Each cross-section is a parted-water profile: raised foam
  // ridges at the edges, a churned trough down the middle, feathering
  // to ambient water at the outer lip. The ribbon rides the same wave
  // field as the sea and fades with age, so it reads as displaced
  // water rather than a sticker. Works for any avatar the kid drives
  // — no wake while airborne or beached.
  {
    const TRAIL_MAX = 26;
    const TRAIL_LIFE = 1.9; // seconds a sample lives
    const TRAIL_SPACING = 0.55;
    const CROSS = 7; // verts per cross-section
    type TrailSample = { x: number; z: number; px: number; pz: number; age: number };
    const trail: TrailSample[] = [];
    let lastX = 0;
    let lastZ = 0;
    let haveLast = false;

    const maxVerts = (TRAIL_MAX + 1) * CROSS;
    const wakeGeo = new THREE.BufferGeometry();
    const wakePos = new Float32Array(maxVerts * 3);
    const wakeCol = new Float32Array(maxVerts * 4);
    wakeGeo.setAttribute("position", new THREE.BufferAttribute(wakePos, 3));
    wakeGeo.setAttribute("color", new THREE.BufferAttribute(wakeCol, 4));
    const wakeIdx: number[] = [];
    for (let s = 0; s < TRAIL_MAX; s++) {
      const a = s * CROSS;
      const b = (s + 1) * CROSS;
      for (let c = 0; c < CROSS - 1; c++) {
        wakeIdx.push(a + c, b + c, b + c + 1, a + c, b + c + 1, a + c + 1);
      }
    }
    wakeGeo.setIndex(wakeIdx);
    wakeGeo.setDrawRange(0, 0);
    const wakeMesh = new THREE.Mesh(
      wakeGeo,
      new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false })
    );
    wakeMesh.frustumCulled = false;
    group.add(wakeMesh);

    // Cross-section shape: offsets across the ribbon (×width) and the
    // matching height profile (×intensity) + foam whiteness per vert.
    const OFFS = [-1.5, -1.0, -0.45, 0, 0.45, 1.0, 1.5];
    const LIFT = [0, 1.0, -0.35, -0.8, -0.35, 1.0, 0];
    const FOAM = [0, 0.85, 0.35, 0.55, 0.35, 0.85, 0];
    const cWater = new THREE.Color(0x3f9fce);
    const cFoam = new THREE.Color(0xf2fdff);
    const tmpC = new THREE.Color();

    tick.push((dt) => {
      const p = getPlayerPosition();
      for (const s of trail) s.age += dt;
      while (trail.length && trail[trail.length - 1].age > TRAIL_LIFE) trail.pop();

      if (p) {
        const overWater = islandHeight(p.x, p.z) + sandHeight(p.x, p.z) < 0.05 && p.y < 1.6;
        if (!haveLast) {
          lastX = p.x;
          lastZ = p.z;
          haveLast = true;
        }
        const dx = p.x - lastX;
        const dz = p.z - lastZ;
        const moved = Math.hypot(dx, dz);
        if (moved > 4) {
          // Teleport (eruption swallow / launch) — restart the trail.
          trail.length = 0;
          lastX = p.x;
          lastZ = p.z;
        } else if (moved > TRAIL_SPACING && overWater) {
          trail.unshift({ x: p.x, z: p.z, px: -dz / moved, pz: dx / moved, age: 0 });
          if (trail.length > TRAIL_MAX) trail.pop();
          lastX = p.x;
          lastZ = p.z;
        }
      }

      const count = trail.length;
      if (count < 2) {
        wakeGeo.setDrawRange(0, 0);
        return;
      }
      for (let i = 0; i < count; i++) {
        const s = trail[i];
        const k = s.age / TRAIL_LIFE; // 0 fresh → 1 gone
        const fade = 1 - k;
        // The channel widens and shallows as it ages — water closing
        // back over the boat's path.
        const width = 0.7 + k * 1.9;
        const intensity = 0.14 * fade;
        const alpha = 0.75 * fade;
        for (let c = 0; c < CROSS; c++) {
          const off = OFFS[c] * width;
          const x = s.x + s.px * off;
          const z = s.z + s.pz * off;
          const y = waveHeight(x, z) + LIFT[c] * intensity + 0.05;
          const vi = i * CROSS + c;
          wakePos[vi * 3 + 0] = x;
          wakePos[vi * 3 + 1] = y;
          wakePos[vi * 3 + 2] = z;
          tmpC.copy(cWater).lerp(cFoam, FOAM[c] * fade);
          wakeCol[vi * 4 + 0] = tmpC.r;
          wakeCol[vi * 4 + 1] = tmpC.g;
          wakeCol[vi * 4 + 2] = tmpC.b;
          wakeCol[vi * 4 + 3] = FOAM[c] === 0 ? 0 : alpha;
        }
      }
      wakeGeo.attributes.position.needsUpdate = true;
      wakeGeo.attributes.color.needsUpdate = true;
      wakeGeo.setDrawRange(0, (count - 1) * (CROSS - 1) * 6);
    });
  }

  // ── Volcano island ───────────────────────────────────────────────
  const volcanoGroup = new THREE.Group();
  volcanoGroup.position.set(ISLAND.x, 0, ISLAND.z);
  group.add(volcanoGroup);
  // Keep letters and props off the island (non-solid so effects/boat
  // aren't blocked by an invisible wall — real collision is the ring
  // of solid stones below, which leaves a gap at the cave mouth).
  obstacles.push({ x: ISLAND.x, z: ISLAND.z, radius: ISLAND_OUTER_R + 1, solid: false });

  {
    // The carved cone is a heightfield (one Y per XZ), so build it as
    // a polar grid displaced by the exact same islandHeight math the
    // terrain sampler uses. The earlier LatheGeometry + carve approach
    // folded faces where the channel cut through rings — the flipped
    // triangles got backface-culled and the mountain looked
    // translucent. A heightfield can't fold, so it renders solid from
    // every angle and matches the drivable surface exactly.
    const RINGS = 36;
    const SEGS = 72;
    const positions: number[] = [0, volcanoProfile(0), 0];
    for (let r = 1; r <= RINGS; r++) {
      const ringR = (r / RINGS) * ISLAND_OUTER_R;
      for (let s = 0; s < SEGS; s++) {
        const th = (s / SEGS) * Math.PI * 2;
        positions.push(Math.cos(th) * ringR, 0, Math.sin(th) * ringR);
      }
    }
    const indices: number[] = [];
    for (let s = 0; s < SEGS; s++) {
      indices.push(0, 1 + ((s + 1) % SEGS), 1 + s);
    }
    for (let r = 1; r < RINGS; r++) {
      const inner = 1 + (r - 1) * SEGS;
      const outer = 1 + r * SEGS;
      for (let s = 0; s < SEGS; s++) {
        const i0 = inner + s;
        const i1 = inner + ((s + 1) % SEGS);
        const o0 = outer + s;
        const o1 = outer + ((s + 1) % SEGS);
        indices.push(i0, i1, o1, i0, o1, o0);
      }
    }
    const coneGeo = new THREE.BufferGeometry();
    coneGeo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    coneGeo.setIndex(indices);
    const pos = coneGeo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const cSand = new THREE.Color(0xe8d49a);
    const cWet = new THREE.Color(0x6f7a6a);
    const cRock = new THREE.Color(0x7a5f4a);
    const cScorch = new THREE.Color(0x453832);
    const cGlow = new THREE.Color(0xff7a2a);
    const tmp = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const d = Math.hypot(x, z);
      const mask = channelMask(x, z);
      const masked = volcanoProfile(d) * mask;
      // How far this vert is dredged below sea level — full depth in
      // the carved channel, tapering to nothing in the feather band
      // and zero everywhere the mask leaves the rock alone.
      const dredge = CHANNEL_DREDGE * (1 - mask);
      // Rocky jitter everywhere except the crater floor and the
      // carved channel floor, both of which should stay smooth.
      if (d > CRATER_FLOOR_R + 0.3 && masked > 0.25) {
        const n = Math.sin(x * 4.7 + z * 3.9) * Math.cos(x * 2.1 - z * 5.3);
        pos.setY(i, masked + n * 0.16 * mask - dredge);
      } else {
        pos.setY(i, masked - dredge);
      }
      const h = masked / RIM_H;
      if (d < CRATER_RIM_R && mask > 0.5) {
        tmp.copy(cScorch).lerp(cGlow, Math.min(1, Math.max(0, 1.1 - d / CRATER_RIM_R)) * 0.55);
      } else {
        // Sandy beach ring at the waterline, rock above, scorched rim.
        tmp.copy(cSand).lerp(cRock, Math.min(1, h * 2.4));
        if (h > 0.8) tmp.lerp(cScorch, (h - 0.8) * 4.5);
        // Dredged ground is submerged (or about to be) — darken it to
        // wet sand so the feather band at the channel lip doesn't read
        // as dry beach right where the water starts.
        if (dredge > 0.02) tmp.lerp(cWet, Math.min(1, dredge / CHANNEL_DREDGE));
      }
      colors[i * 3 + 0] = tmp.r;
      colors[i * 3 + 1] = tmp.g;
      colors[i * 3 + 2] = tmp.b;
    }
    coneGeo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    coneGeo.computeVertexNormals();
    const cone = new THREE.Mesh(
      coneGeo,
      new THREE.MeshStandardMaterial({ vertexColors: true, color: 0xffffff, roughness: 1, flatShading: true })
    );
    cone.castShadow = true;
    cone.receiveShadow = true;
    volcanoGroup.add(cone);
  }

  // Invisible collision fence traced around the island's knee-height
  // contour: every grid cell that sits on the boundary between
  // wadeable and climbable ground gets a solid post, so the flank is
  // sealed from every direction while the cave corridor — the only
  // stretch that stays below knee height the whole way in — is left
  // wide open. (The visible flank boulders are dressing on top.)
  //
  // This walks a grid rather than one post per compass bearing on
  // purpose. A bearing walk stops at the FIRST crossing along each
  // ray, which puts the channel's posts deep at its back wall and
  // leaves its LATERAL walls unfenced — so a boat could sail into the
  // inlet, turn sideways, and drive straight up the flank from
  // inside. Following the contour instead fences those walls too.
  {
    const FENCE_H = 0.5;
    const STEP = 0.35;
    // Posts are spaced closer than 2× their radius, so consecutive
    // discs always overlap and the fence has no seams.
    const SPACING = 0.85;
    const POST_R = 0.75;
    const posts: { x: number; z: number }[] = [];
    for (let x = ISLAND.x - ISLAND_OUTER_R; x <= ISLAND.x + ISLAND_OUTER_R; x += STEP) {
      for (let z = ISLAND.z - ISLAND_OUTER_R; z <= ISLAND.z + ISLAND_OUTER_R; z += STEP) {
        if (islandHeight(x, z) < FENCE_H) continue;
        // Keep only the rim of the climbable region — a cell with at
        // least one wadeable neighbour. Interior cells would just pile
        // up redundant obstacles.
        if (
          islandHeight(x + STEP, z) >= FENCE_H &&
          islandHeight(x - STEP, z) >= FENCE_H &&
          islandHeight(x, z + STEP) >= FENCE_H &&
          islandHeight(x, z - STEP) >= FENCE_H
        ) {
          continue;
        }
        let tooClose = false;
        for (const p of posts) {
          if (Math.hypot(x - p.x, z - p.z) < SPACING) {
            tooClose = true;
            break;
          }
        }
        if (tooClose) continue;
        posts.push({ x, z });
        obstacles.push({ x, z, radius: POST_R });
      }
    }
  }

  // Sea-cave mouth — a dark arch + black interior plane set into the
  // flank, facing the world centre. Pure dressing; the "cave" itself
  // is the trigger zone in front of it.
  {
    const mouthLocal = {
      x: MOUTH_DIR.x * CAVE_ARCH_ALONG,
      z: MOUTH_DIR.z * CAVE_ARCH_ALONG,
    };
    const caveGroup = new THREE.Group();
    caveGroup.position.set(mouthLocal.x, 0, mouthLocal.z);
    caveGroup.lookAt(MOUTH_DIR.x * 100, 0, MOUTH_DIR.z * 100);
    volcanoGroup.add(caveGroup);
    // Tunnel roof — a half-pipe laid along the inlet so the boat
    // drives INTO the mountain, under rock, into the dark. DoubleSide
    // so the interior reads as cave walls from inside. Its radius
    // tracks CHANNEL_HALF_W so the pipe meets the carved rock walls
    // rather than floating inside them, and it runs long enough that
    // SWALLOW_ALONG sits a good metre back under the roof.
    const tunnelGeo = new THREE.CylinderGeometry(
      CHANNEL_HALF_W,
      CHANNEL_HALF_W,
      3.2,
      14,
      1,
      true,
      0,
      Math.PI
    );
    tunnelGeo.rotateZ(Math.PI / 2);
    tunnelGeo.rotateY(Math.PI / 2);
    const tunnel = new THREE.Mesh(
      tunnelGeo,
      new THREE.MeshStandardMaterial({ color: 0x2e241c, roughness: 1, side: THREE.DoubleSide })
    );
    tunnel.position.set(0, 0.1, -0.6);
    tunnel.castShadow = true;
    caveGroup.add(tunnel);
    // Black back wall deep inside — the "bottomless dark" the boat
    // disappears toward. Sits at the far end of the pipe, right about
    // where the carve blends back into solid rock.
    const hole = new THREE.Mesh(
      new THREE.CircleGeometry(CHANNEL_HALF_W - 0.05, 20, 0, Math.PI),
      new THREE.MeshBasicMaterial({ color: 0x0a0806, side: THREE.DoubleSide })
    );
    hole.position.set(0, 0.1, -2.15);
    caveGroup.add(hole);
    // Rocky arch framing the tunnel entrance, parked on the pipe's
    // outer lip so it reads as the mouth you steer through.
    const archMat = new THREE.MeshStandardMaterial({ color: 0x5c4a3c, roughness: 1 });
    const arch = new THREE.Mesh(
      new THREE.TorusGeometry(CHANNEL_HALF_W - 0.1, 0.42, 8, 16, Math.PI),
      archMat
    );
    arch.position.set(0, 0.1, 0.95);
    caveGroup.add(arch);
    // Warm glow from deep inside, spilling toward the entrance.
    const caveLight = new THREE.PointLight(0xff6a2a, 1.1, 10);
    caveLight.position.set(0, 0.8, -1.2);
    caveGroup.add(caveLight);
    tick.push((_dt, t) => {
      caveLight.intensity = 0.9 + Math.sin(t * 3.1) * 0.25 + Math.sin(t * 7.3) * 0.12;
    });
  }

  // Collision ring around the island with a gap at the mouth so the
  // boat can only get "inside" through the cave. Stones double as
  // visible wave-breaker rocks.
  {
    const stoneMat = new THREE.MeshStandardMaterial({ color: 0x6a584a, roughness: 1 });
    const RING_R = ISLAND_OUTER_R * 0.66;
    const COUNT = 12;
    const mouthAngle = Math.atan2(MOUTH_DIR.z, MOUTH_DIR.x);
    for (let i = 0; i < COUNT; i++) {
      const a = (i / COUNT) * Math.PI * 2;
      // Leave a gap of ±~40° around the cave mouth.
      let delta = a - mouthAngle;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      if (Math.abs(delta) < 0.7) continue;
      const x = ISLAND.x + Math.cos(a) * RING_R;
      const z = ISLAND.z + Math.sin(a) * RING_R;
      obstacles.push({ x, z, radius: 1.9 });
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.8 + (i % 3) * 0.25, 0), stoneMat);
      rock.position.set(x, sampleGround(x, z) + 0.2, z);
      rock.rotation.set(i * 1.3, i * 2.1, i * 0.7);
      rock.castShadow = true;
      group.add(rock);
    }
  }

  // Lava pool + glow light in the crater.
  const lavaMat = new THREE.MeshStandardMaterial({
    color: 0xff6a1a,
    emissive: 0xff4400,
    emissiveIntensity: 1.1,
    roughness: 0.6,
  });
  const lava = new THREE.Mesh(new THREE.CircleGeometry(CRATER_FLOOR_R + 0.5, 24), lavaMat);
  lava.rotation.x = -Math.PI / 2;
  lava.position.y = FLOOR_H + 0.04;
  volcanoGroup.add(lava);
  const lavaLight = new THREE.PointLight(0xff5a1a, 1.4, 18);
  lavaLight.position.y = FLOOR_H + 1.2;
  volcanoGroup.add(lavaLight);

  // Crater smoke — same recycled-puff column as the jungle volcano.
  const SMOKE_COUNT = 9;
  const smokePuffs: { mesh: THREE.Mesh; age: number; lifetime: number; drift: number }[] = [];
  for (let i = 0; i < SMOKE_COUNT; i++) {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(0.5, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0x8a8078, transparent: true, opacity: 0, depthWrite: false })
    );
    volcanoGroup.add(m);
    smokePuffs.push({
      mesh: m,
      age: (i / SMOKE_COUNT) * 3,
      lifetime: 2.6 + Math.random() * 1.2,
      drift: Math.random() * Math.PI * 2,
    });
  }

  // ── Lava bombs + water effects pools ─────────────────────────────
  type Bomb = { mesh: THREE.Mesh; active: boolean; vel: THREE.Vector3; spin: THREE.Vector3 };
  const BOMB_COUNT = 14;
  const bombs: Bomb[] = [];
  const bombPalette = [0xff5a1a, 0xff7a2a, 0xffb03a];
  for (let i = 0; i < BOMB_COUNT; i++) {
    const color = bombPalette[i % bombPalette.length];
    const m = new THREE.Mesh(
      new THREE.DodecahedronGeometry(0.16 + Math.random() * 0.14, 0),
      new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.9, roughness: 0.5 })
    );
    m.visible = false;
    m.castShadow = true;
    group.add(m);
    bombs.push({ mesh: m, active: false, vel: new THREE.Vector3(), spin: new THREE.Vector3() });
  }

  // Foam rings — expanding flattened tori used for every water impact
  // (lava bombs, fish re-entry, the big splashdown).
  type Foam = { mesh: THREE.Mesh; t: number; grow: number };
  const FOAM_COUNT = 18;
  const foams: Foam[] = [];
  for (let i = 0; i < FOAM_COUNT; i++) {
    const m = new THREE.Mesh(
      new THREE.TorusGeometry(0.5, 0.09, 6, 20),
      new THREE.MeshBasicMaterial({ color: 0xf4ffff, transparent: true, opacity: 0, depthWrite: false })
    );
    m.rotation.x = -Math.PI / 2;
    m.visible = false;
    group.add(m);
    foams.push({ mesh: m, t: 1, grow: 1 });
  }
  let nextFoam = 0;
  function spawnFoam(x: number, z: number, scale: number): void {
    const f = foams[nextFoam];
    nextFoam = (nextFoam + 1) % FOAM_COUNT;
    f.t = 0;
    f.grow = scale;
    f.mesh.visible = true;
    f.mesh.position.set(x, 0.12, z);
    f.mesh.scale.setScalar(0.4 * scale);
  }
  // Splash droplets — white beads flung upward on a big splashdown.
  type Droplet = { mesh: THREE.Mesh; active: boolean; vel: THREE.Vector3 };
  const DROPLET_COUNT = 16;
  const droplets: Droplet[] = [];
  for (let i = 0; i < DROPLET_COUNT; i++) {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xf4ffff, transparent: true, opacity: 0.9, depthWrite: false })
    );
    m.visible = false;
    group.add(m);
    droplets.push({ mesh: m, active: false, vel: new THREE.Vector3() });
  }
  function bigSplash(x: number, z: number): void {
    spawnFoam(x, z, 2.6);
    spawnFoam(x, z, 1.4);
    playSplash();
    for (const d of droplets) {
      d.active = true;
      d.mesh.visible = true;
      d.mesh.position.set(x, 0.15, z);
      const ang = Math.random() * Math.PI * 2;
      const horiz = 1 + Math.random() * 2.5;
      d.vel.set(Math.cos(ang) * horiz, 3.5 + Math.random() * 3, Math.sin(ang) * horiz);
    }
  }

  function fireBomb(big: boolean): void {
    const bomb = bombs.find((b) => !b.active);
    if (!bomb) return;
    bomb.active = true;
    bomb.mesh.visible = true;
    bomb.mesh.position.set(ISLAND.x, FLOOR_H + 0.6, ISLAND.z);
    const ang = Math.random() * Math.PI * 2;
    const horiz = big ? 3 + Math.random() * 5 : 1.4 + Math.random() * 2.4;
    bomb.vel.set(Math.cos(ang) * horiz, big ? 9.5 + Math.random() * 5 : 6 + Math.random() * 2.5, Math.sin(ang) * horiz);
    bomb.spin.set((Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10);
  }

  // ── Eruption state machine ───────────────────────────────────────
  let state: "idle" | "rumbling" | "cooldown" = "idle";
  let stateT = 0;
  let fountainT = 0;
  let bombAccum = 0;
  let wooTimer = -1;
  let sputterIn = 4 + Math.random() * 5;

  function pickWaterLanding(): { x: number; z: number } {
    for (let i = 0; i < 30; i++) {
      const ang = Math.random() * Math.PI * 2;
      const dist = 12 + Math.random() * (worldRadius - 8 - 12);
      const x = Math.cos(ang) * dist;
      const z = Math.sin(ang) * dist;
      if (Math.hypot(x - ISLAND.x, z - ISLAND.z) < ISLAND_OUTER_R + 5) continue;
      // Prefer open water: skip sandy islands so the payoff is always
      // the splash.
      if (sandHeight(x, z) > 0.02) continue;
      let clear = true;
      for (const o of obstacles) {
        if (o.solid === false) continue;
        if (Math.hypot(x - o.x, z - o.z) < o.radius + 1.4) {
          clear = false;
          break;
        }
      }
      if (clear) return { x, z };
    }
    return { x: 10, z: 8 };
  }

  tick.push((dt, t) => {
    const player = getPlayerPosition();

    const pulse = 0.9 + Math.sin(t * 2.1) * 0.2 + Math.sin(t * 5.7) * 0.1;
    lavaMat.emissiveIntensity = pulse * (state === "rumbling" ? 1.8 : 1.1);
    lavaLight.intensity = pulse * (state === "rumbling" ? 2.6 : 1.4) + (fountainT > 0 ? 1.2 : 0);

    const smokeBoost = state === "rumbling" ? 2.2 : fountainT > 0 ? 3 : 1;
    for (const p of smokePuffs) {
      p.age += dt * (0.9 * smokeBoost);
      if (p.age >= p.lifetime) {
        p.age -= p.lifetime;
        p.lifetime = 2.4 + Math.random() * 1.4;
        p.drift = Math.random() * Math.PI * 2;
      }
      const k = p.age / p.lifetime;
      const sway = Math.sin(p.drift + k * 5) * 0.5 * k;
      p.mesh.position.set(
        Math.cos(p.drift) * 0.4 + sway,
        FLOOR_H + 0.9 + k * (5 * Math.min(smokeBoost, 2)),
        Math.sin(p.drift) * 0.4 + sway * 0.6
      );
      p.mesh.scale.setScalar((0.5 + k * 2.2) * (smokeBoost > 1 ? 1.35 : 1));
      const fadeIn = Math.min(1, k / 0.15);
      const fadeOut = Math.max(0, 1 - (k - 0.15) / 0.85);
      (p.mesh.material as THREE.MeshBasicMaterial).opacity =
        (0.16 + (smokeBoost - 1) * 0.12) * fadeIn * fadeOut;
    }

    if (state === "rumbling") {
      const ramp = stateT / RUMBLE_SECONDS;
      const amp = 0.05 + ramp * 0.1;
      volcanoGroup.position.set(
        ISLAND.x + (Math.random() - 0.5) * amp,
        (Math.random() - 0.5) * amp * 0.5,
        ISLAND.z + (Math.random() - 0.5) * amp
      );
    } else if (volcanoGroup.position.x !== ISLAND.x) {
      volcanoGroup.position.set(ISLAND.x, 0, ISLAND.z);
    }

    stateT += dt;
    if (state === "idle") {
      sputterIn -= dt;
      if (sputterIn <= 0) {
        sputterIn = 5 + Math.random() * 6;
        fireBomb(false);
        playLavaPop();
      }
      if (player) {
        const d = Math.hypot(player.x - MOUTH.x, player.z - MOUTH.z);
        if (d < MOUTH_TRIGGER_R) {
          state = "rumbling";
          stateT = 0;
          playVolcanoRumble();
        }
      }
    } else if (state === "rumbling") {
      // The mountain slurps the boat deeper into the tunnel while it
      // rumbles — by the boom, the kid is sitting in the dark.
      if (player) {
        const tx = ISLAND.x + MOUTH_DIR.x * SWALLOW_ALONG;
        const tz = ISLAND.z + MOUTH_DIR.z * SWALLOW_ALONG;
        const k = Math.min(1, dt * 3);
        player.x += (tx - player.x) * k;
        player.z += (tz - player.z) * k;
      }
      if (stateT >= RUMBLE_SECONDS) {
        state = "cooldown";
        stateT = 0;
        playVolcanoBoom();
        fountainT = 2.2;
        bombAccum = 0;
        wooTimer = 0.35;
        // The mountain swallowed the boat — pop it to the crater and
        // blast it out the top. The teleport happens the same frame
        // as the boom + fountain, so it reads as "shot out".
        const p = getPlayerPosition();
        if (p) {
          p.x = ISLAND.x;
          p.z = ISLAND.z;
        }
        const dest = pickWaterLanding();
        launchPlayer(dest, {
          duration: 1.8,
          peakY: 15,
          onLand: () => bigSplash(dest.x, dest.z),
        });
      }
    } else if (state === "cooldown") {
      if (stateT >= COOLDOWN_SECONDS) {
        state = "idle";
        stateT = 0;
        sputterIn = 2 + Math.random() * 3;
      }
    }

    if (wooTimer >= 0) {
      wooTimer -= dt;
      if (wooTimer < 0) playWoo();
    }

    if (fountainT > 0) {
      fountainT -= dt;
      bombAccum += dt * 7;
      while (bombAccum >= 1) {
        bombAccum -= 1;
        fireBomb(true);
      }
    }

    // Bomb physics — bombs that hit open water raise foam + a pop;
    // ones that fall back in the crater just vanish into the lava.
    for (const b of bombs) {
      if (!b.active) continue;
      b.vel.y -= 16 * dt;
      b.mesh.position.addScaledVector(b.vel, dt);
      b.mesh.rotation.x += b.spin.x * dt;
      b.mesh.rotation.y += b.spin.y * dt;
      b.mesh.rotation.z += b.spin.z * dt;
      const bx = b.mesh.position.x;
      const bz = b.mesh.position.z;
      if (b.vel.y < 0 && b.mesh.position.y <= sampleGround(bx, bz) + 0.12) {
        b.active = false;
        b.mesh.visible = false;
        if (Math.hypot(bx - ISLAND.x, bz - ISLAND.z) > CRATER_RIM_R) {
          spawnFoam(bx, bz, 0.9 + Math.random() * 0.5);
          playLavaPop();
        }
      }
    }
    // Foam rings expand + fade.
    for (const f of foams) {
      if (f.t >= 1) continue;
      f.t += dt / 1.1;
      const k = Math.min(1, f.t);
      f.mesh.scale.setScalar((0.4 + k * 1.8) * f.grow);
      (f.mesh.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - k * k);
      if (k >= 1) f.mesh.visible = false;
    }
    // Splash droplets — ballistic, die at the waterline with a
    // micro-ring.
    for (const d of droplets) {
      if (!d.active) continue;
      d.vel.y -= 14 * dt;
      d.mesh.position.addScaledVector(d.vel, dt);
      if (d.vel.y < 0 && d.mesh.position.y <= 0.1) {
        d.active = false;
        d.mesh.visible = false;
        if (Math.random() < 0.4) spawnFoam(d.mesh.position.x, d.mesh.position.z, 0.5);
      }
    }
  });

  // ── Sandy islands ────────────────────────────────────────────────
  const islandSandMat = new THREE.MeshStandardMaterial({ color: 0xf0dca0, roughness: 0.95 });
  const palmRand = mulberry32(freshSeed());
  for (const s of SAND_ISLANDS) {
    // Dome — flattened sphere; top pokes ~s.h above the waterline.
    const dome = new THREE.Mesh(new THREE.SphereGeometry(s.r, 20, 12), islandSandMat);
    dome.scale.set(1, (s.h * 2) / s.r, 1);
    dome.position.set(s.x, 0, s.z);
    dome.receiveShadow = true;
    dome.castShadow = false;
    group.add(dome);
    // One palm near the top of each island.
    const palm = makePalmTree(palmRand, 0.75 + palmRand() * 0.3);
    const offAng = palmRand() * Math.PI * 2;
    const px = s.x + Math.cos(offAng) * s.r * 0.3;
    const pz = s.z + Math.sin(offAng) * s.r * 0.3;
    palm.group.position.set(px, sandHeight(px, pz) - 0.05, pz);
    palm.group.rotation.y = palmRand() * Math.PI * 2;
    group.add(palm.group);
    obstacles.push({ x: px, z: pz, radius: 0.55, onBump: palm.shake });
    tick.push(palm.update);
  }

  // ── Jumping fish ─────────────────────────────────────────────────
  const fishRand = mulberry32(freshSeed());
  for (let i = 0; i < 6; i++) {
    const fish = makeFish(fishRand);
    group.add(fish.group);
    // Home waters — anywhere open, away from the volcano.
    let hx = 0;
    let hz = 0;
    for (let a = 0; a < 12; a++) {
      hx = (fishRand() - 0.5) * (worldRadius * 1.5);
      hz = (fishRand() - 0.5) * (worldRadius * 1.5);
      if (Math.hypot(hx - ISLAND.x, hz - ISLAND.z) > ISLAND_OUTER_R + 4 && sandHeight(hx, hz) === 0) break;
    }
    let phase: "under" | "jumping" = "under";
    let timer = 1 + fishRand() * 3;
    let jumpT = 0;
    let from = { x: hx, z: hz };
    let to = { x: hx, z: hz };
    let jumpDur = 1;
    let peak = 1.5;
    fish.group.visible = false;
    tick.push((dt) => {
      if (phase === "under") {
        timer -= dt;
        if (timer <= 0) {
          phase = "jumping";
          jumpT = 0;
          const ang = fishRand() * Math.PI * 2;
          const dist = 2 + fishRand() * 3;
          from = { x: hx, z: hz };
          to = { x: hx + Math.cos(ang) * dist, z: hz + Math.sin(ang) * dist };
          // Keep the school loosely anchored to its home patch.
          if (Math.hypot(to.x, to.z) > worldRadius + 8) to = { x: hx, z: hz };
          jumpDur = 0.9 + fishRand() * 0.4;
          peak = 1.2 + fishRand() * 1.0;
          fish.group.visible = true;
          spawnFoam(from.x, from.z, 0.5);
        }
        return;
      }
      jumpT += dt;
      const k = Math.min(1, jumpT / jumpDur);
      const x = from.x + (to.x - from.x) * k;
      const z = from.z + (to.z - from.z) * k;
      const y = peak * 4 * k * (1 - k);
      fish.group.position.set(x, y, z);
      // Face along the arc, nose following the parabola's slope.
      fish.group.rotation.y = Math.atan2(to.x - from.x, to.z - from.z);
      fish.group.rotation.x = -((1 - 2 * k) * 0.9);
      if (k >= 1) {
        phase = "under";
        timer = 1.5 + fishRand() * 3.5;
        fish.group.visible = false;
        spawnFoam(to.x, to.z, 0.55);
        hx = to.x;
        hz = to.z;
      }
    });
  }

  // ── Sea monster ──────────────────────────────────────────────────
  // One very friendly Nessie cruising a wide circle, dipping under
  // now and then. Non-solid — she's scenery with eyes.
  {
    const nessie = makeSeaMonster();
    group.add(nessie.group);
    const orbitR = 30;
    const speed = 0.1;
    let diveT = 0; // >0 while diving
    let nextDiveIn = 8 + Math.random() * 8;
    tick.push((dt, t) => {
      const ang = t * speed;
      const x = Math.cos(ang) * orbitR;
      const z = Math.sin(ang) * orbitR;
      nextDiveIn -= dt;
      if (nextDiveIn <= 0 && diveT === 0) {
        diveT = 6; // dive cycle: sink 1.5s, under 3s, rise 1.5s
        spawnFoam(x, z, 1.6);
      }
      let sink = 0;
      if (diveT > 0) {
        diveT = Math.max(0, diveT - dt);
        const dk = 6 - diveT;
        if (dk < 1.5) sink = (dk / 1.5) * 3;
        else if (diveT < 1.5) sink = (diveT / 1.5) * 3;
        else sink = 3;
        if (diveT === 0) {
          nextDiveIn = 10 + Math.random() * 10;
          spawnFoam(x, z, 1.6);
        }
      }
      nessie.group.position.set(x, waveHeight(x, z) - sink, z);
      // Face along the direction of travel (tangent of the circle).
      nessie.group.rotation.y = Math.atan2(-Math.sin(ang), Math.cos(ang)) + Math.PI / 2;
      nessie.tick(dt, t);
    });
  }

  // ── Distant islands on the horizon ───────────────────────────────
  const distRand = mulberry32(freshSeed());
  for (let i = 0; i < 7; i++) {
    const ang = (i / 7) * Math.PI * 2 + distRand() * 0.5;
    const dist = worldRadius + 18 + distRand() * 30;
    const x = Math.cos(ang) * dist;
    const z = Math.sin(ang) * dist;
    const r = 4 + distRand() * 7;
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(r, 14, 10),
      new THREE.MeshStandardMaterial({ color: 0x4a8a5a, roughness: 1 })
    );
    dome.scale.set(1, 0.35 + distRand() * 0.2, 1);
    dome.position.set(x, 0, z);
    group.add(dome);
  }

  // Clouds.
  const cloudRand = mulberry32(freshSeed());
  for (let i = 0; i < 10; i++) {
    const c = makeCloud();
    c.position.set((cloudRand() - 0.5) * 220, 16 + cloudRand() * 12, (cloudRand() - 0.5) * 220);
    c.scale.setScalar(1 + cloudRand() * 1.2);
    group.add(c);
  }

  // A few buoys bobbing on the waves for foreground charm.
  const buoyRand = mulberry32(freshSeed());
  for (let i = 0; i < 5; i++) {
    const spot = findOpenSpot(buoyRand, worldRadius - 6, 0.5, obstacles, { minRadius: 8 });
    if (!spot) continue;
    const buoy = makeBuoy(buoyRand);
    group.add(buoy);
    obstacles.push({ x: spot.x, z: spot.z, radius: 0.5 });
    tick.push((_dt, t) => {
      buoy.position.set(spot.x, waveHeight(spot.x, spot.z), spot.z);
      buoy.rotation.z = Math.sin(t * 1.3 + spot.x) * 0.12;
      buoy.rotation.x = Math.cos(t * 1.1 + spot.z) * 0.12;
    });
  }
}

// ─── Ocean prop factories ─────────────────────────────────────────────

// Chunky cartoon fish — flattened teardrop body + tail fin, in warm
// tropical colours.
function makeFish(rand: () => number) {
  const g = new THREE.Group();
  const hue = rand() < 0.5 ? 20 + rand() * 25 : 170 + rand() * 40;
  const bodyMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(`hsl(${hue}, 75%, 55%)`),
    roughness: 0.5,
  });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.32, 12, 10), bodyMat);
  body.scale.set(0.7, 0.9, 1.3);
  body.castShadow = true;
  g.add(body);
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.4, 4), bodyMat);
  tail.scale.x = 0.35;
  tail.position.z = -0.5;
  tail.rotation.x = Math.PI / 2;
  g.add(tail);
  const finMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(`hsl(${hue + 15}, 70%, 65%)`),
    roughness: 0.6,
    side: THREE.DoubleSide,
  });
  const fin = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.25, 4), finMat);
  fin.position.y = 0.3;
  g.add(fin);
  // Googly eye pair.
  const whiteMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
  const pupilMat = new THREE.MeshStandardMaterial({ color: 0x222222 });
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8), whiteMat);
    eye.position.set(side * 0.18, 0.08, 0.22);
    g.add(eye);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 6), pupilMat);
    pupil.position.set(side * 0.2, 0.08, 0.27);
    g.add(pupil);
  }
  return { group: g };
}

// A very friendly Nessie: arched neck + head with googly eyes and
// little horns, followed by two humps. The neck sways gently.
function makeSeaMonster() {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x4fae8a, roughness: 0.6 });
  const bellyMat = new THREE.MeshStandardMaterial({ color: 0x9adDb8, roughness: 0.7 });

  const neckPivot = new THREE.Group();
  group.add(neckPivot);
  // Neck — arched stack of spheres so it reads as a smooth curve.
  const NECK = 5;
  for (let i = 0; i < NECK; i++) {
    const k = i / (NECK - 1);
    const seg = new THREE.Mesh(new THREE.SphereGeometry(0.42 - k * 0.1, 10, 8), bodyMat);
    seg.position.set(0, 0.4 + k * 1.5, k * 0.6 - Math.sin(k * Math.PI) * 0.25);
    seg.castShadow = true;
    neckPivot.add(seg);
  }
  // Head.
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 10), bodyMat);
  head.scale.set(0.9, 0.8, 1.15);
  head.position.set(0, 2.05, 0.75);
  head.castShadow = true;
  neckPivot.add(head);
  const snout = new THREE.Mesh(new THREE.SphereGeometry(0.24, 10, 8), bellyMat);
  snout.scale.set(0.9, 0.7, 1);
  snout.position.set(0, 1.92, 1.1);
  neckPivot.add(snout);
  const whiteMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
  const pupilMat = new THREE.MeshStandardMaterial({ color: 0x1c1422 });
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), whiteMat);
    eye.position.set(side * 0.2, 2.2, 1.0);
    neckPivot.add(eye);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), pupilMat);
    pupil.position.set(side * 0.22, 2.2, 1.1);
    neckPivot.add(pupil);
    // Nubby horn.
    const horn = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.2, 6), bellyMat);
    horn.position.set(side * 0.16, 2.48, 0.6);
    neckPivot.add(horn);
  }
  // Cheek blush — she's friendly.
  const blushMat = new THREE.MeshBasicMaterial({ color: 0xff7faa, transparent: true, opacity: 0.7, depthWrite: false });
  for (const side of [-1, 1]) {
    const blush = new THREE.Mesh(new THREE.CircleGeometry(0.07, 10), blushMat);
    blush.position.set(side * 0.33, 2.02, 1.02);
    blush.lookAt(side * 2, 2.0, 3);
    neckPivot.add(blush);
  }
  // Humps trailing behind.
  for (let i = 0; i < 2; i++) {
    const hump = new THREE.Mesh(new THREE.SphereGeometry(0.55 - i * 0.12, 12, 8), bodyMat);
    hump.scale.y = 0.6;
    hump.position.set(0, 0.15, -1.3 - i * 1.4);
    hump.castShadow = true;
    group.add(hump);
  }

  return {
    group,
    tick: (_dt: number, t: number) => {
      neckPivot.rotation.z = Math.sin(t * 0.9) * 0.08;
      neckPivot.rotation.x = Math.cos(t * 0.7) * 0.05;
    },
  };
}

// Classic red-and-white harbour buoy.
function makeBuoy(rand: () => number) {
  const g = new THREE.Group();
  const red = new THREE.MeshStandardMaterial({ color: 0xe6473a, roughness: 0.6 });
  const white = new THREE.MeshStandardMaterial({ color: 0xfff3da, roughness: 0.7 });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.5, 0.5, 10), red);
  base.position.y = 0.25;
  base.castShadow = true;
  g.add(base);
  const mid = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.4, 0.4, 10), white);
  mid.position.y = 0.68;
  g.add(mid);
  const top = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), red);
  top.position.y = 0.98;
  g.add(top);
  g.rotation.y = rand() * Math.PI * 2;
  return g;
}
