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
  const { group, obstacles, tick, worldRadius } = ctx;

  // ── Ground ────────────────────────────────────────────────────────
  // Pale dusty regolith with a dark outer skirt for depth.
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(worldRadius + 30, 64),
    new THREE.MeshStandardMaterial({ color: 0x9aa0aa, roughness: 1 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);
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

  // ── Craters ──────────────────────────────────────────────────────
  // Decorative ground craters scattered across the play zone. Not
  // collidable (the kid drives over them) but visually punctuates
  // the surface with relief.
  const craterRand = mulberry32(freshSeed());
  for (let i = 0; i < 22; i++) {
    const radius = 1.4 + craterRand() * 1.6;
    const spot = findOpenSpot(craterRand, worldRadius - 4, 0.3, obstacles, {
      minRadius: 4,
      pad: 0.6,
      maxAttempts: 14,
    });
    if (!spot) continue;
    const c = makeCrater(radius);
    c.position.set(spot.x, 0, spot.z);
    c.rotation.y = craterRand() * Math.PI * 2;
    group.add(c);
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
  // Friendly cartoon aliens scattered through the play zone. No
  // collision (the kid can drive right through them) so the finale's
  // letter-bumping mechanic doesn't get confused by an alien acting
  // as an obstacle. Each one bobs / waggles antennae / blinks on
  // its own randomized phase.
  const alienRand = mulberry32(freshSeed());
  const ALIEN_COUNT = 5;
  for (let i = 0; i < ALIEN_COUNT; i++) {
    const spot = findOpenSpot(alienRand, worldRadius - 5, 0.6, obstacles, {
      minRadius: 5,
      pad: 0.8,
      maxAttempts: 16,
    });
    if (!spot) continue;
    const hue = alienRand();
    const alien = makeAlien(hue);
    alien.group.position.set(spot.x, 0, spot.z);
    alien.group.rotation.y = alienRand() * Math.PI * 2;
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

// Decorative ground crater — looks like a real impact site rather
// than a torus + disc. Profile: a tapered bowl wall sloping inward
// to a recessed floor, an irregular debris rim built from a ring of
// jittered dodecahedron chunks, and a darker shadow ring near the
// floor for depth. Drivable (no collision); the floor sits below
// y=0 and the rim is short enough that the kid can roll over it.
function makeCrater(radius: number): THREE.Object3D {
  const g = new THREE.Group();
  // Per-instance colour jitter so adjacent craters don't look like
  // copy-pastes — the eye picks up subtle hue/lightness shifts even
  // at low resolution.
  const baseShade = 0.42 + Math.random() * 0.08;
  const wallMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color().setHSL(0.62, 0.04, baseShade),
    roughness: 1,
  });
  const floorMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color().setHSL(0.62, 0.04, baseShade - 0.18),
    roughness: 1,
  });
  const rimMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color().setHSL(0.62, 0.06, baseShade + 0.08),
    roughness: 1,
  });

  // ── Bowl wall — open-top tapered cylinder. Slightly larger top
  // radius than bottom so the wall slopes inward toward the floor.
  const wallDepth = Math.min(0.55, radius * 0.35);
  const wall = new THREE.Mesh(
    new THREE.CylinderGeometry(
      radius,           // top radius (ground level)
      radius * 0.55,    // bottom radius (floor)
      wallDepth,
      32,
      1,
      true              // open-ended — we add a separate floor disc
    ),
    wallMat
  );
  wall.position.y = -wallDepth * 0.5 + 0.02;
  wall.receiveShadow = true;
  g.add(wall);

  // ── Floor — recessed disc, slightly darker.
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(radius * 0.55, 24),
    floorMat
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -wallDepth + 0.02;
  floor.receiveShadow = true;
  g.add(floor);

  // ── Inner shadow ring — thin darker disc near the bottom of the
  // wall to imply ambient occlusion under the lip.
  const shadow = new THREE.Mesh(
    new THREE.RingGeometry(radius * 0.55, radius * 0.85, 32),
    new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.22,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = -wallDepth + 0.025;
  g.add(shadow);

  // ── Debris rim — irregular ring of small chunks around the lip.
  // Each chunk is a tiny dodecahedron with random rotation + size
  // so the rim reads as scattered impact debris rather than a
  // perfect torus.
  const debrisCount = 18 + Math.floor(radius * 4);
  for (let i = 0; i < debrisCount; i++) {
    const a = (i / debrisCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.18;
    const dist = radius + (Math.random() - 0.5) * radius * 0.18;
    const size = 0.12 + Math.random() * 0.18;
    const chunk = new THREE.Mesh(
      new THREE.DodecahedronGeometry(size, 0),
      rimMat
    );
    chunk.position.set(
      Math.cos(a) * dist,
      size * 0.55,
      Math.sin(a) * dist
    );
    chunk.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
    chunk.castShadow = true;
    chunk.receiveShadow = true;
    g.add(chunk);
  }

  return g;
}

// Friendly cartoon alien — squishy egg body, two big googly eyes on
// stalks, a pair of waving antennae, and a small mouth. Renders in
// a saturated hue so they pop against the gray regolith. No
// collision — the kid can drive right through them, which keeps the
// finale's letter-bumping mechanic clean. Returns a tick callback
// for idle bobbing + slow eye-stalk sway.
function makeAlien(hue: number): { group: THREE.Group; tick: (dt: number, t: number) => void } {
  const group = new THREE.Group();

  // ── Body — squat egg, slightly flattened bottom so it doesn't
  // look like it's about to roll away.
  const bodyColor = new THREE.Color().setHSL(hue, 0.7, 0.55);
  const bodyMat = new THREE.MeshStandardMaterial({
    color: bodyColor,
    roughness: 0.55,
    emissive: bodyColor.clone().multiplyScalar(0.15),
    emissiveIntensity: 0.4,
  });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.55, 18, 14), bodyMat);
  body.scale.set(1, 1.15, 1);
  body.position.y = 0.6;
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  // Belly — slightly lighter inset on the front so the alien has a
  // tummy that catches light differently from the back.
  const bellyMat = new THREE.MeshStandardMaterial({
    color: bodyColor.clone().lerp(new THREE.Color(0xffffff), 0.35),
    roughness: 0.7,
  });
  const belly = new THREE.Mesh(new THREE.SphereGeometry(0.32, 14, 10), bellyMat);
  belly.position.set(0, 0.5, 0.32);
  group.add(belly);

  // ── Eye stalks — two short cylinders rising from the top of the
  // head with big sphere eyes on the ends. Stalks pivot at the
  // base so we can wave them in the tick.
  const stalkMat = new THREE.MeshStandardMaterial({ color: bodyColor.clone().multiplyScalar(0.7), roughness: 0.6 });
  const eyeWhiteMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 });
  const pupilMat = new THREE.MeshStandardMaterial({ color: 0x1c1422, roughness: 0.3 });
  const shineMat = new THREE.MeshBasicMaterial({ color: 0xffffff });

  const stalkPivots: THREE.Group[] = [];
  for (const side of [-1, 1] as const) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.18, 1.05, 0.02);
    group.add(pivot);
    stalkPivots.push(pivot);

    const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.32, 8), stalkMat);
    stalk.position.y = 0.16;
    stalk.castShadow = true;
    pivot.add(stalk);

    const eyeball = new THREE.Mesh(new THREE.SphereGeometry(0.16, 14, 12), eyeWhiteMat);
    eyeball.position.y = 0.42;
    eyeball.castShadow = true;
    pivot.add(eyeball);

    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 10), pupilMat);
    pupil.position.set(0, 0.42, 0.11);
    pivot.add(pupil);

    const shine = new THREE.Mesh(new THREE.SphereGeometry(0.025, 6, 6), shineMat);
    shine.position.set(-0.04, 0.46, 0.15);
    pivot.add(shine);
  }

  // ── Antennae — thin curved wires with little sphere tips that
  // glow. Two antennae, mirrored.
  const antennaMat = new THREE.MeshStandardMaterial({ color: 0x2a2230, roughness: 0.5 });
  const antennaTipMat = new THREE.MeshStandardMaterial({
    color: bodyColor.clone().lerp(new THREE.Color(0xffffff), 0.55),
    emissive: bodyColor,
    emissiveIntensity: 0.6,
    roughness: 0.4,
  });
  const antennaPivots: THREE.Group[] = [];
  for (const side of [-1, 1] as const) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.26, 1.1, -0.05);
    pivot.rotation.z = -side * 0.3;
    group.add(pivot);
    antennaPivots.push(pivot);
    const wire = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.025, 0.35, 6), antennaMat);
    wire.position.y = 0.18;
    pivot.add(wire);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 10), antennaTipMat);
    tip.position.y = 0.4;
    pivot.add(tip);
  }

  // ── Mouth — small dark crescent so the alien reads as friendly.
  const mouth = new THREE.Mesh(
    new THREE.TorusGeometry(0.07, 0.018, 6, 12, Math.PI),
    new THREE.MeshStandardMaterial({ color: 0x2a1a30, roughness: 0.7 })
  );
  mouth.rotation.x = Math.PI / 2;
  mouth.rotation.z = Math.PI; // flip so the curve smiles
  mouth.position.set(0, 0.78, 0.5);
  group.add(mouth);

  // ── Tiny feet — two flat ovals so the alien doesn't look like
  // it's floating.
  const footMat = new THREE.MeshStandardMaterial({ color: bodyColor.clone().multiplyScalar(0.6), roughness: 0.7 });
  for (const side of [-1, 1] as const) {
    const foot = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 8), footMat);
    foot.scale.set(1, 0.4, 1.2);
    foot.position.set(side * 0.22, 0.06, 0.02);
    foot.castShadow = true;
    group.add(foot);
  }

  // Per-instance phase / speed so a cluster of aliens doesn't bob in
  // unison and read as mechanical.
  const phase = Math.random() * Math.PI * 2;
  const bobSpeed = 1.2 + Math.random() * 0.6;
  const swaySpeed = 0.7 + Math.random() * 0.5;
  const blinkOffset = Math.random() * 8;
  const eyeballs: THREE.Mesh[] = [];
  group.traverse((obj) => {
    // Capture eyeballs after the fact so we can scale them on blink.
    const m = obj as THREE.Mesh;
    if (m.isMesh && m.material === eyeWhiteMat) eyeballs.push(m);
  });

  return {
    group,
    tick: (_dt, t) => {
      // Gentle full-body bob.
      group.position.y = Math.abs(Math.sin(t * bobSpeed + phase)) * 0.08;
      // Eye stalks sway side-to-side, slightly out of phase with each other.
      for (let i = 0; i < stalkPivots.length; i++) {
        stalkPivots[i].rotation.z = Math.sin(t * swaySpeed + phase + i * 0.6) * 0.18;
        stalkPivots[i].rotation.x = Math.cos(t * swaySpeed * 0.8 + phase) * 0.08;
      }
      // Antennae waggle, more amplitude than the eye stalks.
      for (let i = 0; i < antennaPivots.length; i++) {
        const sign = i === 0 ? -1 : 1;
        antennaPivots[i].rotation.z = sign * 0.3 + Math.sin(t * 1.6 + phase + i) * 0.22;
      }
      // Periodic blink — every 3-5s, scale eyeball Y briefly to 0.
      const blinkPhase = (t + blinkOffset) % 4.2;
      const blink = blinkPhase < 0.16 ? Math.cos(blinkPhase / 0.16 * Math.PI) * 0.5 + 0.5 : 1;
      for (const e of eyeballs) {
        e.scale.y = blink;
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
