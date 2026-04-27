import * as THREE from "three";
import type { Biome, BiomeContext } from "./types";
import { findOpenSpot, freshSeed, mulberry32 } from "../world";

// Lunar surface biome. Cratered gray ground, deep starry sky, a big
// blue Earth hanging in the distance, scattered moon rocks + a
// planted flag for a landmark. No trees, no butterflies, no pond —
// the moon is barren on purpose. Pairs nicely with the rocket
// avatar.
export const moonBiome: Biome = {
  id: "moon",
  label: "Moon",
  emoji: "🌙",
  recommendedAvatar: "rocket",
  applyScene(scene) {
    const prevBg = scene.background;
    const prevFog = scene.fog;
    // Deep midnight blue sky, very subtle fog so the horizon doesn't
    // clip hard against the boundary.
    scene.background = new THREE.Color(0x05060e);
    scene.fog = new THREE.Fog(0x05060e, 70, 220);

    // Cool moonlight rim — a single hard directional light from a low
    // angle for crisp lunar shadows.
    const sun = new THREE.DirectionalLight(0xc8d8ff, 1.3);
    sun.position.set(-18, 22, 12);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -25;
    sun.shadow.camera.right = 25;
    sun.shadow.camera.top = 25;
    sun.shadow.camera.bottom = -25;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 80;
    sun.shadow.bias = -0.0005;
    scene.add(sun);

    // Cold low-fill ambient so the unlit side of every rock doesn't
    // go fully black.
    const ambient = new THREE.AmbientLight(0x404870, 0.45);
    scene.add(ambient);

    // A subtle teal back-light bouncing up off Earth, so silhouettes
    // read against the dark sky.
    const earthBounce = new THREE.HemisphereLight(0x4a7cb0, 0x111626, 0.35);
    scene.add(earthBounce);

    return () => {
      scene.remove(sun);
      scene.remove(ambient);
      scene.remove(earthBounce);
      sun.dispose();
      scene.background = prevBg;
      scene.fog = prevFog;
    };
  },
  buildProps,
};

function buildProps(ctx: BiomeContext): void {
  const { group, obstacles, tick, worldRadius, getPlayerPosition, setTerrainHeight } = ctx;

  // ── Crater plan ──────────────────────────────────────────────────
  // Pick all crater positions BEFORE we build the ground, because the
  // ground mesh's vertices need to dip down into each crater. This
  // turns the craters into real terrain depressions instead of bowls
  // sitting on top of flat ground.
  type CraterPlan = { x: number; z: number; radius: number; depth: number };
  const craterPlans: CraterPlan[] = [];
  const craterRand = mulberry32(freshSeed());
  for (let i = 0; i < 22; i++) {
    const radius = 1.4 + craterRand() * 2.2;
    // Outer falloff is 1.6× the visible radius — that's where the
    // ground vertex displacement starts. We pad by that when picking
    // a clear spot so two adjacent craters' falloffs don't overlap.
    const spot = findOpenSpot(craterRand, worldRadius - 4, radius * 1.6, obstacles, {
      minRadius: 4,
      pad: 0.4,
      maxAttempts: 14,
    });
    if (!spot) continue;
    const depth = 0.35 + craterRand() * 0.5 + radius * 0.18;
    craterPlans.push({ x: spot.x, z: spot.z, radius, depth });
  }

  // Closure over craterPlans — used both to deform the ground at
  // build time and as a per-frame terrain-height sampler the engine
  // calls so the avatar dips into the craters as it drives over them.
  const craterDip = (x: number, z: number): number => {
    let lowest = 0;
    for (const c of craterPlans) {
      const outerR = c.radius * 1.6;
      const d = Math.hypot(x - c.x, z - c.z);
      if (d >= outerR) continue;
      const t = 1 - d / outerR;
      const k = t * t * (3 - 2 * t);
      const y = -c.depth * k;
      if (y < lowest) lowest = y;
    }
    return lowest;
  };
  // Lightweight value-noise function — a hash on the integer grid
  // bilinearly-interpolated. Used for both surface-bumpiness Y
  // displacement and per-vertex colour variation, so the moon
  // surface reads as textured rather than a smooth grey disc.
  const hash2 = (xi: number, zi: number): number => {
    let h = xi * 374761393 + zi * 668265263;
    h = (h ^ (h >>> 13)) >>> 0;
    h = Math.imul(h, 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  };
  const surfaceNoise = (x: number, z: number, scale: number): number => {
    const xs = x * scale;
    const zs = z * scale;
    const xi = Math.floor(xs);
    const zi = Math.floor(zs);
    const xf = xs - xi;
    const zf = zs - zi;
    // Smoothstep within the cell so the bilinear seams aren't visible.
    const u = xf * xf * (3 - 2 * xf);
    const v = zf * zf * (3 - 2 * zf);
    const a = hash2(xi, zi);
    const b = hash2(xi + 1, zi);
    const c = hash2(xi, zi + 1);
    const d = hash2(xi + 1, zi + 1);
    return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
  };
  // Combined surface texture: gentle rolling height + dust-shade
  // variation. Same noise field consulted for both so light + dark
  // patches are spatially correlated with the bumps.
  const surfaceHeight = (x: number, z: number): number => {
    return (
      (surfaceNoise(x, z, 0.06) - 0.5) * 0.18 +
      (surfaceNoise(x, z, 0.18) - 0.5) * 0.06
    );
  };

  // The engine reads this each frame and offsets the avatar's Y by
  // its return value. craterDip dominates (negative); the surface
  // noise rides on top so kids feel small rolling bumps as they
  // drive across the regolith.
  setTerrainHeight((x, z) => craterDip(x, z) + surfaceHeight(x, z));

  // ── Ground ────────────────────────────────────────────────────────
  // Tessellated disc — RingGeometry with many radial + angular
  // subdivisions so we have enough vertices to displace into crater
  // bowls AND show small surface texture variation. Vertex colours
  // do triple duty: darken the inside of each crater, paint
  // lighter dust patches, and shade rolling-noise high spots.
  const groundGeo = new THREE.RingGeometry(0.05, worldRadius + 30, 128, 56);
  groundGeo.rotateX(-Math.PI / 2);
  const positions = groundGeo.attributes.position;
  const colors = new Float32Array(positions.count * 3);
  const baseColor = new THREE.Color(0xa1a7b0);
  const lightDust = new THREE.Color(0xc7ccd2);
  const shadowDust = new THREE.Color(0x4f535d);
  const vec = new THREE.Color();
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i);
    const z = positions.getZ(i);
    // Crater dip + small surface roll combined. Surface roll is
    // muted near the world edge so the boundary still reads flat
    // against the skirt.
    const edgeFalloff = THREE.MathUtils.clamp(1 - (Math.hypot(x, z) - (worldRadius - 6)) / 8, 0, 1);
    const noiseY = surfaceHeight(x, z) * edgeFalloff;
    const dipY = craterDip(x, z);
    positions.setY(i, dipY + noiseY);

    // Vertex colour:
    //   - depth tint: lerp toward shadowDust as we go below ground
    //   - dust tint: lerp toward lightDust on the lighter noise
    //     patches (uses the larger-scale band of the same field)
    const depthT = THREE.MathUtils.clamp(-dipY / 1.5, 0, 1);
    const dustT = THREE.MathUtils.clamp((surfaceNoise(x, z, 0.04) - 0.5) * 1.6, -0.4, 0.4);
    vec.copy(baseColor);
    if (dustT > 0) vec.lerp(lightDust, dustT);
    else vec.lerp(shadowDust, -dustT);
    // Crater shading wins — lerp toward shadowDust harder near the
    // bottom so the centre of every crater reads as a dark sink
    // before any texture noise.
    if (depthT > 0) vec.lerp(shadowDust, depthT * 0.85);
    colors[i * 3 + 0] = vec.r;
    colors[i * 3 + 1] = vec.g;
    colors[i * 3 + 2] = vec.b;
  }
  positions.needsUpdate = true;
  groundGeo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  groundGeo.computeVertexNormals();
  const ground = new THREE.Mesh(
    groundGeo,
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      roughness: 1,
      flatShading: false,
    })
  );
  ground.receiveShadow = true;
  group.add(ground);

  // ── Surface dust patches ─────────────────────────────────────────
  // Flat lighter discs scattered across the ground to break up the
  // plain grey. Sit just above the surface so they layer on top of
  // the vertex-colour terrain without z-fighting. No collision.
  const dustRand = mulberry32(freshSeed());
  for (let i = 0; i < 30; i++) {
    const dx = (dustRand() - 0.5) * (worldRadius - 4) * 2;
    const dz = (dustRand() - 0.5) * (worldRadius - 4) * 2;
    if (Math.hypot(dx, dz) > worldRadius - 4) continue;
    const r = 1.4 + dustRand() * 2.5;
    // Skip patches that would sit inside a crater — they look weird
    // overlaid on the dark sink.
    if (craterDip(dx, dz) < -0.05) continue;
    const shade = 0.78 + dustRand() * 0.15;
    const patch = new THREE.Mesh(
      new THREE.CircleGeometry(r, 14),
      new THREE.MeshStandardMaterial({
        color: new THREE.Color().setHSL(0.62, 0.04, shade),
        roughness: 1,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
      })
    );
    patch.rotation.x = -Math.PI / 2;
    // Float just above the surface noise at this spot so the patch
    // hugs the ground instead of intersecting it.
    patch.position.set(dx, surfaceHeight(dx, dz) + 0.01, dz);
    patch.receiveShadow = true;
    group.add(patch);
  }

  // ── Pebble litter ────────────────────────────────────────────────
  // Tiny rocks scattered in clumps so the surface has small-scale
  // detail when the camera is close. Cheap (small dodecahedrons),
  // no collision.
  const pebbleRand = mulberry32(freshSeed());
  for (let i = 0; i < 90; i++) {
    const dx = (pebbleRand() - 0.5) * (worldRadius - 4) * 2;
    const dz = (pebbleRand() - 0.5) * (worldRadius - 4) * 2;
    if (Math.hypot(dx, dz) > worldRadius - 4) continue;
    const size = 0.05 + pebbleRand() * 0.1;
    const baseShade = 0.42 + pebbleRand() * 0.18;
    const pebble = new THREE.Mesh(
      new THREE.DodecahedronGeometry(size, 0),
      new THREE.MeshStandardMaterial({
        color: new THREE.Color().setHSL(0.62, 0.05, baseShade),
        roughness: 1,
      })
    );
    pebble.position.set(
      dx,
      craterDip(dx, dz) + surfaceHeight(dx, dz) + size * 0.5,
      dz
    );
    pebble.rotation.set(pebbleRand() * Math.PI, pebbleRand() * Math.PI, pebbleRand() * Math.PI);
    pebble.castShadow = true;
    pebble.receiveShadow = true;
    group.add(pebble);
  }

  const skirt = new THREE.Mesh(
    new THREE.RingGeometry(worldRadius + 30, worldRadius + 80, 48),
    new THREE.MeshStandardMaterial({ color: 0x4d525c, roughness: 1, side: THREE.DoubleSide })
  );
  skirt.rotation.x = -Math.PI / 2;
  skirt.position.y = -0.05;
  skirt.receiveShadow = true;
  group.add(skirt);

  // ── Boundary ring ────────────────────────────────────────────────
  // Same idea as meadow — a tight ring of moon rocks at the world
  // edge. Greys/blue-greys instead of mossy hues.
  const boundaryCount = 26;
  const boundaryRand = mulberry32(freshSeed());
  for (let i = 0; i < boundaryCount; i++) {
    const a = (i / boundaryCount) * Math.PI * 2;
    const wobble = (boundaryRand() - 0.5) * 1.2;
    const rDist = worldRadius - 1.2 + wobble;
    const x = Math.cos(a) * rDist;
    const z = Math.sin(a) * rDist;
    const size = 1.3 + boundaryRand() * 0.9;
    const rock = makeMoonRock(size);
    rock.position.set(x, 0, z);
    rock.rotation.y = a + boundaryRand() * 0.6;
    group.add(rock);
    obstacles.push({ x, z, radius: size * 0.85 });
  }

  // ── Earth in the sky ─────────────────────────────────────────────
  // Big blue/green sphere hanging behind the world, tilted so the
  // continents read as a recognizable Earth from the camera angle.
  // Marked self-illuminating so it stays bright against the dark sky.
  const earth = makeEarth();
  earth.position.set(-90, 80, -120);
  group.add(earth);

  // Star field — a thousand tiny points scattered on a dome above the
  // play zone. Rendered as a Points cloud so it's cheap.
  group.add(makeStarfield());

  // ── Crater rim debris ────────────────────────────────────────────
  // The craters are now real depressions in the ground (handled
  // above). All we need on top is a scattered ring of impact debris
  // around each rim. Each chunk samples the deformed terrain at its
  // own (x, z) so chunks sit ON the dipped rim, not floating above it.
  const debrisRand = mulberry32(freshSeed());
  for (const c of craterPlans) {
    const rimDebris = makeCraterRimDebris(c, debrisRand, (x, z) => craterDip(x, z) + surfaceHeight(x, z));
    group.add(rimDebris);
  }

  // ── Moon rocks scattered through the play zone ───────────────────
  const rockRand = mulberry32(freshSeed());
  for (let i = 0; i < 16; i++) {
    const size = 0.7 + rockRand() * 1.2;
    const radius = size * 0.78;
    const spot = findOpenSpot(rockRand, worldRadius - 6, radius, obstacles, { minRadius: 6 });
    if (!spot) continue;
    const r = makeMoonRock(size);
    r.position.set(spot.x, 0, spot.z);
    r.rotation.y = rockRand() * Math.PI * 2;
    group.add(r);
    obstacles.push({ x: spot.x, z: spot.z, radius });
  }

  // ── Apollo-style flag landmark ──────────────────────────────────
  // Sits at a fixed position so the kid can use it as a navigation
  // anchor. Cloth waves with a gentle sin so it feels alive in the
  // airless backdrop.
  const flag = makeFlag();
  const flagPos = { x: -10, z: -14 };
  flag.group.position.set(flagPos.x, 0, flagPos.z);
  group.add(flag.group);
  obstacles.push({ x: flagPos.x, z: flagPos.z, radius: 0.5 });
  tick.push(flag.tick);

  // ── Alien NPCs ───────────────────────────────────────────────────
  // Friendly cartoon aliens scattered through the play zone. They
  // wander around their starting position at a stroll, and wave when
  // the player drives close. No collision pushed so the kid can
  // drive right through; the wave is the gameplay reaction.
  const alienRand = mulberry32(freshSeed());
  const ALIEN_COUNT = 6;
  for (let i = 0; i < ALIEN_COUNT; i++) {
    // We pad spawn spots by 4 so a wandering alien (which roams up
    // to ~3 units from home) can't drift into a tree or another
    // prop and look weird.
    const spot = findOpenSpot(alienRand, worldRadius - 6, 4, obstacles, {
      minRadius: 6,
      pad: 0.8,
      maxAttempts: 16,
    });
    if (!spot) continue;
    const hue = alienRand();
    const alien = makeAlien(hue, spot.x, spot.z, getPlayerPosition);
    group.add(alien.group);
    tick.push(alien.tick);
  }

  // ── Floating asteroids ──────────────────────────────────────────
  // Three or four lazy asteroids drifting overhead. Replaces the
  // meadow's butterflies — same shape of code (orbit + rotate).
  const astRand = mulberry32(freshSeed());
  for (let i = 0; i < 4; i++) {
    const orbitR = 8 + astRand() * 18;
    const cx = (astRand() - 0.5) * 30;
    const cz = (astRand() - 0.5) * 30;
    const speed = 0.15 + astRand() * 0.2;
    const phase = astRand() * Math.PI * 2;
    const baseY = 5 + astRand() * 6;
    const size = 0.5 + astRand() * 0.6;
    const a = makeAsteroid(size);
    group.add(a);
    tick.push((_dt, t) => {
      const ang = t * speed + phase;
      a.position.x = cx + Math.cos(ang) * orbitR;
      a.position.z = cz + Math.sin(ang) * orbitR;
      a.position.y = baseY + Math.sin(t * 0.4 + phase) * 0.6;
      a.rotation.y = t * 0.5 + phase;
      a.rotation.x = t * 0.3 + phase * 1.2;
    });
  }
}

// ─── Moon-specific prop factories ─────────────────────────────────────

// Chunky lunar boulder. Same idea as meadow's makeBoulder but in a
// cooler grey palette and with a slight blue tint on the secondary
// rock so silhouettes read.
function makeMoonRock(size: number): THREE.Object3D {
  const g = new THREE.Group();
  const baseGrey = 0.55 + Math.random() * 0.15;
  const tint = new THREE.Color().setHSL(0.6 + Math.random() * 0.08, 0.06, baseGrey);
  const mat = new THREE.MeshStandardMaterial({ color: tint, roughness: 1 });
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

// Just the rim debris around a crater. The crater itself is now a
// real depression in the ground geometry (see buildProps), so all
// this does is scatter dodecahedron chunks around the rim's outer
// edge to read as ejected impact debris. Each chunk samples the
// deformed terrain at its own (x, z) so it sits on the dipped rim
// instead of hovering at y=0.
function makeCraterRimDebris(
  c: { x: number; z: number; radius: number },
  rand: () => number,
  sampleHeight: (x: number, z: number) => number
): THREE.Object3D {
  const g = new THREE.Group();
  const baseShade = 0.42 + rand() * 0.08;
  const rimMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color().setHSL(0.62, 0.06, baseShade + 0.08),
    roughness: 1,
  });
  const debrisCount = 18 + Math.floor(c.radius * 4);
  for (let i = 0; i < debrisCount; i++) {
    const a = (i / debrisCount) * Math.PI * 2 + (rand() - 0.5) * 0.18;
    const dist = c.radius + (rand() - 0.5) * c.radius * 0.22;
    const size = 0.12 + rand() * 0.22;
    const wx = c.x + Math.cos(a) * dist;
    const wz = c.z + Math.sin(a) * dist;
    const wy = sampleHeight(wx, wz) + size * 0.5;
    const chunk = new THREE.Mesh(
      new THREE.DodecahedronGeometry(size, 0),
      rimMat
    );
    chunk.position.set(wx, wy, wz);
    chunk.rotation.set(rand() * Math.PI, rand() * Math.PI, rand() * Math.PI);
    chunk.castShadow = true;
    chunk.receiveShadow = true;
    g.add(chunk);
  }
  return g;
}

// Friendly cartoon alien — chunky round body with an oversized head,
// two big googly eyes on stalks, glowing antenna tips, two stubby
// arms with little sphere hands, cheek blushes, and a wide smile.
// Built so the alien reads as cute even at small on-screen sizes.
//
// Each alien wanders the surface within ~4 units of its starting
// home position, picking a new random target every few seconds.
// When the player drives close, the alien stops walking and waves
// one arm for a few seconds, then resumes its wander. No collision
// (no obstacle pushed) so the kid can drive right through; the wave
// is the gameplay reaction.
function makeAlien(
  hue: number,
  homeX: number,
  homeZ: number,
  getPlayerPosition: () => THREE.Vector3 | null
): { group: THREE.Group; tick: (dt: number, t: number) => void } {
  const group = new THREE.Group();
  group.position.set(homeX, 0, homeZ);

  // Soft contact shadow under the alien — flat dark disc that anchors
  // it to the ground. Lives in the outer group (not the bobbing
  // body sub-group below) so it stays put while the alien breathes
  // above it.
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.45, 24),
    new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.25,
      depthWrite: false,
    })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.02;
  group.add(shadow);

  // Inner sub-group for everything that bobs / walks-bounces. Walking
  // moves the outer group's xz; bobbing moves this inner group's y;
  // the shadow stays planted on the regolith while the alien
  // breathes above it.
  const bob = new THREE.Group();
  group.add(bob);

  // ── Body — round, slightly egg-shaped, two-tone. Head is a
  // slightly lighter shade than the body so the silhouette reads
  // even from far away.
  const bodyColor = new THREE.Color().setHSL(hue, 0.78, 0.55);
  const headColor = new THREE.Color().setHSL(hue, 0.78, 0.65);
  const bodyMat = new THREE.MeshStandardMaterial({
    color: bodyColor,
    roughness: 0.45,
    emissive: bodyColor.clone().multiplyScalar(0.2),
    emissiveIntensity: 0.45,
  });
  const headMat = new THREE.MeshStandardMaterial({
    color: headColor,
    roughness: 0.4,
    emissive: headColor.clone().multiplyScalar(0.2),
    emissiveIntensity: 0.45,
  });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.5, 20, 16), bodyMat);
  body.scale.set(1, 1.05, 1);
  body.position.y = 0.5;
  body.castShadow = true;
  body.receiveShadow = true;
  bob.add(body);

  // Lighter belly inset.
  const bellyMat = new THREE.MeshStandardMaterial({
    color: bodyColor.clone().lerp(new THREE.Color(0xffffff), 0.5),
    roughness: 0.7,
  });
  const belly = new THREE.Mesh(new THREE.SphereGeometry(0.3, 14, 10), bellyMat);
  belly.position.set(0, 0.42, 0.3);
  bob.add(belly);

  // ── Big oversized head.
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.46, 20, 16), headMat);
  head.position.y = 1.05;
  head.castShadow = true;
  head.receiveShadow = true;
  bob.add(head);

  // Bigger, brighter cheek blushes.
  const blushMat = new THREE.MeshBasicMaterial({
    color: 0xff7faa,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
  });
  for (const side of [-1, 1] as const) {
    const blush = new THREE.Mesh(new THREE.CircleGeometry(0.13, 16), blushMat);
    blush.position.set(side * 0.28, 0.92, 0.33);
    blush.lookAt(side * 0.28, 0.92, 1);
    bob.add(blush);
  }

  // ── Eye stalks — short cylinders rising from the head with big
  // sphere eyes on the ends.
  const stalkMat = new THREE.MeshStandardMaterial({ color: bodyColor.clone().multiplyScalar(0.7), roughness: 0.6 });
  const eyeWhiteMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35 });
  const pupilMat = new THREE.MeshStandardMaterial({ color: 0x1c1422, roughness: 0.3 });
  const shineMat = new THREE.MeshBasicMaterial({ color: 0xffffff });

  const stalkPivots: THREE.Group[] = [];
  for (const side of [-1, 1] as const) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.16, 1.32, 0.06);
    bob.add(pivot);
    stalkPivots.push(pivot);

    const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.18, 8), stalkMat);
    stalk.position.y = 0.09;
    stalk.castShadow = true;
    pivot.add(stalk);

    const eyeball = new THREE.Mesh(new THREE.SphereGeometry(0.18, 14, 12), eyeWhiteMat);
    eyeball.position.y = 0.3;
    eyeball.castShadow = true;
    pivot.add(eyeball);

    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 10), pupilMat);
    pupil.position.set(0, 0.3, 0.115);
    pivot.add(pupil);

    const shine = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 6), shineMat);
    shine.position.set(-0.05, 0.34, 0.16);
    pivot.add(shine);
  }

  // ── Antennae with glowing tips.
  const antennaMat = new THREE.MeshStandardMaterial({ color: 0x2a2230, roughness: 0.5 });
  const antennaTipMat = new THREE.MeshStandardMaterial({
    color: bodyColor.clone().lerp(new THREE.Color(0xffffff), 0.55),
    emissive: bodyColor,
    emissiveIntensity: 0.7,
    roughness: 0.4,
  });
  const antennaPivots: THREE.Group[] = [];
  for (const side of [-1, 1] as const) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.24, 1.4, -0.08);
    pivot.rotation.z = -side * 0.3;
    bob.add(pivot);
    antennaPivots.push(pivot);
    const wire = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.025, 0.32, 6), antennaMat);
    wire.position.y = 0.16;
    pivot.add(wire);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 10), antennaTipMat);
    tip.position.y = 0.36;
    pivot.add(tip);
  }

  // ── Wide smile — a thicker torus arc, pushed forward enough to
  // sit clearly on the front of the head and not get hidden by the
  // belly silhouette.
  const mouthMat = new THREE.MeshStandardMaterial({ color: 0x1f1428, roughness: 0.55 });
  const mouth = new THREE.Mesh(
    new THREE.TorusGeometry(0.16, 0.03, 8, 18, Math.PI),
    mouthMat
  );
  mouth.rotation.x = Math.PI / 2;
  mouth.rotation.z = Math.PI; // flip so the curve smiles
  mouth.position.set(0, 0.9, 0.42);
  bob.add(mouth);
  // Tiny tongue blob inside the smile so the mouth feels open and
  // friendly rather than flat.
  const tongue = new THREE.Mesh(
    new THREE.SphereGeometry(0.07, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0xff6f9c, roughness: 0.6 })
  );
  tongue.scale.set(1, 0.45, 0.6);
  tongue.position.set(0, 0.83, 0.45);
  bob.add(tongue);

  // ── Arms — short cylinder with a sphere hand at each end. Pivot
  // at shoulder so we can swing them when walking and raise + wave
  // one when the player gets close.
  const armMat = new THREE.MeshStandardMaterial({ color: bodyColor.clone().multiplyScalar(0.85), roughness: 0.6 });
  const handMat = new THREE.MeshStandardMaterial({ color: bodyColor.clone().lerp(new THREE.Color(0xffffff), 0.2), roughness: 0.55 });
  const armPivots: THREE.Group[] = [];
  const armRest = [
    { x: -0.45, y: 0.7, z: 0, restRot: 0.25 },
    { x: 0.45, y: 0.7, z: 0, restRot: -0.25 },
  ];
  for (const a of armRest) {
    const pivot = new THREE.Group();
    pivot.position.set(a.x, a.y, a.z);
    pivot.rotation.z = a.restRot;
    bob.add(pivot);
    armPivots.push(pivot);
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.06, 0.32, 8), armMat);
    arm.position.y = -0.16;
    arm.castShadow = true;
    pivot.add(arm);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 10), handMat);
    hand.position.y = -0.34;
    hand.castShadow = true;
    pivot.add(hand);
  }

  // ── Stubby feet.
  const footMat = new THREE.MeshStandardMaterial({ color: bodyColor.clone().multiplyScalar(0.6), roughness: 0.7 });
  for (const side of [-1, 1] as const) {
    const foot = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 8), footMat);
    foot.scale.set(1, 0.4, 1.2);
    foot.position.set(side * 0.2, 0.06, 0.02);
    foot.castShadow = true;
    bob.add(foot);
  }

  // ── Per-instance state ──────────────────────────────────────────
  // Each alien picks a target within ~3 units of home and walks to
  // it; on arrival, idles briefly then picks a new target. Anchored
  // to home so they don't drift across the world over time.
  const home = new THREE.Vector3(homeX, 0, homeZ);
  let target = pickWanderTarget(home);
  let nextRetargetAt = 0; // populated on first tick with a randomized initial value
  let facing = group.rotation.y;
  let walking = true;
  // Wave state — when the player gets close, we lock into "waving"
  // mode for waveDuration seconds, then enter a cooldown so a kid
  // pressed against the alien doesn't restart the wave every frame.
  let waveT = 0;
  let waveCooldown = 0;
  const waveDuration = 2.0;
  const waveCooldownAfter = 4.5;
  const detectRadius = 1.8;

  const phase = Math.random() * Math.PI * 2;
  const bobSpeed = 1.4 + Math.random() * 0.6;
  const swaySpeed = 0.7 + Math.random() * 0.5;
  const blinkOffset = Math.random() * 8;
  const eyeballs: THREE.Mesh[] = [];
  bob.traverse((obj) => {
    const m = obj as THREE.Mesh;
    if (m.isMesh && m.material === eyeWhiteMat) eyeballs.push(m);
  });

  function pickWanderTarget(home: THREE.Vector3): THREE.Vector3 {
    const a = Math.random() * Math.PI * 2;
    const r = 1 + Math.random() * 3;
    return new THREE.Vector3(home.x + Math.cos(a) * r, 0, home.z + Math.sin(a) * r);
  }

  return {
    group,
    tick: (dt, t) => {
      if (nextRetargetAt === 0) nextRetargetAt = t + 1.2 + Math.random() * 1.5;

      // ── Wave detection ────────────────────────────────────────
      const player = getPlayerPosition();
      if (waveT === 0 && waveCooldown <= 0 && player) {
        const dx = player.x - group.position.x;
        const dz = player.z - group.position.z;
        if (dx * dx + dz * dz < detectRadius * detectRadius) {
          waveT = waveDuration;
          walking = false;
          // Face the player while waving.
          const targetYaw = Math.atan2(dx, dz);
          facing = targetYaw;
          group.rotation.y = facing;
        }
      }

      // ── Walking ───────────────────────────────────────────────
      if (walking) {
        const dx = target.x - group.position.x;
        const dz = target.z - group.position.z;
        const distToTarget = Math.hypot(dx, dz);
        if (distToTarget < 0.25 || t > nextRetargetAt) {
          target = pickWanderTarget(home);
          nextRetargetAt = t + 2 + Math.random() * 3;
        } else {
          const speed = 0.85;
          group.position.x += (dx / distToTarget) * speed * dt;
          group.position.z += (dz / distToTarget) * speed * dt;
          // Lerp facing toward direction of travel.
          const targetYaw = Math.atan2(dx, dz);
          let delta = targetYaw - facing;
          while (delta > Math.PI) delta -= Math.PI * 2;
          while (delta < -Math.PI) delta += Math.PI * 2;
          facing += delta * 0.12;
          group.rotation.y = facing;
        }
      }

      // ── Body bob ──────────────────────────────────────────────
      // While walking, bob a little faster + bigger to imply
      // bouncy steps; while waving, slow gentle bob in place.
      const bobAmt = walking ? 0.11 : 0.06;
      bob.position.y = Math.abs(Math.sin(t * bobSpeed + phase)) * bobAmt;

      // ── Eye stalk sway ────────────────────────────────────────
      for (let i = 0; i < stalkPivots.length; i++) {
        stalkPivots[i].rotation.z = Math.sin(t * swaySpeed + phase + i * 0.6) * 0.18;
        stalkPivots[i].rotation.x = Math.cos(t * swaySpeed * 0.8 + phase) * 0.08;
      }
      // Antennae waggle.
      for (let i = 0; i < antennaPivots.length; i++) {
        const sign = i === 0 ? -1 : 1;
        antennaPivots[i].rotation.z = sign * 0.3 + Math.sin(t * 1.6 + phase + i) * 0.22;
      }
      // Periodic blink.
      const blinkPhase = (t + blinkOffset) % 4.2;
      const blink = blinkPhase < 0.16 ? Math.cos(blinkPhase / 0.16 * Math.PI) * 0.5 + 0.5 : 1;
      for (const e of eyeballs) e.scale.y = blink;

      // ── Arm animation ─────────────────────────────────────────
      // Walking: arms swing back and forth with the gait.
      // Waving: right arm raises overhead and oscillates side-to-side
      // for the duration; left arm stays at rest.
      if (waveT > 0) {
        // Wave progress 0..1 (0 at start, 1 at end).
        const k = 1 - waveT / waveDuration;
        // Ease the raise so it lifts smoothly into wave position
        // and lowers smoothly at the end.
        const raise = Math.sin(Math.min(1, k * 4) * Math.PI / 2); // ease-in
        const release = k > 0.85 ? (k - 0.85) / 0.15 : 0;
        const r = raise * (1 - release);
        // Right arm — lift up and oscillate Z rotation.
        armPivots[1].rotation.z = -0.25 - r * 1.9;
        armPivots[1].rotation.x = -r * 0.3;
        armPivots[1].rotation.y = Math.sin(k * Math.PI * 8) * 0.55 * r;
        // Left arm — gently swing in the rest pose.
        armPivots[0].rotation.z = 0.25 + Math.sin(t * 2) * 0.06;
        armPivots[0].rotation.x = 0;
        armPivots[0].rotation.y = 0;
        waveT = Math.max(0, waveT - dt);
        if (waveT === 0) {
          walking = true;
          waveCooldown = waveCooldownAfter;
        }
      } else {
        // Walking arm swing — both arms oscillate, mirrored.
        const swing = walking ? Math.sin(t * 4 + phase) * 0.35 : 0;
        armPivots[0].rotation.z = 0.25 + swing;
        armPivots[0].rotation.x = swing * 0.4;
        armPivots[0].rotation.y = 0;
        armPivots[1].rotation.z = -0.25 - swing;
        armPivots[1].rotation.x = -swing * 0.4;
        armPivots[1].rotation.y = 0;
        waveCooldown = Math.max(0, waveCooldown - dt);
      }
    },
  };
}

// Big tilted Earth far in the sky. Two-sphere construction so the
// land masses read against the ocean even at low resolution. Self-
// illuminated so the dark side stays visible against the night sky.
function makeEarth(): THREE.Object3D {
  const g = new THREE.Group();
  const ocean = new THREE.Mesh(
    new THREE.SphereGeometry(18, 32, 24),
    new THREE.MeshStandardMaterial({
      color: 0x2c6cb6,
      roughness: 0.7,
      emissive: 0x1a3f6a,
      emissiveIntensity: 0.5,
    })
  );
  g.add(ocean);
  // Continents — random-shaped raised patches in green.
  const landMat = new THREE.MeshStandardMaterial({
    color: 0x4faf6a,
    roughness: 0.85,
    emissive: 0x254f33,
    emissiveIntensity: 0.4,
  });
  const landRand = mulberry32(0xea27ea);
  for (let i = 0; i < 8; i++) {
    const land = new THREE.Mesh(
      new THREE.SphereGeometry(2 + landRand() * 4, 12, 10),
      landMat
    );
    // Random direction on a sphere — uniform sampling.
    const u = landRand() * 2 - 1;
    const phi = landRand() * Math.PI * 2;
    const r = Math.sqrt(1 - u * u);
    const dir = new THREE.Vector3(r * Math.cos(phi), u, r * Math.sin(phi));
    land.position.copy(dir.multiplyScalar(17.6));
    // Flatten slightly so they look like raised continents on a
    // sphere instead of free-floating blobs.
    land.scale.y = 0.4;
    land.lookAt(0, 0, 0);
    g.add(land);
  }
  // Soft glow halo behind the planet for atmosphere.
  const halo = new THREE.Mesh(
    new THREE.SphereGeometry(20, 24, 16),
    new THREE.MeshBasicMaterial({
      color: 0x9ec8ff,
      transparent: true,
      opacity: 0.18,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.BackSide,
    })
  );
  g.add(halo);
  g.rotation.set(0.4, 0.6, 0.2);
  return g;
}

// 600 randomly-placed star points scattered on a hemisphere above
// the play zone. Cheap (a single Points draw call) and they sit
// out beyond fog range so the dark sky never feels empty.
function makeStarfield(): THREE.Object3D {
  const count = 600;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    // Hemisphere bias — y always positive so stars sit above ground.
    const phi = Math.random() * Math.PI * 2;
    const theta = Math.acos(Math.random() * 0.9 + 0.05); // 0..~70°
    const r = 180 + Math.random() * 30;
    positions[i * 3 + 0] = r * Math.sin(theta) * Math.cos(phi);
    positions[i * 3 + 1] = r * Math.cos(theta);
    positions[i * 3 + 2] = r * Math.sin(theta) * Math.sin(phi);
    // Slight blue/yellow temperature jitter so the field has subtle
    // colour variation rather than uniform white.
    const k = 0.85 + Math.random() * 0.15;
    colors[i * 3 + 0] = k * (0.95 + Math.random() * 0.05);
    colors[i * 3 + 1] = k * (0.95 + Math.random() * 0.05);
    colors[i * 3 + 2] = k * (0.95 + Math.random() * 0.1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.PointsMaterial({
    size: 1.4,
    vertexColors: true,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
  });
  return new THREE.Points(geo, mat);
}

// Planted flag — pole + cloth + small base. Cloth waves on a sine so
// the otherwise still vacuum landscape has at least one moving thing
// (alongside the asteroids).
function makeFlag(): { group: THREE.Group; tick: (dt: number, t: number) => void } {
  const group = new THREE.Group();
  const baseMat = new THREE.MeshStandardMaterial({ color: 0x6c7280, roughness: 1 });
  // Footing rocks
  const base = new THREE.Mesh(new THREE.DodecahedronGeometry(0.3, 0), baseMat);
  base.position.y = 0.15;
  base.castShadow = true;
  group.add(base);
  // Pole
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.04, 2.2, 8),
    new THREE.MeshStandardMaterial({ color: 0xe5e5ec, roughness: 0.6, metalness: 0.4 })
  );
  pole.position.y = 1.25;
  pole.castShadow = true;
  group.add(pole);
  // Cloth — flat plane subdivided so we can wiggle the vertices with
  // a sin wave for that no-air "flag stiffened with wire" look.
  const clothGeo = new THREE.PlaneGeometry(0.9, 0.55, 8, 4);
  const clothMat = new THREE.MeshStandardMaterial({
    color: 0xe43c3c,
    roughness: 0.9,
    side: THREE.DoubleSide,
  });
  const cloth = new THREE.Mesh(clothGeo, clothMat);
  cloth.position.set(0.45, 1.95, 0);
  cloth.castShadow = true;
  group.add(cloth);
  // Stripe accent on the lower half of the cloth.
  const stripeGeo = new THREE.PlaneGeometry(0.9, 0.18);
  const stripe = new THREE.Mesh(
    stripeGeo,
    new THREE.MeshStandardMaterial({ color: 0xfafafa, roughness: 0.8, side: THREE.DoubleSide })
  );
  stripe.position.set(0.45, 1.78, 0.001);
  group.add(stripe);

  // Cache the cloth geometry's base x positions so we can apply a
  // travelling wave without accumulating drift across frames.
  const positions = clothGeo.attributes.position;
  const baseY = new Float32Array(positions.count);
  for (let i = 0; i < positions.count; i++) baseY[i] = positions.getY(i);

  return {
    group,
    tick: (_dt: number, t: number) => {
      // Travelling sine — phase advances with time, amplitude scales
      // with distance from the pole so the tip waves more than the
      // attachment.
      for (let i = 0; i < positions.count; i++) {
        const x = positions.getX(i);
        const distFromPole = (x + 0.45) / 0.9; // 0 at pole, 1 at tip
        const wave = Math.sin(t * 3 + x * 6) * 0.06 * distFromPole;
        positions.setZ(i, wave);
        positions.setY(i, baseY[i] + Math.cos(t * 3 + x * 6) * 0.02 * distFromPole);
      }
      positions.needsUpdate = true;
    },
  };
}

// Floating asteroid — irregular dodecahedron with a darker companion
// stuck to its side, no collision (sits well above the play surface).
function makeAsteroid(size: number): THREE.Object3D {
  const g = new THREE.Group();
  const tint = new THREE.Color().setHSL(0.05 + Math.random() * 0.1, 0.15, 0.4 + Math.random() * 0.1);
  const mat = new THREE.MeshStandardMaterial({ color: tint, roughness: 1 });
  const main = new THREE.Mesh(new THREE.DodecahedronGeometry(size, 0), mat);
  main.castShadow = true;
  g.add(main);
  const chip = new THREE.Mesh(new THREE.DodecahedronGeometry(size * 0.5, 0), mat);
  chip.position.set(size * 0.7, size * 0.2, size * 0.1);
  chip.rotation.set(0.2, 0.4, 0.6);
  g.add(chip);
  return g;
}
