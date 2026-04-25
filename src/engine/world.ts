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
};

export function buildWorld(): WorldHandles {
  const group = new THREE.Group();
  group.name = "World";
  const obstacles: Obstacle[] = [];

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

  // Hills — soft spheres in the distance. Pushed out of the play zone so the
  // kid never walks "into" one.
  const hillRand = mulberry32(11);
  for (let i = 0; i < 18; i++) {
    const r = 8 + hillRand() * 14;
    const x = (hillRand() - 0.5) * 130;
    const z = (hillRand() - 0.5) * 130;
    if (Math.hypot(x, z) < 35) continue;
    const hue = 95 + hillRand() * 35;
    const hill = new THREE.Mesh(
      new THREE.SphereGeometry(r, 16, 12),
      new THREE.MeshStandardMaterial({ color: new THREE.Color(`hsl(${hue}, 55%, 55%)`), roughness: 0.95 })
    );
    hill.position.set(x, r * 0.3 - 0.5, z);
    hill.castShadow = false;
    hill.receiveShadow = true;
    group.add(hill);
    // Hills are scenery — we don't want collision quite at the visual
    // sphere edge (the ground meets it well before that). Use 60% radius.
    obstacles.push({ x, z, radius: r * 0.6 });
  }

  // Trees
  const treeRand = mulberry32(7);
  for (let i = 0; i < 26; i++) {
    const x = (treeRand() - 0.5) * 110;
    const z = (treeRand() - 0.5) * 110;
    if (Math.hypot(x, z) < 10) continue;
    const scale = 0.9 + treeRand() * 0.7;
    const hue = 100 + treeRand() * 40;
    const tree = makeTree(hue, scale);
    tree.position.set(x, 0, z);
    group.add(tree);
    // Trunk + foliage radius — a generous 1.4*scale catches the leafy cone.
    obstacles.push({ x, z, radius: 1.4 * scale });
  }

  // Mushrooms
  const mushRand = mulberry32(23);
  for (let i = 0; i < 22; i++) {
    const x = (mushRand() - 0.5) * 100;
    const z = (mushRand() - 0.5) * 100;
    if (Math.hypot(x, z) < 8) continue;
    const hue = mushRand() * 360;
    const m = makeMushroom(hue);
    m.position.set(x, 0, z);
    group.add(m);
    obstacles.push({ x, z, radius: 0.7 });
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

  return { group, worldRadius: WORLD_RADIUS, obstacles };
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
