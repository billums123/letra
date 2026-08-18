import * as THREE from "three";
import type { Biome, BiomeContext } from "./types";
import { findOpenSpot, freshSeed, mulberry32, makeCloud } from "../world";
import { makePalmTree } from "./jungle";
import { buildSunWorld } from "./sun";
import { isDev } from "../../util/isDev";
import { rollTimeOfDay, type TimeOfDay } from "./timeOfDay";
import {
  playVolcanoRumble,
  playVolcanoBoom,
  playLavaPop,
  playSplash,
  playSmallSplash,
  playLavaSplash,
  playWoo,
  playFireworkBurst,
} from "../../audio/sfx";

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

// Amplitudes of the three travelling sines that make up the wave
// field (see waveHeight). Summed they give the highest crest — and,
// mirrored, the deepest trough — the sea can ever reach, which is the
// yardstick for "is this bit of ground under water or not": the cave
// dredge is measured against it, and so is every island's shoreline.
const WAVE_AMPS = [0.085, 0.075, 0.06] as const;
const WAVE_CREST = WAVE_AMPS[0] + WAVE_AMPS[1] + WAVE_AMPS[2];

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
// Where the cone's rendered rock face comes down at the cave mouth.
// See renderChannelMask below for why these live here.
const RENDER_WALL_ALONG = 5.35;
const RENDER_WALL_WIDTH = 0.18;
// Where the cave opening sits on the cliff face — just proud of it,
// so the black disc reads as set into the rock rather than buried.
const ARCH_MOUTH_ALONG = RENDER_WALL_ALONG + RENDER_WALL_WIDTH + 0.42;
const CAVE_ARCH_ALONG = 4.55;
const MOUTH_ALONG = 4.7;
// Where the darkness takes the avatar. This has to sit outside the
// cone's rock face — a heightfield can't overhang, so any point where
// rock is drawn is a point the boat would be standing inside it. It
// still lands inside the archway, which is pushed out past the face.
const SWALLOW_HIDE_ALONG = ARCH_MOUTH_ALONG + 0.12;
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
// below sea level. The wave troughs reach -WAVE_CREST, so with the
// floor sitting at exactly y=0 the sea visibly drained out of the cave
// mouth on every swell and the boat looked beached on its way in.
// Dredging keeps water over the channel at all times.
//
// This lowers the *rendered seabed only*. islandHeight — what the boat
// drives on, what the collision fence probes, what the wake's
// over-water test reads — still bottoms out at 0, so the boat goes on
// floating at the wave surface all the way into the dark instead of
// sliding down into the trench.
const CHANNEL_MIN_DEPTH = 0.48; // water left over the floor at low trough
const CHANNEL_DREDGE = WAVE_CREST + CHANNEL_MIN_DEPTH;
function maskAt(lx: number, lz: number, wallStart: number, wallWidth: number): number {
  const along = lx * MOUTH_DIR.x + lz * MOUTH_DIR.z;
  const wallBlend = smoothstep01((along - wallStart) / wallWidth);
  if (wallBlend <= 0) return 1;
  const perp = Math.abs(lx * -MOUTH_DIR.z + lz * MOUTH_DIR.x);
  const carve = 1 - smoothstep01((perp - CHANNEL_HALF_W) / (CHANNEL_FADE_W - CHANNEL_HALF_W));
  return 1 - wallBlend * carve;
}

// The carve the boat sails through: open from the back wall all the
// way out to sea. This is what collision, the fence contour and the
// terrain sampler read.
function channelMask(lx: number, lz: number): number {
  return maskAt(lx, lz, CAVE_WALL_ALONG - 0.6, 1.2);
}

// The carve the *cone mesh* is cut with, which stops much further out
// — right at the cave mouth — so the mountain stays solid over the
// tunnel and its rock face comes out to meet the archway. Cut it with
// the collision mask instead and the whole channel is gouged open from
// the back wall outward, leaving the tunnel as a bare tube lying in an
// empty trench with nothing around it.
//
// The two masks only disagree where the avatar is hidden anyway
// (inside the tunnel), so nothing can be seen standing on ground that
// isn't drawn. The blend is deliberately tight: a heightfield cannot
// overhang, so a wide blend gives a long shallow ramp that the tunnel
// crown pokes out of, while a narrow one reads as a cliff face with
// the cave cut into its foot. (Both constants are declared further
// up, next to the other cave measurements, because the swallow line
// is derived from them.)
function renderChannelMask(lx: number, lz: number): number {
  return maskAt(lx, lz, RENDER_WALL_ALONG, RENDER_WALL_WIDTH);
}
function islandHeight(x: number, z: number): number {
  const lx = x - ISLAND.x;
  const lz = z - ISLAND.z;
  return volcanoProfile(Math.hypot(lx, lz)) * channelMask(lx, lz);
}

// Layered sine noise. Four octaves at unrelated frequencies read as
// weathered rock; a single sine product (what this used to be) lays a
// visible waffle over the whole cone because its two factors keep
// lining up. Range is roughly [-1, 1].
function rockNoise(x: number, z: number): number {
  return (
    Math.sin(x * 0.83 + z * 1.31) * 0.5 +
    Math.sin(x * 2.27 - z * 1.09 + 1.7) * 0.27 +
    Math.sin(x * 4.13 + z * 3.31 + 4.2) * 0.15 +
    Math.sin(x * 7.91 - z * 6.73 + 2.1) * 0.08
  );
}

// The cone's *rendered* rock surface, in island-local coords: the
// carved profile, minus the dredge, plus all the weathering. Both the
// cone mesh and anything that has to lie ON it (the lava flows) read
// this one function, so they can never drift apart.
//
// Everything here is render-only. volcanoProfile stays a clean radial
// curve, so islandHeight — collision, the fence contour, the terrain
// the boat rides — is unaffected by any of this detail.
function coneSurfaceY(lx: number, lz: number): number {
  const d = Math.hypot(lx, lz);
  const mask = renderChannelMask(lx, lz);
  const masked = volcanoProfile(d) * mask;
  const dredge = CHANNEL_DREDGE * (1 - mask);
  // Leave the crater floor and the carved channel floor smooth.
  if (d <= CRATER_FLOOR_R + 0.3 || masked <= 0.25) return masked - dredge;

  const ang = Math.atan2(lz, lx);
  let h = masked;
  // General weathering, heavier low down where scree collects. Kept
  // modest on purpose: pushed much past this the cone stops reading as
  // a volcano at all and turns into a lumpy mound.
  const weather = 0.16 - 0.06 * (masked / RIM_H);
  h += rockNoise(lx, lz) * weather;
  // Erosion gullies fanning down the flanks. Strongest mid-slope and
  // fading out at both the rim and the shoreline, so the crater lip
  // stays crisp and the beach stays smooth. The wobble term keeps the
  // channels from being evenly spaced spokes.
  const flank = smoothstep01((d - CRATER_RIM_R) / 1.8) * (1 - smoothstep01((d - 6.5) / 3.5));
  h -= (Math.sin(ang * 8 + Math.sin(ang * 3.0) * 1.6) * 0.5 + 0.5) * flank * 0.22;
  // Scalloped crater lip — the rim is a broken ring of high points and
  // low notches rather than a machined circle.
  const rimBand = 1 - smoothstep01(Math.abs(d - CRATER_RIM_R) / 1.1);
  h += Math.sin(ang * 5 + 0.7) * 0.17 * rimBand + Math.sin(ang * 11 - 2.0) * 0.07 * rimBand;
  // Everything fades out through the carved channel so the inlet walls
  // stay clean and the boat's corridor keeps its shape.
  return masked + (h - masked) * mask - dredge;
}
// How long the mountain shakes before it fires. The ordinary eruption
// keeps its original snappy wind-up — that is the one the kid gets
// most of the time and it should stay quick. Only the mega-launch
// draws the build-up out, because you are about to be thrown into
// space and it should have time to feel ominous.
const RUMBLE_SECONDS = 1.0;
const MEGA_RUMBLE_SECONDS = 3.2;
// How often an eruption is a mega-launch. Deliberately the minority:
// the surprise is the point, and it stops being one if it is the norm.
const MEGA_CHANCE = 0.3;
const COOLDOWN_SECONDS = 3.5;

// ── Sandy islands (scenery; palms live here) ───────────────────────
// The boat is held offshore wherever the sand stands this far above
// mean sea level. Kept small deliberately: the boat should stop in
// real water at the dome's edge, not ride a length up the wet sand.
const SHORE_H = 0.03;
// How far the avatar's nose reaches beyond its collision circle. The
// engine models the avatar as a point with PLAYER_RADIUS = 0.55, but
// the tugboat's bow sticks out to z = 1.70, so stopping its *centre*
// at the shoreline drove a metre of hull into the sand. Landmass
// colliders are padded by the difference so the bow — not the centre —
// is what comes to rest at the water's edge.
const AVATAR_NOSE = 1.7 - 0.55;
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
  const {
    group,
    obstacles,
    tick,
    worldRadius,
    getPlayerPosition,
    setTerrainHeight,
    launchPlayer,
    setPlayerVisible,
    setCameraFocus,
    launchToPlanet,
    leavePlanet,
  } = ctx;

  // ── Wave field ───────────────────────────────────────────────────
  // Three traveling sines at different wavelengths/directions. waveT
  // is advanced by the tick below; the terrain sampler closes over it
  // so the boat (via the engine's terrain-follow + tilt) genuinely
  // rides the same swells the mesh shows.
  let waveT = 0;
  const waveHeight = (x: number, z: number): number => {
    return (
      Math.sin(x * 0.55 + waveT * 1.4) * WAVE_AMPS[0] +
      Math.sin(z * 0.42 - waveT * 1.1 + 1.7) * WAVE_AMPS[1] +
      Math.sin((x + z) * 0.3 + waveT * 0.8 + 4.0) * WAVE_AMPS[2]
    );
  };
  // Waves flatten as ground rises out of the sea (beaches, volcano).
  const sampleGround = (x: number, z: number): number => {
    const solid = islandHeight(x, z) + sandHeight(x, z);
    const damp = Math.max(0, 1 - solid * 3);
    return solid + waveHeight(x, z) * damp;
  };
  setTerrainHeight(sampleGround);

  // ── Swallowed-by-the-mountain test ───────────────────────────────
  // True while the avatar is inside the sea-cave tunnel. Two things
  // read it: the avatar is hidden (it should read as gone INTO the
  // mountain, waiting to be spat out, rather than parked nose-first
  // against a back wall), and the wake stops (no foam trail under
  // solid rock).
  //
  // Derived from position every frame rather than latched off the
  // eruption state machine, so it can't get stuck: back out of the
  // tunnel and the boat reappears, whatever the volcano is doing.
  // The height test keeps the launch visible — the boom teleports the
  // avatar to the crater floor, which is well above the tunnel.
  const SWALLOW_CEILING = 1.6;
  let swallowed = false;
  tick.push(() => {
    const p = getPlayerPosition();
    if (!p) return;
    const lx = p.x - ISLAND.x;
    const lz = p.z - ISLAND.z;
    const along = lx * MOUTH_DIR.x + lz * MOUTH_DIR.z;
    const perp = Math.abs(lx * -MOUTH_DIR.z + lz * MOUTH_DIR.x);
    const next =
      along > CAVE_WALL_ALONG &&
      along < SWALLOW_HIDE_ALONG &&
      perp < CHANNEL_HALF_W + 0.3 &&
      p.y < SWALLOW_CEILING;
    if (next !== swallowed) {
      swallowed = next;
      setPlayerVisible(!swallowed);
      // With the boat inside the mountain there is nothing to follow,
      // so pull the camera back onto the volcano itself — the kid
      // watches the crater they are about to come flying out of.
      // Clearing it at the boom hands the camera straight back to the
      // avatar for the flight, and because the avatar has just been
      // teleported to that same crater, the handover barely moves.
      setCameraFocus(
        swallowed ? { x: ISLAND.x, y: RIM_H * 0.55, z: ISLAND.z, zoom: 1.55 } : null
      );
    }
  });

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
        const overWater =
          !swallowed && islandHeight(p.x, p.z) + sandHeight(p.x, p.z) < 0.05 && p.y < 1.6;
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

  // ── The sun, as a place ──────────────────────────────────────────
  // The star that rises over the horizon on a mega launch is a real
  // destination: a sphere the avatar gets flung to and can then walk
  // all the way around. One object does both jobs, so there is never
  // a swap between the thing you can see and the thing you land on.
  const SUN_CENTER = new THREE.Vector3(30, 55, -300);
  const SUN_RADIUS = 28;
  const sunWorld = buildSunWorld({ center: SUN_CENTER, radius: SUN_RADIUS });
  group.add(sunWorld.group);
  // Holds the sky black while off-world — see the space tick below.
  let spaceLock = 0;
  let spaceLockTarget = 0;
  let spaceLockRate = 1.2;
  let armExitsIn = -1;
  let offWorld = false;

  function goToSun(flightSeconds = 6.4): void {
    if (offWorld) return;
    offWorld = true;
    // The boom teleports the avatar to the crater's xz but leaves its
    // y wherever the tunnel left it. The ordinary launch re-samples
    // the ground; this one has to do the same or the arc starts
    // several units below the crater floor.
    const p = getPlayerPosition();
    if (p) p.y = sampleGround(p.x, p.z);
    setCameraFocus(null);
    spaceLockTarget = 1;
    spaceLockRate = 1.2;
    sunWorld.armExits(false);
    launchToPlanet(sunWorld.spec, {
      duration: flightSeconds,
      arcHeight: 95,
      // Straight down onto the north pole. That is the one landing
      // where the planet camera and the flat camera agree exactly, so
      // the handover from flying to walking is invisible.
      landDir: new THREE.Vector3(0, 1, 0),
      // Facing away from home, so turning around is rewarded with
      // your own ocean hanging in the sky behind you.
      faceHint: new THREE.Vector3(0, 0, -1),
      onArrive: () => {
        playFireworkBurst();
        // A beat before the sunspots go live, or touching down beside
        // one would bounce the kid straight home again.
        armExitsIn = 1.6;
      },
    });
    // Timed for the top of the arc, where the stars come out.
    wooTimer = 2.2;
  }

  sunWorld.onEnterSpot = () => {
    if (!offWorld) return;
    sunWorld.armExits(false);
    armExitsIn = -1;
    offWorld = false;
    const dest = pickWaterLanding();
    const duration = 5.0;
    // Ease the sky back across the whole descent instead of snapping
    // it at the surface.
    spaceLockTarget = 0;
    spaceLockRate = 1 / duration;
    wooTimer = 3.4;
    leavePlanet(dest, {
      duration,
      arcHeight: 70,
      onLand: () => bigSplash(dest.x, dest.z),
    });
  };

  if (isDev()) {
    // Testing the trip shouldn't mean waiting on a 30% roll and a
    // drive into the cave. Press U, or call __letraSunTrip().
    type SunDev = {
      __letraSunTrip?: () => void;
      __letraSunLand?: () => void;
      __letraSunKey?: (e: KeyboardEvent) => void;
    };
    const w = window as unknown as SunDev;
    if (w.__letraSunKey) window.removeEventListener("keydown", w.__letraSunKey);
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "KeyU") goToSun();
    };
    w.__letraSunKey = onKey;
    w.__letraSunTrip = () => goToSun();
    // Skips the ride, for looking at the surface without waiting.
    w.__letraSunLand = () => goToSun(0.05);
    window.addEventListener("keydown", onKey);
  }

  // ── Space ────────────────────────────────────────────────────────
  // Every so often the volcano really lets go and throws the boat
  // clear of the atmosphere. Stars, a sun and the sky draining to
  // black all fade in purely as a function of the avatar's altitude —
  // no flight state to stay in sync with, so it can't get stuck on if
  // a launch is interrupted, and it works for any future launcher.
  const SPACE_START = 30;
  const SPACE_FULL = 100;
  {
    const spaceColor = new THREE.Color(0x05070f);

    const STAR_COUNT = 420;
    const starRand = mulberry32(freshSeed());
    const starPos = new Float32Array(STAR_COUNT * 3);
    for (let i = 0; i < STAR_COUNT; i++) {
      // Biased to the upper hemisphere — nobody looks down at stars.
      const y = starRand() * 1.5 - 0.25;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const th = starRand() * Math.PI * 2;
      const R = 300 + starRand() * 80;
      starPos[i * 3] = Math.cos(th) * r * R;
      starPos[i * 3 + 1] = y * R;
      starPos[i * 3 + 2] = Math.sin(th) * r * R;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
    const starMat = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 2.1,
      // Fixed pixel size and fog-exempt: they are meant to read as
      // pinpricks at infinity, not as objects 300 units away.
      sizeAttenuation: false,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      fog: false,
    });
    const stars = new THREE.Points(starGeo, starMat);
    stars.frustumCulled = false;
    stars.visible = false;
    group.add(stars);

    // The biome's own sky is captured the first time we see it and
    // whenever applyScene swaps in a new one (a time-of-day change),
    // so the values we lerp away from are always the pristine ones and
    // the sky restores itself exactly on the way back down.
    let bgRef: THREE.Color | null = null;
    const bgBase = new THREE.Color();
    let fogRef: THREE.Fog | null = null;
    const fogBase = new THREE.Color();
    let fogNearBase = 0;
    let fogFarBase = 0;

    tick.push((dt, t) => {
      const p = getPlayerPosition();
      const scene = group.parent as THREE.Scene | null;
      if (!p || !scene) return;
      if (armExitsIn > 0) {
        armExitsIn -= dt;
        if (armExitsIn <= 0) sunWorld.armExits(true);
      }
      const bg = scene.background;
      if (bg instanceof THREE.Color && bg !== bgRef) {
        bgRef = bg;
        bgBase.copy(bg);
      }
      const fog = scene.fog;
      if (fog instanceof THREE.Fog && fog !== fogRef) {
        fogRef = fog;
        fogBase.copy(fog.color);
        fogNearBase = fog.near;
        fogFarBase = fog.far;
      }

      // Normally the sky drains to black purely as a function of
      // altitude, which needs no flight state to stay in sync with and
      // so cannot get stuck on. Standing on the sun is the exception:
      // it sits only ~80 units up, which would leave the kid on a star
      // under a blue-ish sky. `spaceLock` holds it full while off-world
      // and eases back out across the ride home.
      spaceLock += Math.max(-spaceLockRate * dt, Math.min(spaceLockRate * dt, spaceLockTarget - spaceLock));
      const k = Math.max(
        smoothstep01((p.y - SPACE_START) / (SPACE_FULL - SPACE_START)),
        spaceLock
      );
      if (bgRef) bgRef.copy(bgBase).lerp(spaceColor, k);
      if (fogRef) {
        fogRef.color.copy(fogBase).lerp(spaceColor, k);
        // Pushed way out as we climb, or the sea below would vanish
        // into haze exactly when the view is worth having.
        fogRef.near = fogNearBase + k * 260;
        fogRef.far = fogFarBase + k * 900;
      }
      starMat.opacity = k;
      stars.visible = k > 0.01;
      // Steeper than the stars: a half-transparent star looks like a
      // ghost, so it goes solid well before the sky finishes draining.
      sunWorld.setOpacity(Math.min(1, k * 2.4));
      sunWorld.tick(dt, t, p);
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
      // Colour has to read from the same mask the geometry was built
      // with, or the shading won't line up with the shape.
      const mask = renderChannelMask(x, z);
      const masked = volcanoProfile(d) * mask;
      // How far this vert is dredged below sea level — full depth in
      // the carved channel, tapering to nothing in the feather band
      // and zero everywhere the mask leaves the rock alone.
      const dredge = CHANNEL_DREDGE * (1 - mask);
      pos.setY(i, coneSurfaceY(x, z));
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
        // Pad the fence by the avatar's nose so the bow stops at the
        // beach instead of burying itself in the flank — except along
        // the cave channel, where padding would close the corridor the
        // boat has to fit through. The channel's own walls are low wet
        // sand, so a bow nudging them costs nothing.
        const lx = x - ISLAND.x;
        const lz = z - ISLAND.z;
        const along = lx * MOUTH_DIR.x + lz * MOUTH_DIR.z;
        const perp = Math.abs(lx * -MOUTH_DIR.z + lz * MOUTH_DIR.x);
        const inCorridor = along > CAVE_WALL_ALONG - 0.5 && perp < CHANNEL_FADE_W;
        obstacles.push({ x, z, radius: inCorridor ? POST_R : POST_R + AVATAR_NOSE });
      }
    }
  }

  // Sea-cave mouth. A black semicircle set flush into the cliff face,
  // ringed by rock chunks that follow the same curve.
  //
  // Deliberately flat. Earlier versions modelled an actual tunnel — a
  // tube bored into the mountain — and it never worked, because the
  // island is a heightfield and a heightfield cannot represent a
  // tunnel: every hole you make through it is a canyon open to the
  // sky. Cut it narrow and rock plugs the opening; cut it wide and you
  // get a black gash down the mountainside; leave the tube uncut and
  // its outside hangs off the slope. A painted-on opening has none of
  // those failure modes and reads exactly right at low-poly scale.
  {
    const caveGroup = new THREE.Group();
    caveGroup.position.set(MOUTH_DIR.x * CAVE_ARCH_ALONG, 0, MOUTH_DIR.z * CAVE_ARCH_ALONG);
    caveGroup.lookAt(MOUTH_DIR.x * 100, 0, MOUTH_DIR.z * 100);
    volcanoGroup.add(caveGroup);

    // One radius function drives both the opening and the rocks around
    // it, so the arch always frames the hole exactly.
    const ARCH_R = CHANNEL_HALF_W + 0.16;
    const archRadius = (a: number) =>
      ARCH_R * (1 + Math.sin(a * 3 + 0.6) * 0.05 + Math.sin(a * 5.5 - 1.2) * 0.03);
    const MOUTH_Z = ARCH_MOUTH_ALONG - CAVE_ARCH_ALONG;

    {
      const shape = new THREE.Shape();
      const STEPS = 26;
      shape.moveTo(-archRadius(Math.PI), -0.9);
      for (let i = 0; i <= STEPS; i++) {
        const a = Math.PI * (1 - i / STEPS);
        const r = archRadius(a);
        shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      shape.lineTo(archRadius(0), -0.9);
      shape.closePath();
      // Unlit and fog-exempt: any shading at all gives the surface a
      // readable angle, and the whole point is that it has no surface.
      // The skirt below the waterline keeps the sea from showing a lit
      // sliver under the opening's flat edge.
      const mouth = new THREE.Mesh(
        new THREE.ShapeGeometry(shape),
        new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide, fog: false })
      );
      mouth.position.set(0, 0.12, MOUTH_Z);
      caveGroup.add(mouth);
    }

    // Rock ring around the opening. Each chunk is seated so its INNER
    // face just meets the arch edge — offsetting by a flat amount
    // instead let the bigger ones overhang the rim, and since they
    // draw in front of the black disc their lit faces showed up inside
    // the opening as pale lumps. Same reason there are no hanging
    // teeth any more: anything placed over the hole reads as debris
    // floating in it rather than rock framing it.
    {
      const archMat = new THREE.MeshStandardMaterial({ color: 0x5c4a3c, roughness: 1 });
      const rand = mulberry32(freshSeed());
      const CHUNKS = 12;
      for (let i = 0; i < CHUNKS; i++) {
        const a = (i / (CHUNKS - 1)) * Math.PI;
        const size = 0.26 + rand() * 0.14;
        // Dodecahedron "radius" is to its vertices; the flats sit a bit
        // closer in, so a touch of extra clearance keeps corners out of
        // the opening as they tumble.
        const r = archRadius(a) + size * 0.95;
        const chunk = new THREE.Mesh(new THREE.DodecahedronGeometry(size, 0), archMat);
        chunk.position.set(Math.cos(a) * r, 0.12 + Math.sin(a) * r, MOUTH_Z + 0.06);
        chunk.rotation.set(rand() * 3, rand() * 3, rand() * 3);
        chunk.castShadow = true;
        caveGroup.add(chunk);
      }
    }

    // Warm glow spilling out of the opening.
    const caveLight = new THREE.PointLight(0xff6a2a, 0.9, 4.5);
    caveLight.position.set(0, 0.9, MOUTH_Z + 0.5);
    caveGroup.add(caveLight);
    tick.push((_dt, t) => {
      caveLight.intensity = 0.8 + Math.sin(t * 3.1) * 0.2 + Math.sin(t * 7.3) * 0.1;
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

  // Ramps 0 → 1 while the volcano is erupting. Read by both the crater
  // pool and the flank flows to brighten and speed up; driven by the
  // eruption state machine further down.
  let lavaSurge = 0;

  // ── Crater lava ──────────────────────────────────────────────────
  // A living molten surface rather than a flat orange disc: a polar
  // grid that heaves slowly, with a crust that drifts across it. The
  // crust is the part that sells it — real lava is mostly dark skin
  // with incandescent cracks between the plates, so a uniformly bright
  // pool always reads as a sticker. Vertex colours carry both the
  // crust pattern and the heat, and the whole thing brightens and
  // speeds up while the volcano is winding up.
  const LAVA_R = CRATER_FLOOR_R + 0.5;
  const lavaMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    emissive: 0xff4400,
    emissiveIntensity: 1.1,
    roughness: 0.6,
  });
  const lavaGeo = (() => {
    const RINGS = 7;
    const SEGS = 26;
    const pos: number[] = [0, 0, 0];
    for (let r = 1; r <= RINGS; r++) {
      const rr = (r / RINGS) * LAVA_R;
      for (let s = 0; s < SEGS; s++) {
        const th = (s / SEGS) * Math.PI * 2;
        pos.push(Math.cos(th) * rr, 0, Math.sin(th) * rr);
      }
    }
    const idx: number[] = [];
    for (let s = 0; s < SEGS; s++) idx.push(0, 1 + ((s + 1) % SEGS), 1 + s);
    for (let r = 1; r < RINGS; r++) {
      const inner = 1 + (r - 1) * SEGS;
      const outer = 1 + r * SEGS;
      for (let s = 0; s < SEGS; s++) {
        const i0 = inner + s;
        const i1 = inner + ((s + 1) % SEGS);
        const o0 = outer + s;
        const o1 = outer + ((s + 1) % SEGS);
        idx.push(i0, i1, o1, i0, o1, o0);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(new Array(pos.length).fill(1), 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  })();
  const lava = new THREE.Mesh(lavaGeo, lavaMat);
  lava.position.y = FLOOR_H + 0.17;
  volcanoGroup.add(lava);
  {
    const lavaPos = lavaGeo.attributes.position;
    const lavaCol = lavaGeo.attributes.color;
    const cCrust = new THREE.Color(0x3d1206);
    const cHot = new THREE.Color(0xff7a18);
    const cWhite = new THREE.Color(0xffe27a);
    const tmp = new THREE.Color();
    tick.push((_dt, t) => {
      // Crust drifts one way, the swell rolls the other, so the two
      // never lock into a repeating pattern.
      const speed = 0.35 + lavaSurge * 1.1;
      const ct = t * speed;
      for (let i = 0; i < lavaPos.count; i++) {
        const x = lavaPos.getX(i);
        const z = lavaPos.getZ(i);
        const edge = Math.min(1, Math.hypot(x, z) / LAVA_R);
        // Slow heave, damped at the rim so the pool stays in its bowl.
        // Slow heave with a finer ripple riding on it, plus a gentle
        // swell of the whole pool — enough to read as simmering
        // without becoming choppy.
        const heave =
          Math.sin(x * 2.1 + ct * 1.7) * 0.5 +
          Math.sin(z * 1.7 - ct * 1.3) * 0.5 +
          Math.sin((x - z) * 4.3 + ct * 2.9) * 0.28 +
          Math.sin((x + z) * 6.1 - ct * 3.7) * 0.16;
        const breathe = 1 + Math.sin(ct * 0.9) * 0.25;
        lavaPos.setY(i, heave * 0.075 * breathe * (1 - edge * edge));
        // Plate boundaries: where the noise crosses zero the crust
        // splits and the glow shows through.
        const plate =
          Math.sin(x * 1.9 + ct * 0.8) * Math.cos(z * 2.3 - ct * 0.6) +
          Math.sin((x + z) * 1.35 - ct * 0.9) * 0.6;
        const crack = Math.pow(1 - Math.min(1, Math.abs(plate) / 0.55), 2);
        // Cooler at the rim, hottest in the middle, hotter still while
        // the eruption is building.
        const heat = Math.min(1, (crack + lavaSurge * 0.55) * (1.25 - edge * 0.5));
        tmp.copy(cCrust).lerp(cHot, Math.min(1, heat * 1.5));
        if (heat > 0.65) tmp.lerp(cWhite, (heat - 0.65) * 2.2);
        lavaCol.setXYZ(i, tmp.r, tmp.g, tmp.b);
      }
      lavaPos.needsUpdate = true;
      lavaCol.needsUpdate = true;
    });
  }
  const lavaLight = new THREE.PointLight(0xff5a1a, 1.4, 18);
  lavaLight.position.y = FLOOR_H + 1.2;
  volcanoGroup.add(lavaLight);

  // ── Lava flows down the flanks ───────────────────────────────────
  // Glowing ribbons that spill over the crater rim and run all the way
  // to the waterline. Each one snakes a little as it descends and
  // hugs the rock via coneSurfaceY, so it lies on the mountain rather
  // than floating over it. The glow crawls downhill and the whole set
  // flares while the volcano is erupting.
  //
  // These live on volcanoGroup, so they shake with the mountain during
  // the rumble for free.
  const lavaFlows: {
    geo: THREE.BufferGeometry;
    colors: Float32Array;
    steps: number;
    // 0..1 down the flow, per vertex pair — drives the travelling glow
    ks: number[];
  }[] = [];
  // Where each flow meets the sea, in world coords — steam rises here.
  const lavaFeet: { x: number; z: number }[] = [];
  {
    const FLOW_COUNT = 6;
    // Radians of mountain either side of the cave mouth to leave bare.
    // Narrow on purpose: lava SHOULD run down the face the cave is in,
    // it just must not pour across the opening itself.
    const MOUTH_CLEAR = 0.52;
    const mouthAngle = Math.atan2(MOUTH_DIR.z, MOUTH_DIR.x);
    const flowRand = mulberry32(freshSeed());
    // Fan the flows evenly across the arc that ISN'T the mouth. Slot
    // jitter is capped at half a slot, so no flow can ever wander into
    // the cleared wedge.
    const span = Math.PI * 2 - MOUTH_CLEAR * 2;
    const slot = span / FLOW_COUNT;
    for (let f = 0; f < FLOW_COUNT; f++) {
      const bearing =
        mouthAngle + MOUTH_CLEAR + (f + 0.5) * slot + (flowRand() - 0.5) * slot * 0.5;
      const wanderAmp = 0.12 + flowRand() * 0.16;
      const wanderFreq = 1.4 + flowRand() * 1.6;
      const wanderPhase = flowRand() * Math.PI * 2;

      const pts: { x: number; z: number; y: number; k: number }[] = [];
      // Start inside the crater pool itself, not at its edge. Starting
      // at the edge still left a gap: the crater wall climbs from the
      // floor to the rim, so a stream beginning out there sits a good
      // 0.3 above the pool surface and visibly floats over it. From
      // the floor it wells up, over the lip, and down.
      const rTop = CRATER_FLOOR_R - 0.25;
      // Runs a little past the island's edge so the tip finishes
      // under the sea rather than stopping level with it.
      const rBottom = ISLAND_OUTER_R + 0.9;
      // Stepped finer than the cone mesh's own rings, so a ribbon
      // can't chord across a bump and sink into the rock between
      // samples — which was breaking the streams into dashes.
      for (let r = rTop; r <= rBottom; r += 0.22) {
        const k = (r - rTop) / (rBottom - rTop);
        const a = bearing + Math.sin(k * wanderFreq * Math.PI + wanderPhase) * wanderAmp;
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        const y = coneSurfaceY(x, z);
        pts.push({ x, z, y, k });
      }
      if (pts.length < 3) continue;

      const steps = pts.length;
      const positions = new Float32Array(steps * 2 * 3);
      const colors = new Float32Array(steps * 2 * 3);
      const ks: number[] = [];
      for (let i = 0; i < steps; i++) {
        const p = pts[i];
        // Perpendicular to the direction of travel, in the XZ plane.
        const nx = i < steps - 1 ? pts[i + 1].x - p.x : p.x - pts[i - 1].x;
        const nz = i < steps - 1 ? pts[i + 1].z - p.z : p.z - pts[i - 1].z;
        const nl = Math.hypot(nx, nz) || 1;
        const px = -nz / nl;
        const pz = nx / nl;
        // Narrow at the vent, spreading a little on the way down.
        // Kept thin deliberately — these are unlit, so a wide ribbon
        // reads as a flat orange sticker painted on the mountain
        // rather than as molten rock running down a gully.
        const w = 0.13 + p.k * 0.13;
        for (const side of [-1, 1]) {
          const vi = i * 2 + (side < 0 ? 0 : 1);
          const ex = p.x + px * w * side;
          const ez = p.z + pz * w * side;
          positions[vi * 3 + 0] = ex;
          // Sample the rock under each EDGE, not just the centreline.
          // The flanks are gullied now, so a ribbon whose edges inherit
          // the middle's height buries itself on every cross-slope.
          // Sits low in the pool at the vent and rides higher once it
          // is out on the open flank, where the rock is rougher.
          //
          // Floored well under the sea rather than following the rock
          // all the way down. The streams run to the island's edge now,
          // and near the mouth that path crosses the dredged channel
          // whose floor is 0.7 down — without the clamp the ribbon
          // dives into the trench (and used to break off up the beach
          // entirely). Held just under the surface, the sea cuts it off
          // cleanly however the waves are moving.
          // Dips under the surface over the last stretch. Ending level
          // with the water left the tip riding at +0.17, so every wave
          // trough exposed a squared-off end sitting on wet sand; the
          // sea has to be able to swallow it whatever the swell is
          // doing.
          const rr = Math.hypot(ex, ez);
          const sink = smoothstep01((rr - (ISLAND_OUTER_R - 0.8)) / 1.4) * 0.8;
          positions[vi * 3 + 1] =
            Math.max(coneSurfaceY(ex, ez), -0.3) + 0.05 + p.k * 0.12 - sink;
          positions[vi * 3 + 2] = ez;
        }
        ks.push(p.k);
      }
      const idx: number[] = [];
      for (let i = 0; i < steps - 1; i++) {
        const a = i * 2;
        idx.push(a, a + 1, a + 3, a, a + 3, a + 2);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      geo.setIndex(idx);
      // Basic (unlit) so the lava reads as self-luminous at any time of
      // day, the same trick the crater pool uses.
      const mesh = new THREE.Mesh(
        geo,
        new THREE.MeshBasicMaterial({ vertexColors: true })
      );
      mesh.renderOrder = 1;
      volcanoGroup.add(mesh);
      lavaFlows.push({ geo, colors, steps, ks });
      const foot = pts[pts.length - 1];
      lavaFeet.push({ x: ISLAND.x + foot.x, z: ISLAND.z + foot.z });
    }
  }
  // Steam where the flows quench in the sea — a small recycled set of
  // puffs, one drifting up from a random flow foot every second or so.
  {
    const STEAM_COUNT = 8;
    const puffs: { mesh: THREE.Mesh; age: number; life: number; drift: number }[] = [];
    for (let i = 0; i < STEAM_COUNT; i++) {
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(0.34, 8, 6),
        new THREE.MeshBasicMaterial({
          color: 0xeef2f4,
          transparent: true,
          opacity: 0,
          depthWrite: false,
        })
      );
      m.visible = false;
      group.add(m);
      puffs.push({ mesh: m, age: 0, life: 0, drift: 0 });
    }
    let next = 0;
    let spawnIn = 0.4;
    tick.push((dt) => {
      if (lavaFeet.length > 0) {
        spawnIn -= dt * (1 + lavaSurge * 3);
        if (spawnIn <= 0) {
          spawnIn = 0.7 + Math.random() * 0.9;
          const foot = lavaFeet[(Math.random() * lavaFeet.length) | 0];
          const p = puffs[next];
          next = (next + 1) % STEAM_COUNT;
          p.age = 0;
          p.life = 1.6 + Math.random() * 1.0;
          p.drift = Math.random() * Math.PI * 2;
          p.mesh.visible = true;
          p.mesh.position.set(
            foot.x + (Math.random() - 0.5) * 0.5,
            0.1,
            foot.z + (Math.random() - 0.5) * 0.5
          );
        }
      }
      for (const p of puffs) {
        if (!p.mesh.visible) continue;
        p.age += dt;
        const k = p.age / p.life;
        if (k >= 1) {
          p.mesh.visible = false;
          continue;
        }
        p.mesh.position.y = 0.1 + k * 2.2;
        p.mesh.position.x += Math.cos(p.drift) * dt * 0.35;
        p.mesh.position.z += Math.sin(p.drift) * dt * 0.35;
        p.mesh.scale.setScalar(0.5 + k * 1.6);
        (p.mesh.material as THREE.MeshBasicMaterial).opacity =
          0.4 * Math.min(1, k / 0.2) * Math.max(0, 1 - (k - 0.2) / 0.8);
      }
    });
  }
  // Recolour the flows each frame: a hot band travels from vent to sea
  // over the top of a cooling gradient, so the rock looks like it is
  // moving even though the geometry never changes.
  {
    const cHot = new THREE.Color(0xffe07a);
    const cMid = new THREE.Color(0xff7a1a);
    const cCool = new THREE.Color(0x8f1e08);
    const tmp = new THREE.Color();
    tick.push((_dt, t) => {
      // `surge` is set by the eruption state machine below.
      const surge = lavaSurge;
      const speed = 0.16 + surge * 0.5;
      for (const flow of lavaFlows) {
        for (let i = 0; i < flow.steps; i++) {
          const k = flow.ks[i];
          // Base gradient: incandescent at the vent, crusted by the sea.
          tmp.copy(cMid).lerp(cCool, k * (0.85 - surge * 0.5));
          // Travelling bright band — phase wraps, so pulses keep coming.
          const phase = (t * speed - k + 4) % 1;
          const band = Math.max(0, 1 - Math.abs(phase - 0.5) * 5);
          tmp.lerp(cHot, band * (0.5 + surge * 0.45));
          for (const side of [0, 1]) {
            const vi = i * 2 + side;
            flow.colors[vi * 3 + 0] = tmp.r;
            flow.colors[vi * 3 + 1] = tmp.g;
            flow.colors[vi * 3 + 2] = tmp.b;
          }
        }
        flow.geo.attributes.color.needsUpdate = true;
      }
    });
  }

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

  // ── Ash plume ────────────────────────────────────────────────────
  // Fired as one burst at the boom, separate from the lazy crater
  // smoke above: bigger, darker, much faster off the mark, and it
  // keeps climbing well past the rim so the eruption reads from across
  // the map. Buoyant rather than ballistic — it decelerates and drifts
  // instead of arcing over.
  type Ash = { mesh: THREE.Mesh; age: number; life: number; vel: THREE.Vector3; spin: number };
  const ASH_COUNT = 20;
  const ashPuffs: Ash[] = [];
  for (let i = 0; i < ASH_COUNT; i++) {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(0.62, 9, 7),
      new THREE.MeshBasicMaterial({ color: 0x4a423c, transparent: true, opacity: 0, depthWrite: false })
    );
    m.visible = false;
    group.add(m);
    ashPuffs.push({ mesh: m, age: 0, life: 0, vel: new THREE.Vector3(), spin: 0 });
  }
  function burstAsh(): void {
    for (let i = 0; i < ASH_COUNT; i++) {
      const p = ashPuffs[i];
      p.age = -(i / ASH_COUNT) * 0.7; // stagger so it billows out, not all at once
      p.life = 3.2 + Math.random() * 1.6;
      p.spin = (Math.random() - 0.5) * 2;
      const ang = Math.random() * Math.PI * 2;
      const out = Math.random() * 1.7;
      p.vel.set(Math.cos(ang) * out, 7 + Math.random() * 6, Math.sin(ang) * out);
      p.mesh.visible = true;
      p.mesh.position.set(
        ISLAND.x + Math.cos(ang) * Math.random() * 0.8,
        FLOOR_H + 0.5,
        ISLAND.z + Math.sin(ang) * Math.random() * 0.8
      );
      p.mesh.scale.setScalar(0.5);
    }
  }

  // ── Glowing embers ───────────────────────────────────────────────
  // Small bright sparks flung with the lava. Purely decorative — they
  // fade out mid-air rather than landing, so a fountain of them can't
  // set off a barrage of splash sounds.
  type Ember = { mesh: THREE.Mesh; age: number; life: number; vel: THREE.Vector3 };
  const EMBER_COUNT = 34;
  const embers: Ember[] = [];
  const emberMat = new THREE.MeshBasicMaterial({ color: 0xffc24a, transparent: true, opacity: 1 });
  for (let i = 0; i < EMBER_COUNT; i++) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.075, 6, 5), emberMat.clone());
    m.visible = false;
    group.add(m);
    embers.push({ mesh: m, age: 0, life: 0, vel: new THREE.Vector3() });
  }
  let nextEmber = 0;
  function fireEmber(): void {
    const e = embers[nextEmber];
    nextEmber = (nextEmber + 1) % EMBER_COUNT;
    e.age = 0;
    e.life = 1.1 + Math.random() * 1.1;
    e.mesh.visible = true;
    e.mesh.position.set(
      ISLAND.x + (Math.random() - 0.5) * 1.2,
      FLOOR_H + 0.6,
      ISLAND.z + (Math.random() - 0.5) * 1.2
    );
    const ang = Math.random() * Math.PI * 2;
    const out = 1.5 + Math.random() * 5;
    e.vel.set(Math.cos(ang) * out, 11 + Math.random() * 8, Math.sin(ang) * out);
  }

  // ── Lava bombs + water effects pools ─────────────────────────────
  type Bomb = { mesh: THREE.Mesh; active: boolean; vel: THREE.Vector3; spin: THREE.Vector3 };
  const BOMB_COUNT = 26;
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
  let pendingMega = false;

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
    // Flank flows swell as the mountain winds up and while it is
    // throwing lava, then ease back to their idle glow.
    const surgeTarget = state === "rumbling" || fountainT > 0 ? 1 : 0;
    lavaSurge += (surgeTarget - lavaSurge) * Math.min(1, dt * (surgeTarget > lavaSurge ? 6 : 1.2));

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
      const ramp = stateT / (pendingMega ? MEGA_RUMBLE_SECONDS : RUMBLE_SECONDS);
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
          // Rolled here rather than at the boom: the wind-up length
          // depends on it.
          pendingMega = Math.random() < MEGA_CHANCE;
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
      if (stateT >= (pendingMega ? MEGA_RUMBLE_SECONDS : RUMBLE_SECONDS)) {
        const mega = pendingMega;
        state = "cooldown";
        stateT = 0;
        playVolcanoBoom(mega);
        fountainT = 2.6;
        bombAccum = 0;
        wooTimer = 0.35;
        burstAsh();
        for (let i = 0; i < 14; i++) fireEmber();
        // The mountain swallowed the boat — pop it to the crater and
        // blast it out the top. The teleport happens the same frame
        // as the boom + fountain, so it reads as "shot out".
        const p = getPlayerPosition();
        if (p) {
          p.x = ISLAND.x;
          p.z = ISLAND.z;
        }
        if (mega) {
          fountainT = 3.4;
          for (let i = 0; i < 16; i++) fireEmber();
        }
        if (mega) {
          // A mega eruption no longer comes back down — it throws the
          // boat clear of the world entirely and lands it on the sun.
          goToSun();
        } else {
          const dest = pickWaterLanding();
          launchPlayer(dest, {
            duration: 1.8,
            peakY: 15,
            onLand: () => bigSplash(dest.x, dest.z),
          });
        }
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
      // Heaviest right after the boom, thinning as the eruption spends
      // itself, so it reads as one blast rather than a steady tap.
      const heat = Math.min(1, fountainT / 2.0);
      bombAccum += dt * (5 + heat * 13);
      while (bombAccum >= 1) {
        bombAccum -= 1;
        fireBomb(true);
        if (Math.random() < 0.8) fireEmber();
      }
    }

    // Ash — buoyant, so it sheds speed and keeps drifting up rather
    // than arcing over like the bombs do.
    for (const p of ashPuffs) {
      if (!p.mesh.visible) continue;
      p.age += dt;
      if (p.age < 0) continue;
      const k = p.age / p.life;
      if (k >= 1) {
        p.mesh.visible = false;
        continue;
      }
      p.vel.multiplyScalar(1 - Math.min(1, dt * 1.5));
      p.vel.y = Math.max(p.vel.y, 0.9);
      p.mesh.position.addScaledVector(p.vel, dt);
      p.mesh.rotation.y += p.spin * dt;
      p.mesh.scale.setScalar(0.5 + k * 3.4);
      const mat = p.mesh.material as THREE.MeshBasicMaterial;
      mat.opacity = 0.74 * Math.min(1, k / 0.12) * Math.max(0, 1 - (k - 0.12) / 0.88);
      // Starts as dark ash and greys out as it climbs and thins. Kept
      // dark at the base on purpose — against a bright sky a pale
      // plume just reads as steam.
      mat.color.setRGB(0.17 + k * 0.32, 0.15 + k * 0.31, 0.14 + k * 0.3);
    }

    // Embers — ballistic sparks that burn out in the air.
    for (const e2 of embers) {
      if (!e2.mesh.visible) continue;
      e2.age += dt;
      const k = e2.age / e2.life;
      if (k >= 1) {
        e2.mesh.visible = false;
        continue;
      }
      e2.vel.y -= 15 * dt;
      e2.mesh.position.addScaledVector(e2.vel, dt);
      const mat = e2.mesh.material as THREE.MeshBasicMaterial;
      mat.opacity = 1 - k * k;
      mat.color.setRGB(1, 0.76 - k * 0.5, 0.29 - k * 0.27);
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
          // A bomb that reaches open water quenches with a steam
          // hiss; one that lands on the island's rock or beach just
          // pops.
          if (islandHeight(bx, bz) + sandHeight(bx, bz) < 0.05) playLavaSplash();
          else playLavaPop();
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
  // Scenery only — a boat is a boat, so it stops at the beach instead
  // of motoring up onto the sand. Each island gets two obstacles:
  //
  //   solid    a disc at the shoreline (where the sand climbs clear of
  //            the wave crests), so the boat is held just offshore.
  //   non-solid a wider disc that blocks *spawns* without pushing the
  //            player, so letters and buoys never land on the sand —
  //            or in the ring of shallows inside the solid disc —
  //            where the kid could see them but never reach them.
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
    // Shoreline radius: walk in from the dome's edge to the first point
    // where the sand stands proud of the water.
    let shore = s.r;
    for (let d = s.r; d > 0.5; d -= 0.05) {
      if (s.h * (1 - smoothstep01(d / s.r)) >= SHORE_H) {
        shore = d;
        break;
      }
    }
    obstacles.push({ x: s.x, z: s.z, radius: shore + AVATAR_NOSE });
    obstacles.push({ x: s.x, z: s.z, radius: s.r + 1.2 + AVATAR_NOSE, solid: false });
    // One palm near the top of each island. No obstacle of its own —
    // the shoreline disc already keeps the boat well clear of it.
    const palm = makePalmTree(palmRand, 0.75 + palmRand() * 0.3);
    const offAng = palmRand() * Math.PI * 2;
    const px = s.x + Math.cos(offAng) * s.r * 0.3;
    const pz = s.z + Math.sin(offAng) * s.r * 0.3;
    palm.group.position.set(px, sandHeight(px, pz) - 0.05, pz);
    palm.group.rotation.y = palmRand() * Math.PI * 2;
    group.add(palm.group);
    tick.push(palm.update);
  }

  // ── Jumping fish ─────────────────────────────────────────────────
  // Fish must stay in open water. Two things used to let them onto
  // land: the jump DESTINATION was only bounds-checked against the
  // world radius and never against the islands, and after each jump
  // the fish adopts its landing spot as home — so a school would walk
  // its patch across the map over a few minutes and end up hopping in
  // and out of a beach or the volcano.
  const FISH_CLEARANCE = 2.2;
  const isOpenWater = (x: number, z: number): boolean => {
    if (Math.hypot(x, z) > worldRadius + 4) return false;
    if (Math.hypot(x - ISLAND.x, z - ISLAND.z) < ISLAND_OUTER_R + FISH_CLEARANCE) return false;
    for (const s of SAND_ISLANDS) {
      // Measured against the island's own radius, not sandHeight —
      // sandHeight is already 0 at the shoreline, which leaves no
      // clearance at all.
      if (Math.hypot(x - s.x, z - s.z) < s.r + FISH_CLEARANCE) return false;
    }
    return true;
  };
  const fishRand = mulberry32(freshSeed());
  for (let i = 0; i < 6; i++) {
    const fish = makeFish(fishRand);
    group.add(fish.group);
    // Home waters. Falls back to a sweep around a mid-ocean ring
    // rather than keeping whatever the last failed try produced.
    let hx = 0;
    let hz = 0;
    let placed = false;
    for (let a = 0; a < 40 && !placed; a++) {
      hx = (fishRand() - 0.5) * (worldRadius * 1.5);
      hz = (fishRand() - 0.5) * (worldRadius * 1.5);
      placed = isOpenWater(hx, hz);
    }
    for (let a = 0; a < 48 && !placed; a++) {
      const th = (a / 48) * Math.PI * 2;
      hx = Math.cos(th) * (worldRadius * 0.6);
      hz = Math.sin(th) * (worldRadius * 0.6);
      placed = isOpenWater(hx, hz);
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
          from = { x: hx, z: hz };
          // Pick a destination in open water, checking the midpoint
          // too — both ends can be clear while the arc still cuts the
          // corner of an island between them. If nothing lands, jump
          // straight up and come back down, which is open by
          // construction.
          to = { x: hx, z: hz };
          for (let a = 0; a < 10; a++) {
            const ang = fishRand() * Math.PI * 2;
            const dist = 2 + fishRand() * 3;
            const tx = hx + Math.cos(ang) * dist;
            const tz = hz + Math.sin(ang) * dist;
            if (isOpenWater(tx, tz) && isOpenWater((hx + tx) / 2, (hz + tz) / 2)) {
              to = { x: tx, z: tz };
              break;
            }
          }
          jumpDur = 0.9 + fishRand() * 0.4;
          peak = 1.2 + fishRand() * 1.0;
          fish.group.visible = true;
          spawnFoam(from.x, from.z, 0.5);
          playSmallSplash();
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
        playSmallSplash();
        hx = to.x;
        hz = to.z;
      }
    });
  }

  // ── Sea monster ──────────────────────────────────────────────────
  // One very friendly Nessie cruising a wide circle, dipping under
  // now and then. Non-solid — she's scenery with eyes.
  //
  // Switched off for now (the fish stay). The factory and the cruise
  // logic below are kept intact so she can be flipped back on by
  // setting SEA_MONSTERS to true.
  const SEA_MONSTERS = false;
  if (SEA_MONSTERS) {
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
