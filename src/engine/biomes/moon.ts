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

// Decorative ground crater — flat dark inner disc, raised stone rim.
// Built as a low torus + an inset disc so the kid can drive across
// without bumping geometry.
function makeCrater(radius: number): THREE.Object3D {
  const g = new THREE.Group();
  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(radius, radius * 0.18, 6, 18),
    new THREE.MeshStandardMaterial({ color: 0x6c7280, roughness: 1 })
  );
  rim.rotation.x = -Math.PI / 2;
  rim.position.y = 0.04;
  rim.receiveShadow = true;
  g.add(rim);
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(radius * 0.92, 24),
    new THREE.MeshStandardMaterial({ color: 0x4b515c, roughness: 1 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.02;
  floor.receiveShadow = true;
  g.add(floor);
  return g;
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
