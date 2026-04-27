import * as THREE from "three";

// Deterministic pseudo-random — same world every load.
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORLD_RADIUS = 60;

// An obstacle the player and letters should avoid. We model every world
// prop as a vertical cylinder (good enough for the round-ish shapes we
// have: hills, trees, mushrooms). Only objects within the play zone end
// up in this list — the distant skirt and ground itself are excluded
// because nothing collides with them.
export type Obstacle = { x: number; z: number; radius: number };

export type WorldHandles = {
  group: THREE.Group;
  worldRadius: number;
  obstacles: Obstacle[];
  // Per-frame animations (drifting butterflies, water shimmer, etc.).
  // The Engine wires each of these into its actor list.
  tick: Array<(dt: number, t: number) => void>;
};

export function buildWorld(): WorldHandles {
  const group = new THREE.Group();
  group.name = "World";
  const obstacles: Obstacle[] = [];
  const tick: Array<(dt: number, t: number) => void> = [];

  // Ground — large green disc
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(WORLD_RADIUS + 30, 64),
    new THREE.MeshStandardMaterial({ color: 0x86d36a, roughness: 1 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);

  // Distant skirt — smaller darker disc behind for depth
  const skirt = new THREE.Mesh(
    new THREE.RingGeometry(WORLD_RADIUS + 30, WORLD_RADIUS + 80, 48),
    new THREE.MeshStandardMaterial({ color: 0x6db854, roughness: 1, side: THREE.DoubleSide })
  );
  skirt.rotation.x = -Math.PI / 2;
  skirt.position.y = -0.05;
  skirt.receiveShadow = true;
  group.add(skirt);

  // ── Boundary ring ──────────────────────────────────────────────────────
  // Ring of chubby boulders just inside WORLD_RADIUS. Doubles as the
  // visual "edge of the world" cue so kids can see where the play zone
  // ends, plus collision (Engine still has a hard clamp regardless of
  // any gaps between rocks). Spaced tight enough that you can see them
  // from anywhere on the map.
  const boundaryCount = 26;
  for (let i = 0; i < boundaryCount; i++) {
    const a = (i / boundaryCount) * Math.PI * 2;
    const wobble = Math.sin(i * 1.7) * 0.6;
    const rDist = WORLD_RADIUS - 1.2 + wobble;
    const x = Math.cos(a) * rDist;
    const z = Math.sin(a) * rDist;
    const size = 1.2 + ((i * 31) % 100) / 130; // 1.2..1.97, deterministic
    const rock = makeBoulder(size, (i * 53) % 360);
    rock.position.set(x, 0, z);
    rock.rotation.y = a;
    group.add(rock);
    obstacles.push({ x, z, radius: size * 0.85 });
  }

  // ── Pond ────────────────────────────────────────────────────────────────
  // A small lily-pad pond off-centre. Adds a landmark kids can drive to
  // and around. Marked as a fat obstacle so the buggy doesn't slide
  // across the surface.
  const pond = makePond();
  const pondPos = { x: 14, z: -16 };
  pond.group.position.set(pondPos.x, 0, pondPos.z);
  group.add(pond.group);
  obstacles.push({ x: pondPos.x, z: pondPos.z, radius: pond.radius });
  tick.push(pond.tick);

  // Hills — soft spheres in the distance. Pushed out of the play zone so the
  // kid never walks "into" one.
  const hillRand = mulberry32(11);
  for (let i = 0; i < 18; i++) {
    const r = 8 + hillRand() * 14;
    const x = (hillRand() - 0.5) * 130;
    const z = (hillRand() - 0.5) * 130;
    if (Math.hypot(x, z) < 40) continue;
    const hue = 95 + hillRand() * 35;
    const hill = new THREE.Mesh(
      new THREE.SphereGeometry(r, 16, 12),
      new THREE.MeshStandardMaterial({ color: new THREE.Color(`hsl(${hue}, 55%, 55%)`), roughness: 0.95 })
    );
    hill.position.set(x, r * 0.3 - 0.5, z);
    hill.castShadow = false;
    hill.receiveShadow = true;
    group.add(hill);
    // Hills sit beyond the boundary ring, no collision needed (the
    // boundary clamp keeps the player away).
  }

  // Trees — packed inside the boundary ring (radius < WORLD_RADIUS - 4)
  // so they never visually clip the boulder ring or the skirt beyond.
  const treeRand = mulberry32(7);
  for (let i = 0; i < 26; i++) {
    const x = (treeRand() - 0.5) * 90;
    const z = (treeRand() - 0.5) * 90;
    if (Math.hypot(x, z) < 8) continue;
    if (Math.hypot(x, z) > WORLD_RADIUS - 4) continue;
    if (Math.hypot(x - pondPos.x, z - pondPos.z) < pond.radius + 2) continue;
    const scale = 0.9 + treeRand() * 0.7;
    const hue = 100 + treeRand() * 40;
    const tree = makeTree(hue, scale);
    tree.position.set(x, 0, z);
    group.add(tree);
    obstacles.push({ x, z, radius: 1.4 * scale });
  }

  // Mushrooms
  const mushRand = mulberry32(23);
  for (let i = 0; i < 22; i++) {
    const x = (mushRand() - 0.5) * 90;
    const z = (mushRand() - 0.5) * 90;
    if (Math.hypot(x, z) < 6) continue;
    if (Math.hypot(x, z) > WORLD_RADIUS - 4) continue;
    if (Math.hypot(x - pondPos.x, z - pondPos.z) < pond.radius + 1.5) continue;
    const hue = mushRand() * 360;
    const m = makeMushroom(hue);
    m.position.set(x, 0, z);
    group.add(m);
    obstacles.push({ x, z, radius: 0.7 });
  }

  // Boulders — chunky scattered rocks for visual variety + collision so
  // the kid has stuff to drive around.
  const boulderRand = mulberry32(89);
  for (let i = 0; i < 8; i++) {
    const x = (boulderRand() - 0.5) * 80;
    const z = (boulderRand() - 0.5) * 80;
    if (Math.hypot(x, z) < 6) continue;
    if (Math.hypot(x, z) > WORLD_RADIUS - 6) continue;
    if (Math.hypot(x - pondPos.x, z - pondPos.z) < pond.radius + 2) continue;
    const size = 0.9 + boulderRand() * 0.7;
    const hue = (boulderRand() * 360) | 0;
    const b = makeBoulder(size, hue);
    b.position.set(x, 0, z);
    b.rotation.y = boulderRand() * Math.PI * 2;
    group.add(b);
    obstacles.push({ x, z, radius: size * 0.8 });
  }

  // Flowers — purely decorative (no collision). Kids can drive over
  // them. Painted as flat coloured discs with a tiny stem so they read
  // from the camera angle without spamming geometry.
  const flowerRand = mulberry32(131);
  for (let i = 0; i < 60; i++) {
    const x = (flowerRand() - 0.5) * 95;
    const z = (flowerRand() - 0.5) * 95;
    if (Math.hypot(x, z) > WORLD_RADIUS - 3) continue;
    if (Math.hypot(x - pondPos.x, z - pondPos.z) < pond.radius + 1) continue;
    // Flowers cluster nicely if they cling near trees / mushrooms, but
    // a clear spawn check is overkill for decoration — accept the
    // occasional overlap.
    const hue = flowerRand() * 360;
    const f = makeFlower(hue);
    f.position.set(x, 0, z);
    f.rotation.y = flowerRand() * Math.PI * 2;
    group.add(f);
  }

  // Butterflies — drift in lazy arcs above the play zone. Adds a sense
  // of life so the world feels lived-in, not a static diorama.
  const butterflyRand = mulberry32(211);
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
      // Wing flap — fast cosine flutter on both wings, mirrored.
      const flap = Math.sin(t * 18 + phase) * 0.55;
      b.wingL.rotation.y = -flap;
      b.wingR.rotation.y = flap;
    });
  }

  // Clouds
  const cloudRand = mulberry32(53);
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

  return { group, worldRadius: WORLD_RADIUS, obstacles, tick };
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
  rng: () => number
): { x: number; z: number } {
  const { minRadius, maxRadius } = bounds;
  for (let attempt = 0; attempt < 60; attempt++) {
    const angle = rng() * Math.PI * 2;
    const dist = minRadius + rng() * (maxRadius - minRadius);
    const x = Math.cos(angle) * dist;
    const z = Math.sin(angle) * dist;
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
    x: Math.cos(fallbackAngle) * minRadius,
    z: Math.sin(fallbackAngle) * minRadius,
  };
}

function makeTree(hue: number, scale: number) {
  const tree = new THREE.Group();
  tree.scale.setScalar(scale);
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.22, 0.32, 1.4, 8),
    new THREE.MeshStandardMaterial({ color: 0x7a4a22, roughness: 1 })
  );
  trunk.position.y = 0.7;
  trunk.castShadow = true;
  trunk.receiveShadow = true;
  tree.add(trunk);

  const leafColor = new THREE.Color(`hsl(${hue}, 60%, 45%)`);
  const leafMat = new THREE.MeshStandardMaterial({ color: leafColor, roughness: 0.9 });
  for (let i = 0; i < 3; i++) {
    const c = new THREE.Mesh(new THREE.ConeGeometry(1.2 - i * 0.3, 1.6 - i * 0.4, 8), leafMat);
    c.position.y = 2.0 + i * 0.8;
    c.castShadow = true;
    tree.add(c);
  }
  return tree;
}

function makeMushroom(hue: number) {
  const m = new THREE.Group();
  const stem = new THREE.Mesh(
    new THREE.CylinderGeometry(0.18, 0.22, 0.6, 10),
    new THREE.MeshStandardMaterial({ color: 0xf6f1d6, roughness: 0.8 })
  );
  stem.position.y = 0.3;
  stem.castShadow = true;
  m.add(stem);

  const cap = new THREE.Mesh(
    new THREE.SphereGeometry(0.5, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(`hsl(${hue}, 80%, 55%)`), roughness: 0.7 })
  );
  cap.position.y = 0.75;
  cap.castShadow = true;
  m.add(cap);

  // Spots
  const spotMat = new THREE.MeshStandardMaterial({ color: 0xf6f1d6 });
  for (let i = 0; i < 3; i++) {
    const s = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8), spotMat);
    s.position.set(
      Math.cos(i * 2.3) * 0.28,
      0.85,
      Math.sin(i * 2.3) * 0.28
    );
    m.add(s);
  }
  return m;
}

function makeCloud() {
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

// Chunky decorative boulder. The hue argument lets the boundary ring
// pull from a wider palette so the rocks don't look identical going
// around the perimeter — colours sit in a narrow grey-tan band.
function makeBoulder(size: number, hue: number) {
  const g = new THREE.Group();
  // Slight desaturation keeps boulders feeling like rocks even when
  // pulled toward a colourful hue.
  const baseColor = new THREE.Color(`hsl(${hue}, 18%, 56%)`);
  const mat = new THREE.MeshStandardMaterial({ color: baseColor, roughness: 1 });
  const main = new THREE.Mesh(new THREE.DodecahedronGeometry(size, 0), mat);
  main.position.y = size * 0.45;
  main.castShadow = true;
  main.receiveShadow = true;
  g.add(main);
  // Tiny secondary rock for silhouette interest.
  const small = new THREE.Mesh(new THREE.DodecahedronGeometry(size * 0.45, 0), mat);
  small.position.set(size * 0.7, size * 0.25, size * 0.2);
  small.rotation.set(0.3, 0.6, 0.1);
  small.castShadow = true;
  g.add(small);
  return g;
}

// Lily-pond. Layered discs (mud rim, water, lily pads) plus a tiny
// shimmer animation on the water for life.
function makePond() {
  const group = new THREE.Group();
  const radius = 3.4;
  // Dirt/grass rim — slightly larger and slightly raised.
  const rim = new THREE.Mesh(
    new THREE.CylinderGeometry(radius + 0.4, radius + 0.6, 0.18, 32),
    new THREE.MeshStandardMaterial({ color: 0x6a4a28, roughness: 1 })
  );
  rim.position.y = 0.05;
  rim.receiveShadow = true;
  group.add(rim);
  // Water — slightly inset, raised just above the ground so it reads
  // even from above.
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
  // Lily pads — flat rounded squares dotted around the surface.
  const padMat = new THREE.MeshStandardMaterial({ color: 0x6cbf3a, roughness: 0.8 });
  const flowerMat = new THREE.MeshStandardMaterial({ color: 0xffe9f1, roughness: 0.7 });
  const pads: THREE.Mesh[] = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.3;
    const r = radius * 0.55;
    const pad = new THREE.Mesh(
      new THREE.CylinderGeometry(0.45, 0.45, 0.05, 12),
      padMat
    );
    pad.position.set(Math.cos(a) * r, 0.21, Math.sin(a) * r);
    pad.receiveShadow = true;
    group.add(pad);
    pads.push(pad);
    // Half the pads carry a tiny flower bud.
    if (i % 2 === 0) {
      const bud = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), flowerMat);
      bud.position.copy(pad.position);
      bud.position.y = 0.32;
      group.add(bud);
    }
  }
  return {
    group,
    radius,
    tick: (_dt: number, t: number) => {
      // Gentle breathing on the lily pads — sells the water feeling.
      for (let i = 0; i < pads.length; i++) {
        pads[i].position.y = 0.21 + Math.sin(t * 1.2 + i) * 0.02;
      }
      // Subtle hue shift on the water so it doesn't feel flat.
      waterMat.emissiveIntensity = 0.15 + Math.sin(t * 0.7) * 0.05;
    },
  };
}

// Cute upright flower — stem + 5 petal-spheres + yellow centre. Cheap
// enough that we can scatter dozens without breaking the frame budget.
function makeFlower(hue: number) {
  const g = new THREE.Group();
  const stem = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.05, 0.4, 6),
    new THREE.MeshStandardMaterial({ color: 0x4f9b3a, roughness: 1 })
  );
  stem.position.y = 0.2;
  g.add(stem);
  const petalColor = new THREE.Color(`hsl(${hue}, 80%, 70%)`);
  const petalMat = new THREE.MeshStandardMaterial({ color: petalColor, roughness: 0.8 });
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const petal = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 8), petalMat);
    petal.position.set(Math.cos(a) * 0.13, 0.42, Math.sin(a) * 0.13);
    g.add(petal);
  }
  const centre = new THREE.Mesh(
    new THREE.SphereGeometry(0.07, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0xffe066, roughness: 0.7 })
  );
  centre.position.y = 0.44;
  g.add(centre);
  return g;
}

// Butterfly — body + two flapping wings. Built so the caller can grab
// the wing groups for animation.
function makeButterfly(hue: number) {
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
  // Each wing pivots from the body. Build as a thin flat oval mesh so
  // we can rotate it on Y to flap.
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
