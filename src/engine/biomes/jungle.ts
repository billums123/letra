import * as THREE from "three";
import type { Biome, BiomeContext } from "./types";
import {
  findOpenSpot,
  freshSeed,
  mulberry32,
  makeSharedMeadowAssets,
  makeGrassyDiscGeometry,
  paintGrassVertexColors,
  makeGroundPatches,
  makeFlower,
  makeButterfly,
  makeBoulder,
  makeCloud,
  makePond,
  type GroundPatchKind,
  type GrassPalette,
} from "../world";
import { rollTimeOfDay, type TimeOfDay } from "./timeOfDay";
import { playVolcanoRumble, playVolcanoBoom, playLavaPop, playWoo } from "../../audio/sfx";

// Jungle biome — a lush tropical forest with one showpiece landmark:
// a drivable volcano. The kid can drive straight up the cone; the
// moment they dip into the crater the mountain rumbles, then ERUPTS —
// flinging the avatar on a huge somersaulting arc to a random clear
// spot in the jungle while lava bombs rain down around the peak.
// Pure slapstick, zero danger: bombs are confetti with better makeup.
//
// The volcano is climbable terrain (registered via setTerrainHeight),
// not a collision obstacle. We still push a non-solid obstacle over
// its footprint so letters and scenery never spawn on the cone.

type JungleMood = {
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

const JUNGLE_MOODS: Record<
  Extract<TimeOfDay, "jungle-mist" | "jungle-noon" | "jungle-sunset">,
  JungleMood
> = {
  // Humid morning — pale mint haze hanging between the trees.
  "jungle-mist": {
    bg: 0xbfe3cf,
    fogColor: 0xbfe3cf,
    fogNear: 35,
    fogFar: 115,
    hemiSky: 0xeaf7dc,
    hemiGround: 0x4f8f4a,
    hemiIntensity: 0.6,
    sunColor: 0xfff2cc,
    sunIntensity: 1.1,
    sunPos: [20, 16, 10],
    ambientColor: 0xf0fbe8,
    ambientIntensity: 0.45,
  },
  // Bright tropical midday — saturated sky, hard warm sun.
  "jungle-noon": {
    bg: 0x8fd7ff,
    fogColor: 0x8fd7ff,
    fogNear: 55,
    fogFar: 150,
    hemiSky: 0xfff7d6,
    hemiGround: 0x3f8f3a,
    hemiIntensity: 0.62,
    sunColor: 0xffffff,
    sunIntensity: 1.45,
    sunPos: [14, 26, 10],
    ambientColor: 0xffffff,
    ambientIntensity: 0.4,
  },
  // Golden-hour glow with the volcano silhouetted against peach sky.
  "jungle-sunset": {
    bg: 0xffb98a,
    fogColor: 0xffb98a,
    fogNear: 45,
    fogFar: 135,
    hemiSky: 0xffc9a0,
    hemiGround: 0x6a7a3a,
    hemiIntensity: 0.55,
    sunColor: 0xff9a56,
    sunIntensity: 1.25,
    sunPos: [26, 10, 6],
    ambientColor: 0xffd9b0,
    ambientIntensity: 0.45,
  },
};

const JUNGLE_POOL = ["jungle-mist", "jungle-noon", "jungle-sunset"] as const;

const JUNGLE_GRASS_PALETTE: GrassPalette = {
  base: 0x46a04a,
  light: 0x74c468,
  dark: 0x2c6e30,
  patchLight: 0x8fd47a,
  patchDark: 0x225c26,
  patchDirt: 0x7a5c3a,
};

// ── Volcano geometry constants ──────────────────────────────────────
// One source of truth shared by the terrain sampler, the lathe mesh,
// the trigger zone, and the eruption effects, so the mountain the kid
// drives on IS the mountain they see.
const VOLCANO = { x: -15, z: -13 };
const CRATER_FLOOR_R = 1.2; // flat lava floor
const CRATER_RIM_R = 3.4; // top of the rim ring
const VOLCANO_OUTER_R = 9.0; // where the cone meets the jungle floor
const RIM_H = 4.0;
const FLOOR_H = 2.6; // crater floor height (1.4 below the rim)
const TRIGGER_R = 1.6; // drive inside this ⇒ eruption
const RUMBLE_SECONDS = 0.9;
const COOLDOWN_SECONDS = 3.5;

function smoothstep01(t: number): number {
  const k = Math.min(1, Math.max(0, t));
  return k * k * (3 - 2 * k);
}

// Radial height profile of the volcano. d = XZ distance from center.
function volcanoProfile(d: number): number {
  if (d >= VOLCANO_OUTER_R) return 0;
  if (d <= CRATER_FLOOR_R) return FLOOR_H;
  if (d <= CRATER_RIM_R) {
    // Climb from the crater floor up to the rim.
    const t = (d - CRATER_FLOOR_R) / (CRATER_RIM_R - CRATER_FLOOR_R);
    return FLOOR_H + (RIM_H - FLOOR_H) * smoothstep01(t);
  }
  // Outer flank: rim down to the jungle floor.
  const t = (d - CRATER_RIM_R) / (VOLCANO_OUTER_R - CRATER_RIM_R);
  return RIM_H * (1 - smoothstep01(t));
}

export const jungleBiome: Biome = {
  id: "jungle",
  label: "Jungle",
  emoji: "🌋",
  recommendedAvatar: "car",
  applyScene(scene) {
    const prevBg = scene.background;
    const prevFog = scene.fog;
    const tod = rollTimeOfDay("jungle", JUNGLE_POOL);
    const m = JUNGLE_MOODS[tod as keyof typeof JUNGLE_MOODS];
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
  const shared = makeSharedMeadowAssets();

  // ── Terrain ──────────────────────────────────────────────────────
  // Flat jungle floor everywhere except the volcano cone.
  const sampleGround = (x: number, z: number): number =>
    volcanoProfile(Math.hypot(x - VOLCANO.x, z - VOLCANO.z));
  setTerrainHeight(sampleGround);

  // Keep letters and scenery off the cone: a non-solid obstacle over
  // the footprint blocks spawns (pickClearSpawn / findOpenSpot) while
  // letting the kid drive straight through and up.
  obstacles.push({ x: VOLCANO.x, z: VOLCANO.z, radius: VOLCANO_OUTER_R + 0.5, solid: false });

  // ── Ground ───────────────────────────────────────────────────────
  const groundGeo = makeGrassyDiscGeometry(worldRadius + 30, 18, 64);
  paintGrassVertexColors(groundGeo, JUNGLE_GRASS_PALETTE, 1);
  const ground = new THREE.Mesh(
    groundGeo,
    new THREE.MeshStandardMaterial({ vertexColors: true, color: 0xffffff, roughness: 1 })
  );
  ground.receiveShadow = true;
  group.add(ground);

  const skirt = new THREE.Mesh(
    new THREE.RingGeometry(worldRadius + 30, worldRadius + 80, 48),
    new THREE.MeshStandardMaterial({ color: 0x3f7a38, roughness: 1, side: THREE.DoubleSide })
  );
  skirt.rotation.x = -Math.PI / 2;
  skirt.position.y = -0.05;
  skirt.receiveShadow = true;
  group.add(skirt);

  // Soft ground patches (same treatment as the meadow, jungle hues).
  const patchRand = mulberry32(freshSeed());
  const patchPositions: Array<{ x: number; z: number; y: number; radius: number; kind: GroundPatchKind }> = [];
  let patchAttempts = 0;
  while (patchPositions.length < 20 && patchAttempts < 200) {
    patchAttempts++;
    const angle = patchRand() * Math.PI * 2;
    const dist = Math.sqrt(patchRand()) * (worldRadius - 1.5);
    const x = Math.cos(angle) * dist;
    const z = Math.sin(angle) * dist;
    // Not on the volcano, please.
    if (Math.hypot(x - VOLCANO.x, z - VOLCANO.z) < VOLCANO_OUTER_R + 1) continue;
    const r = patchRand();
    const kind: GroundPatchKind = r < 0.5 ? "dark" : r < 0.9 ? "light" : "dirt";
    patchPositions.push({ x, z, y: 0.012, radius: 1.2 + patchRand() * 1.8, kind });
  }
  group.add(makeGroundPatches(patchPositions, JUNGLE_GRASS_PALETTE, patchRand));

  // ── The volcano ──────────────────────────────────────────────────
  const volcanoGroup = new THREE.Group();
  volcanoGroup.position.set(VOLCANO.x, 0, VOLCANO.z);
  group.add(volcanoGroup);

  // Cone mesh — lathe of the exact same radial profile the terrain
  // sampler uses, with rocky vertex colours: mossy green skirts
  // blending up through basalt browns to a scorched dark rim, and a
  // hot glow tint just inside the crater.
  {
    const SEGMENTS = 56;
    const STEPS = 40;
    const points: THREE.Vector2[] = [];
    for (let i = 0; i <= STEPS; i++) {
      const d = (i / STEPS) * VOLCANO_OUTER_R;
      points.push(new THREE.Vector2(d, volcanoProfile(d)));
    }
    // Lathe profiles run bottom→top along the curve; ours runs
    // center→out. Same thing geometrically — Lathe revolves around Y.
    const coneGeo = new THREE.LatheGeometry(points, SEGMENTS);
    const pos = coneGeo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const cMoss = new THREE.Color(0x55984a);
    const cRock = new THREE.Color(0x9a7048);
    const cScorch = new THREE.Color(0x4a3a32);
    const cGlow = new THREE.Color(0xff7a2a);
    const tmp = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const d = Math.hypot(x, z);
      // Small jagged height jitter (skip the crater floor so the lava
      // pool sits flush).
      if (d > CRATER_FLOOR_R + 0.3) {
        const n = Math.sin(x * 5.1 + z * 3.7) * Math.cos(x * 2.3 - z * 4.9);
        pos.setY(i, pos.getY(i) + n * 0.14);
      }
      const h = volcanoProfile(d) / RIM_H; // 0..1 up the mountain
      if (d < CRATER_RIM_R) {
        // Inside the bowl: scorched, glowing toward the floor.
        tmp.copy(cScorch).lerp(cGlow, Math.min(1, Math.max(0, 1.1 - d / CRATER_RIM_R)) * 0.55);
      } else {
        // Classic picture-book volcano: mossy green base, warm brown
        // body, scorch only at the very top around the rim.
        tmp.copy(cMoss).lerp(cRock, Math.min(1, h * 1.15));
        if (h > 0.82) tmp.lerp(cScorch, (h - 0.82) * 4.5);
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

  // Lava pool on the crater floor — emissive disc that pulses.
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

  // Warm flickering light over the crater so the glow reads on the
  // rim and on the smoke column at night-ish moods.
  const lavaLight = new THREE.PointLight(0xff5a1a, 1.4, 18);
  lavaLight.position.y = FLOOR_H + 1.2;
  volcanoGroup.add(lavaLight);

  // ── Crater smoke ─────────────────────────────────────────────────
  // Recycled pool of puff sprites rising from the mouth. Emission and
  // size scale up hard during rumble + eruption.
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

  // ── Lava bombs + splats ──────────────────────────────────────────
  // Pooled glowing chunks flung from the crater during an eruption
  // (plus the occasional idle sputter). Ballistic, then a fading
  // glow-splat where they land.
  type Bomb = {
    mesh: THREE.Mesh;
    active: boolean;
    vel: THREE.Vector3;
    spin: THREE.Vector3;
  };
  const BOMB_COUNT = 14;
  const bombs: Bomb[] = [];
  const bombPalette = [0xff5a1a, 0xff7a2a, 0xffb03a];
  for (let i = 0; i < BOMB_COUNT; i++) {
    const color = bombPalette[i % bombPalette.length];
    const m = new THREE.Mesh(
      new THREE.DodecahedronGeometry(0.16 + Math.random() * 0.14, 0),
      new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.9,
        roughness: 0.5,
      })
    );
    m.visible = false;
    m.castShadow = true;
    group.add(m); // world space — bombs fly beyond the volcano group
    bombs.push({ mesh: m, active: false, vel: new THREE.Vector3(), spin: new THREE.Vector3() });
  }
  type Splat = { mesh: THREE.Mesh; t: number };
  const SPLAT_COUNT = 16;
  const splats: Splat[] = [];
  for (let i = 0; i < SPLAT_COUNT; i++) {
    const m = new THREE.Mesh(
      new THREE.CircleGeometry(0.5, 14),
      new THREE.MeshBasicMaterial({
        color: 0xff6a1a,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      })
    );
    m.rotation.x = -Math.PI / 2;
    m.visible = false;
    group.add(m);
    splats.push({ mesh: m, t: 1 });
  }
  let nextSplat = 0;

  function fireBomb(big: boolean): void {
    const bomb = bombs.find((b) => !b.active);
    if (!bomb) return;
    bomb.active = true;
    bomb.mesh.visible = true;
    bomb.mesh.position.set(VOLCANO.x, FLOOR_H + 0.6, VOLCANO.z);
    const ang = Math.random() * Math.PI * 2;
    const horiz = big ? 2.5 + Math.random() * 4.5 : 1.2 + Math.random() * 2.2;
    bomb.vel.set(
      Math.cos(ang) * horiz,
      big ? 9 + Math.random() * 5 : 5.5 + Math.random() * 2.5,
      Math.sin(ang) * horiz
    );
    bomb.spin.set((Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10);
  }

  function spawnSplat(x: number, z: number): void {
    const s = splats[nextSplat];
    nextSplat = (nextSplat + 1) % SPLAT_COUNT;
    s.t = 0;
    s.mesh.visible = true;
    s.mesh.position.set(x, sampleGround(x, z) + 0.03, z);
    const r = 0.7 + Math.random() * 0.7;
    s.mesh.scale.setScalar(r);
  }

  // ── Eruption state machine ───────────────────────────────────────
  let state: "idle" | "rumbling" | "cooldown" = "idle";
  let stateT = 0;
  let fountainT = 0; // >0 ⇒ raining bombs
  let bombAccum = 0;
  let wooTimer = -1; // delayed "wheee" after the boom
  let sputterIn = 4 + Math.random() * 5;

  // Random clear landing spot for the launch: away from the volcano,
  // inside the world, not inside a tree.
  function pickLandingSpot(): { x: number; z: number } {
    for (let i = 0; i < 30; i++) {
      const ang = Math.random() * Math.PI * 2;
      const dist = 12 + Math.random() * (worldRadius - 8 - 12);
      const x = Math.cos(ang) * dist;
      const z = Math.sin(ang) * dist;
      if (Math.hypot(x - VOLCANO.x, z - VOLCANO.z) < VOLCANO_OUTER_R + 4) continue;
      let clear = true;
      for (const o of obstacles) {
        if (o.solid === false) continue;
        if (Math.hypot(x - o.x, z - o.z) < o.radius + 1.2) {
          clear = false;
          break;
        }
      }
      if (clear) return { x, z };
    }
    return { x: 8, z: 8 };
  }

  tick.push((dt, t) => {
    const player = getPlayerPosition();

    // Lava pulse + light flicker — always on, so the crater looks
    // alive even from across the map.
    const pulse = 0.9 + Math.sin(t * 2.1) * 0.2 + Math.sin(t * 5.7) * 0.1;
    lavaMat.emissiveIntensity = pulse * (state === "rumbling" ? 1.8 : 1.1);
    lavaLight.intensity = pulse * (state === "rumbling" ? 2.6 : 1.4) + (fountainT > 0 ? 1.2 : 0);

    // Smoke column. Base rate is a lazy wisp; rumble/eruption pushes
    // opacity, size, and rise speed way up.
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
        FLOOR_H + 0.6 + k * (4.5 * Math.min(smokeBoost, 2)),
        Math.sin(p.drift) * 0.4 + sway * 0.6
      );
      p.mesh.scale.setScalar((0.5 + k * 2.2) * (smokeBoost > 1 ? 1.35 : 1));
      const fadeIn = Math.min(1, k / 0.15);
      const fadeOut = Math.max(0, 1 - (k - 0.15) / 0.85);
      (p.mesh.material as THREE.MeshBasicMaterial).opacity =
        (0.16 + (smokeBoost - 1) * 0.12) * fadeIn * fadeOut;
    }

    // Rumble shake — jitter the whole volcano mesh; ramps up over the
    // rumble window so the eruption telegraphs itself.
    if (state === "rumbling") {
      const ramp = stateT / RUMBLE_SECONDS;
      const amp = 0.05 + ramp * 0.09;
      volcanoGroup.position.set(
        VOLCANO.x + (Math.random() - 0.5) * amp,
        (Math.random() - 0.5) * amp * 0.5,
        VOLCANO.z + (Math.random() - 0.5) * amp
      );
    } else if (volcanoGroup.position.x !== VOLCANO.x) {
      volcanoGroup.position.set(VOLCANO.x, 0, VOLCANO.z);
    }

    // ── State transitions ─────────────────────────────────────────
    stateT += dt;
    if (state === "idle") {
      // Idle sputter: an occasional single bomb pops out of the mouth
      // so the volcano winks at the kid from across the jungle.
      sputterIn -= dt;
      if (sputterIn <= 0) {
        sputterIn = 5 + Math.random() * 6;
        fireBomb(false);
        playLavaPop();
      }
      if (player) {
        const d = Math.hypot(player.x - VOLCANO.x, player.z - VOLCANO.z);
        if (d < TRIGGER_R) {
          state = "rumbling";
          stateT = 0;
          playVolcanoRumble();
        }
      }
    } else if (state === "rumbling") {
      if (stateT >= RUMBLE_SECONDS) {
        state = "cooldown";
        stateT = 0;
        playVolcanoBoom();
        fountainT = 2.2;
        bombAccum = 0;
        wooTimer = 0.35;
        const dest = pickLandingSpot();
        launchPlayer(dest, { duration: 1.7, peakY: 13 });
      }
    } else if (state === "cooldown") {
      if (stateT >= COOLDOWN_SECONDS) {
        state = "idle";
        stateT = 0;
        sputterIn = 2 + Math.random() * 3;
      }
    }

    // Delayed flight "wheee" so it rings out as the avatar sails.
    if (wooTimer >= 0) {
      wooTimer -= dt;
      if (wooTimer < 0) playWoo();
    }

    // Lava fountain — stream bombs while the timer runs.
    if (fountainT > 0) {
      fountainT -= dt;
      bombAccum += dt * 7; // ~7 bombs/second while erupting
      while (bombAccum >= 1) {
        bombAccum -= 1;
        fireBomb(true);
      }
    }

    // Bomb physics + splats.
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
        // Bombs that fall back into the crater just vanish into the
        // lava; the ones landing on the jungle floor leave a splat.
        if (Math.hypot(bx - VOLCANO.x, bz - VOLCANO.z) > CRATER_RIM_R) {
          spawnSplat(bx, bz);
          playLavaPop();
        }
      }
    }
    for (const s of splats) {
      if (s.t >= 1) continue;
      s.t += dt / 1.4;
      const k = Math.min(1, s.t);
      (s.mesh.material as THREE.MeshBasicMaterial).opacity = 0.85 * (1 - k * k);
      s.mesh.scale.multiplyScalar(1 + dt * 0.35);
      if (k >= 1) s.mesh.visible = false;
    }
  });

  // ── Lagoon ───────────────────────────────────────────────────────
  const pond = makePond();
  const pondPos = { x: 16, z: 14 };
  pond.group.position.set(pondPos.x, 0, pondPos.z);
  group.add(pond.group);
  obstacles.push({ x: pondPos.x, z: pondPos.z, radius: pond.radius });
  tick.push(pond.tick);

  // ── Canopy trees ─────────────────────────────────────────────────
  // Big broadleaf jungle trees — tall bare trunks with wide drooping
  // leaf crowns and hanging vines. This is what separates the jungle
  // from the park at a glance: no conifer cones anywhere in the play
  // zone.
  const treeRand = mulberry32(freshSeed());
  for (let i = 0; i < 26; i++) {
    const scale = 1.0 + treeRand() * 0.7;
    const radius = 1.3 * scale;
    const spot = findOpenSpot(treeRand, worldRadius - 4, radius, obstacles, { minRadius: 8 });
    if (!spot) continue;
    const tree = makeJungleTree(treeRand, scale);
    tree.group.position.set(spot.x, 0, spot.z);
    tree.group.rotation.y = treeRand() * Math.PI * 2;
    group.add(tree.group);
    obstacles.push({ x: spot.x, z: spot.z, radius, onBump: tree.shake });
    tick.push(tree.update);
  }

  // ── Palm trees ───────────────────────────────────────────────────
  const palmRand = mulberry32(freshSeed());
  for (let i = 0; i < 16; i++) {
    const scale = 0.9 + palmRand() * 0.5;
    const radius = 0.6 * scale;
    const spot = findOpenSpot(palmRand, worldRadius - 4, radius, obstacles, { minRadius: 7 });
    if (!spot) continue;
    const palm = makePalmTree(palmRand, scale);
    palm.group.position.set(spot.x, 0, spot.z);
    palm.group.rotation.y = palmRand() * Math.PI * 2;
    group.add(palm.group);
    obstacles.push({ x: spot.x, z: spot.z, radius, onBump: palm.shake });
    tick.push(palm.update);
  }

  // ── Ferns ────────────────────────────────────────────────────────
  // Soft props: the kid drives through and they wiggle, like flowers.
  // Dense — the understory is most of what makes it read "jungle".
  const fernRand = mulberry32(freshSeed());
  for (let i = 0; i < 40; i++) {
    const spot = findOpenSpot(fernRand, worldRadius - 3, 0.5, obstacles, {
      minRadius: 4,
      pad: 0.2,
      maxAttempts: 14,
    });
    if (!spot) continue;
    const fern = makeFern(fernRand);
    fern.group.position.set(spot.x, 0, spot.z);
    fern.group.rotation.y = fernRand() * Math.PI * 2;
    group.add(fern.group);
    obstacles.push({ x: spot.x, z: spot.z, radius: 0.45, onBump: fern.shake, solid: false });
    tick.push(fern.update);
  }

  // ── Tropical flowers ─────────────────────────────────────────────
  const flowerRand = mulberry32(freshSeed());
  for (let i = 0; i < 44; i++) {
    const spot = findOpenSpot(flowerRand, worldRadius - 3, 0.3, obstacles, {
      minRadius: 0,
      pad: 0.1,
      maxAttempts: 12,
    });
    if (!spot) continue;
    // Hot hues only — hibiscus reds, oranges, magentas.
    const hue = flowerRand() < 0.6 ? flowerRand() * 55 : 285 + flowerRand() * 60;
    const f = makeFlower(hue, shared);
    f.group.position.set(spot.x, 0, spot.z);
    f.group.rotation.y = flowerRand() * Math.PI * 2;
    group.add(f.group);
    obstacles.push({ x: spot.x, z: spot.z, radius: 0.32, onBump: f.shake, solid: false });
    tick.push(f.update);
  }

  // ── Volcanic boulders ────────────────────────────────────────────
  const boulderRand = mulberry32(freshSeed());
  for (let i = 0; i < 10; i++) {
    const size = 0.9 + boulderRand() * 0.7;
    const radius = size * 0.8;
    const spot = findOpenSpot(boulderRand, worldRadius - 6, radius, obstacles, { minRadius: 6 });
    if (!spot) continue;
    const b = makeBoulder(size, (boulderRand() * 360) | 0);
    b.position.set(spot.x, 0, spot.z);
    b.rotation.y = boulderRand() * Math.PI * 2;
    group.add(b);
    obstacles.push({ x: spot.x, z: spot.z, radius });
  }

  // ── Butterflies ──────────────────────────────────────────────────
  const butterflyRand = mulberry32(freshSeed());
  for (let i = 0; i < 7; i++) {
    const orbitR = 4 + butterflyRand() * 14;
    const cx = (butterflyRand() - 0.5) * 30;
    const cz = (butterflyRand() - 0.5) * 30;
    const speed = 0.4 + butterflyRand() * 0.5;
    const phase = butterflyRand() * Math.PI * 2;
    const baseY = 1.0 + butterflyRand() * 1.8;
    const hue = butterflyRand() * 360;
    const b = makeButterfly(hue, shared);
    group.add(b.group);
    tick.push((_dt, t) => {
      const ang = t * speed + phase;
      b.group.position.x = cx + Math.cos(ang) * orbitR;
      b.group.position.z = cz + Math.sin(ang) * orbitR;
      b.group.position.y = baseY + Math.sin(t * 2 + phase) * 0.4;
      b.group.rotation.y = ang + Math.PI / 2;
      const flap = Math.sin(t * 18 + phase) * 0.9;
      b.wingL.rotation.set(0, 0, flap);
      b.wingR.rotation.set(0, 0, -flap);
    });
  }

  // ── Distant scenery ──────────────────────────────────────────────
  // Jungle hills + far trees past the boundary so the world reads as
  // deep forest instead of a green pancake.
  const hillRand = mulberry32(freshSeed());
  let hillsPlaced = 0;
  let hillAttempts = 0;
  while (hillsPlaced < 16 && hillAttempts < 220) {
    hillAttempts++;
    const r = 8 + hillRand() * 14;
    const x = (hillRand() - 0.5) * 200;
    const z = (hillRand() - 0.5) * 200;
    if (Math.hypot(x, z) - r < worldRadius + 4) continue;
    const hue = 100 + hillRand() * 35;
    const hill = new THREE.Mesh(
      new THREE.SphereGeometry(r, 16, 12),
      new THREE.MeshStandardMaterial({ color: new THREE.Color(`hsl(${hue}, 45%, 38%)`), roughness: 0.95 })
    );
    hill.position.set(x, r * 0.3 - 0.5, z);
    hill.receiveShadow = true;
    group.add(hill);
    hillsPlaced++;
  }
  const distantRand = mulberry32(freshSeed());
  const distantSpots: Array<{ x: number; z: number; radius: number }> = [];
  for (let i = 0; i < 30; i++) {
    let placed = false;
    for (let a = 0; a < 24 && !placed; a++) {
      const x = (distantRand() - 0.5) * 200;
      const z = (distantRand() - 0.5) * 200;
      const d = Math.hypot(x, z);
      const scale = 0.9 + distantRand() * 0.8;
      const selfR = 1.6 * scale;
      if (d < worldRadius + 4 + selfR || d > 95) continue;
      let clear = true;
      for (const s of distantSpots) {
        if (Math.hypot(x - s.x, z - s.z) < s.radius + selfR + 1) {
          clear = false;
          break;
        }
      }
      if (!clear) continue;
      distantSpots.push({ x, z, radius: selfR });
      const tree = makeJungleTree(distantRand, scale);
      tree.group.position.set(x, 0, z);
      tree.group.rotation.y = distantRand() * Math.PI * 2;
      group.add(tree.group);
      placed = true;
    }
  }

  // Clouds — a few high white puffs.
  const cloudRand = mulberry32(freshSeed());
  for (let i = 0; i < 8; i++) {
    const c = makeCloud();
    c.position.set((cloudRand() - 0.5) * 200, 18 + cloudRand() * 10, (cloudRand() - 0.5) * 200);
    c.scale.setScalar(1 + cloudRand());
    group.add(c);
  }
}

// ─── Jungle-specific prop factories ───────────────────────────────────

// Big broadleaf jungle tree: a tall bare trunk with a wide two-tier
// drooping crown built from flattened spheres + blade leaves, plus a
// couple of hanging vines that sway. Crown pivots for the bump-shake,
// vines get their own lazy pendulum.
function makeJungleTree(rand: () => number, scale: number) {
  const g = new THREE.Group();
  g.scale.setScalar(scale);

  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x7a5230, roughness: 1 });
  const trunkH = 2.6 + rand() * 1.2;
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.34, trunkH, 8), trunkMat);
  trunk.position.y = trunkH / 2;
  trunk.castShadow = true;
  trunk.receiveShadow = true;
  g.add(trunk);
  // A couple of buttress-root nubs at the base.
  for (let i = 0; i < 3; i++) {
    const ang = (i / 3) * Math.PI * 2 + rand();
    const root = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.16, 0.5, 6), trunkMat);
    root.position.set(Math.cos(ang) * 0.28, 0.2, Math.sin(ang) * 0.28);
    root.rotation.z = -Math.cos(ang) * 0.5;
    root.rotation.x = Math.sin(ang) * 0.5;
    g.add(root);
  }

  const crown = new THREE.Group();
  crown.position.y = trunkH;
  g.add(crown);

  const hue = 112 + rand() * 26;
  const leafDark = new THREE.MeshStandardMaterial({
    color: new THREE.Color(`hsl(${hue}, 52%, 30%)`),
    roughness: 0.95,
  });
  const leafLight = new THREE.MeshStandardMaterial({
    color: new THREE.Color(`hsl(${hue + 8}, 55%, 40%)`),
    roughness: 0.9,
  });
  // Two stacked flattened blobs = the canopy mass.
  const blobLo = new THREE.Mesh(new THREE.SphereGeometry(1.5, 12, 9), leafDark);
  blobLo.scale.set(1.25, 0.55, 1.25);
  blobLo.position.y = 0.25;
  blobLo.castShadow = true;
  crown.add(blobLo);
  const blobHi = new THREE.Mesh(new THREE.SphereGeometry(1.0, 12, 9), leafLight);
  blobHi.scale.set(1.1, 0.6, 1.1);
  blobHi.position.y = 0.85;
  blobHi.castShadow = true;
  crown.add(blobHi);
  // Drooping blade leaves ringing the crown edge — same flattened-cone
  // trick as the palm fronds, pointing down and out.
  const BLADES = 8;
  for (let i = 0; i < BLADES; i++) {
    const ang = (i / BLADES) * Math.PI * 2 + rand() * 0.3;
    const blade = new THREE.Mesh(new THREE.ConeGeometry(0.24, 1.5, 4), leafDark);
    blade.scale.z = 0.22;
    blade.position.set(Math.cos(ang) * 1.6, 0.1, Math.sin(ang) * 1.6);
    blade.rotation.z = Math.cos(ang) * 1.35;
    blade.rotation.x = -Math.sin(ang) * 1.35;
    blade.castShadow = true;
    crown.add(blade);
  }

  // Hanging vines — thin cylinders dangling from the crown edge with
  // a leaf tip. Each sways on its own phase.
  const vineMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(`hsl(${hue}, 45%, 34%)`), roughness: 1 });
  const vines: { pivot: THREE.Group; phase: number }[] = [];
  const vineCount = 2 + ((rand() * 2) | 0);
  for (let i = 0; i < vineCount; i++) {
    const ang = rand() * Math.PI * 2;
    const pivot = new THREE.Group();
    pivot.position.set(Math.cos(ang) * 1.2, 0.15, Math.sin(ang) * 1.2);
    crown.add(pivot);
    const len = 1.2 + rand() * 1.0;
    const vine = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.025, len, 5), vineMat);
    vine.position.y = -len / 2;
    pivot.add(vine);
    const tipLeaf = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 5), leafLight);
    tipLeaf.scale.set(1, 0.5, 1.6);
    tipLeaf.position.y = -len;
    pivot.add(tipLeaf);
    vines.push({ pivot, phase: rand() * Math.PI * 2 });
  }

  let shakeT = 0;
  let amp = 0;
  return {
    group: g,
    shake: (intensity: number = 1) => {
      shakeT = 1;
      amp = Math.max(amp, Math.min(0.26, 0.17 * intensity + 0.07));
    },
    update: (dt: number, t: number) => {
      for (const v of vines) {
        v.pivot.rotation.x = Math.sin(t * 1.1 + v.phase) * 0.12 + (shakeT > 0 ? Math.sin(t * 24) * 0.3 * shakeT : 0);
        v.pivot.rotation.z = Math.cos(t * 0.9 + v.phase) * 0.1;
      }
      if (shakeT <= 0) {
        if (crown.rotation.x !== 0 || crown.rotation.z !== 0) {
          crown.rotation.x = 0;
          crown.rotation.z = 0;
        }
        return;
      }
      shakeT = Math.max(0, shakeT - dt * 2.2);
      crown.rotation.z = Math.sin(t * 26) * amp * shakeT;
      crown.rotation.x = Math.cos(t * 22) * amp * 0.55 * shakeT;
      if (shakeT === 0) amp = 0;
    },
  };
}

// Curved-trunk palm with a burst of fronds and a couple of coconuts.
// shake/update contract matches makeTree so the world wiring is
// identical.
function makePalmTree(rand: () => number, scale: number) {
  const g = new THREE.Group();
  g.scale.setScalar(scale);

  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x9a6a3a, roughness: 1 });
  // Trunk: stacked, slightly offset segments to fake a gentle curve.
  const SEGS = 5;
  const lean = 0.12 + rand() * 0.1;
  let topX = 0;
  let topY = 0;
  for (let i = 0; i < SEGS; i++) {
    const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.14 - i * 0.012, 0.17 - i * 0.012, 0.62, 8), trunkMat);
    topX = (i + 0.5) * lean;
    topY = i * 0.56 + 0.28;
    seg.position.set(topX, topY, 0);
    seg.rotation.z = -lean * 1.6;
    seg.castShadow = true;
    g.add(seg);
  }
  const crownX = SEGS * lean;
  const crownY = SEGS * 0.56 + 0.1;

  // Fronds pivot from the crown so they can wobble on bump.
  const fronds = new THREE.Group();
  fronds.position.set(crownX, crownY, 0);
  g.add(fronds);
  const frondMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(`hsl(${115 + rand() * 25}, 55%, 38%)`),
    roughness: 0.9,
    side: THREE.DoubleSide,
  });
  const FROND_COUNT = 7;
  for (let i = 0; i < FROND_COUNT; i++) {
    const frond = new THREE.Mesh(new THREE.ConeGeometry(0.22, 1.7, 4), frondMat);
    frond.scale.y = 1;
    frond.scale.z = 0.25; // flatten into a blade
    const ang = (i / FROND_COUNT) * Math.PI * 2 + rand() * 0.3;
    frond.position.set(Math.cos(ang) * 0.55, 0.18, Math.sin(ang) * 0.55);
    // Tip the cone outward + downward so the crown droops like a palm.
    frond.rotation.z = Math.cos(ang) * 1.25;
    frond.rotation.x = -Math.sin(ang) * 1.25;
    frond.castShadow = true;
    fronds.add(frond);
  }
  // Coconuts.
  const cocoMat = new THREE.MeshStandardMaterial({ color: 0x5c4326, roughness: 0.9 });
  for (let i = 0; i < 3; i++) {
    const nut = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 8), cocoMat);
    const ang = rand() * Math.PI * 2;
    nut.position.set(Math.cos(ang) * 0.18, -0.05, Math.sin(ang) * 0.18);
    nut.castShadow = true;
    fronds.add(nut);
  }

  let shakeT = 0;
  let amp = 0;
  return {
    group: g,
    shake: (intensity: number = 1) => {
      shakeT = 1;
      amp = Math.max(amp, Math.min(0.3, 0.2 * intensity + 0.08));
    },
    update: (dt: number, t: number) => {
      // Constant lazy sway + bump wobble on top.
      const idle = Math.sin(t * 0.9 + crownX) * 0.04;
      let wobX = 0;
      let wobZ = 0;
      if (shakeT > 0) {
        shakeT = Math.max(0, shakeT - dt * 2.2);
        wobZ = Math.sin(t * 26) * amp * shakeT;
        wobX = Math.cos(t * 21) * amp * 0.6 * shakeT;
        if (shakeT === 0) amp = 0;
      }
      fronds.rotation.z = idle + wobZ;
      fronds.rotation.x = wobX;
    },
  };
}

// Low fan of flat blades — reads as a fern / elephant-ear clump.
// Contract matches makeFlower: soft obstacle, wiggles when bumped.
function makeFern(rand: () => number) {
  const g = new THREE.Group();
  const clump = new THREE.Group();
  g.add(clump);
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(`hsl(${118 + rand() * 30}, 50%, ${30 + rand() * 12}%)`),
    roughness: 0.95,
    side: THREE.DoubleSide,
  });
  const BLADES = 7 + ((rand() * 3) | 0);
  const size = 0.7 + rand() * 0.7;
  for (let i = 0; i < BLADES; i++) {
    const blade = new THREE.Mesh(new THREE.PlaneGeometry(0.16 * size, 1.0 * size), mat);
    const ang = (i / BLADES) * Math.PI * 2 + rand() * 0.4;
    blade.position.set(Math.cos(ang) * 0.12, 0.42 * size, Math.sin(ang) * 0.12);
    blade.rotation.y = -ang;
    blade.rotation.x = -0.7 - rand() * 0.35; // arc outward
    blade.castShadow = true;
    clump.add(blade);
  }
  let shakeT = 0;
  let amp = 0;
  return {
    group: g,
    shake: (intensity: number = 1) => {
      shakeT = 1;
      amp = Math.max(amp, Math.min(0.4, 0.25 * intensity + 0.1));
    },
    update: (dt: number, t: number) => {
      if (shakeT <= 0) {
        if (clump.rotation.x !== 0 || clump.rotation.z !== 0) {
          clump.rotation.x = 0;
          clump.rotation.z = 0;
        }
        return;
      }
      shakeT = Math.max(0, shakeT - dt * 2.4);
      clump.rotation.z = Math.sin(t * 30) * amp * shakeT;
      clump.rotation.x = Math.cos(t * 24) * amp * 0.6 * shakeT;
      if (shakeT === 0) amp = 0;
    },
  };
}
