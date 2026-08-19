import * as THREE from "three";
import { mulberry32, freshSeed } from "../world";

// The sea floor: where the whirlpool takes you.
//
// Not a planet — the walker in planet.ts is for spheres, and this is
// the flat world again, just a long way down and dressed completely
// differently. The ocean biome swaps its terrain sampler, its
// obstacles and its fog when the avatar arrives, and swaps them back
// when the volcano throws them out.
//
// The way home is that volcano. It sits on the floor with its crater
// open to the water, and driving into it winds up and blows, carrying
// the avatar up through the whole depth of the sea to break the
// surface — which is the same deal the island volcano offers on the
// surface, one world down.

export type Seafloor = {
  group: THREE.Group;
  // Height of the floor at (x, z), in world units. Well below zero:
  // the sea surface stays where it has always been.
  heightAt: (x: number, z: number) => number;
  // Where the volcano's mouth is, and how close you have to get.
  readonly volcano: { x: number; z: number };
  readonly volcanoR: number;
  // Solid things down here, for the biome to hand the engine.
  readonly obstacles: Array<{ x: number; z: number; radius: number }>;
  tick: (dt: number, t: number, player: THREE.Vector3 | null) => void;
};

// How far down the floor sits. Deep enough that the descent is a
// journey and the surface overhead is a distant ceiling, shallow
// enough that the ride back up is not a bus trip.
export const SEA_DEPTH = 46;

const SAND = new THREE.Color(0x9aa88c);
const SAND_DARK = new THREE.Color(0x5f6f64);
const SILT = new THREE.Color(0x36525c);
const ROCK = new THREE.Color(0x4a5a63);

function noise2(x: number, z: number, k: number): number {
  return (
    Math.sin(x * k + 1.1) * Math.sin(z * k * 1.27 + 0.6) +
    0.5 * Math.sin(x * k * 2.3 + 3.1) * Math.sin(z * k * 1.9 + 2.2)
  );
}

export function buildSeafloor(opts: { worldRadius: number }): Seafloor {
  const { worldRadius } = opts;
  const rand = mulberry32(freshSeed());
  const group = new THREE.Group();
  group.visible = false;
  group.frustumCulled = false;

  const VOLCANO = { x: -18, z: 14 };
  const VOLCANO_R = 3.6;
  const VOLCANO_OUTER = 13;
  const VOLCANO_H = 15;

  // Rolling floor with a cone of rock at the volcano. Everything is
  // measured from -SEA_DEPTH, so the sea surface stays at y = 0 and
  // the ceiling below is genuinely the underside of the same water.
  function dunes(x: number, z: number): number {
    return noise2(x, z, 0.055) * 1.5 + noise2(x, z, 0.14) * 0.5;
  }
  function volcanoProfile(x: number, z: number): number {
    const d = Math.hypot(x - VOLCANO.x, z - VOLCANO.z);
    if (d > VOLCANO_OUTER) return 0;
    const t = 1 - d / VOLCANO_OUTER;
    const cone = VOLCANO_H * Math.pow(t, 1.7);
    // Crater: the middle is scooped out, which is what the kid drives
    // into.
    if (d < VOLCANO_R) {
      const inner = 1 - d / VOLCANO_R;
      return cone - VOLCANO_H * 0.42 * inner * inner - 1.2 * inner;
    }
    return cone;
  }
  const heightAt = (x: number, z: number): number =>
    -SEA_DEPTH + dunes(x, z) + volcanoProfile(x, z);

  // ── Floor ────────────────────────────────────────────────────────
  const floorR = worldRadius + 34;
  // A ring rather than a circle. CircleGeometry is a triangle fan —
  // one vertex in the middle and the rest on the rim — so displacing
  // its vertices onto a height field does nothing at all to the
  // interior, and the volcano the whole world is built around comes
  // out as a flat orange sticker on a flat floor. A ring with a
  // hair-thin hole has concentric divisions all the way across.
  const floorGeo = new THREE.RingGeometry(0.02, floorR, 96, 72);
  {
    // Lay it flat and lift every vertex onto the floor field.
    floorGeo.rotateX(-Math.PI / 2);
    const pos = floorGeo.attributes.position;
    const cols = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const h = heightAt(x, z) + SEA_DEPTH;
      pos.setY(i, h);
      // Sand in the shallows of the floor, silt in the hollows, bare
      // rock up the volcano.
      const grain = noise2(x, z, 0.5);
      if (h > 3) c.copy(ROCK).lerp(SAND_DARK, Math.max(0, 1 - (h - 3) / 8));
      else if (h > -0.2) c.copy(SAND).lerp(SAND_DARK, 0.5 + grain * 0.35);
      else c.copy(SAND_DARK).lerp(SILT, Math.min(1, -h / 2));
      // Falls off to darkness at the edge, so the floor has no rim.
      const edge = Math.min(1, (floorR - Math.hypot(x, z)) / 28);
      c.multiplyScalar((0.32 + 0.68 * edge) * (0.82 + grain * 0.22));
      cols[i * 3] = c.r;
      cols[i * 3 + 1] = c.g;
      cols[i * 3 + 2] = c.b;
    }
    floorGeo.setAttribute("color", new THREE.BufferAttribute(cols, 3));
    floorGeo.computeVertexNormals();
  }
  const floor = new THREE.Mesh(
    floorGeo,
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true })
  );
  floor.position.y = -SEA_DEPTH;
  floor.receiveShadow = true;
  group.add(floor);

  // ── The surface, from underneath ─────────────────────────────────
  // A ceiling of moving light. It is what tells you which way is up
  // and how far away it is, and it is the single thing that makes the
  // place read as underwater rather than as a dark field at night.
  const ceilingMat = new THREE.MeshBasicMaterial({
    color: 0x6fc6e8,
    transparent: true,
    opacity: 0.32,
    side: THREE.BackSide,
    fog: false,
  });
  const ceiling = new THREE.Mesh(new THREE.CircleGeometry(floorR, 48), ceilingMat);
  ceiling.rotation.x = -Math.PI / 2;
  ceiling.position.y = -0.4;
  group.add(ceiling);

  // Shafts of sun coming down through it. Flat planes, faced at the
  // viewer each frame — the same trick the portal beacons use.
  const shaftMat = new THREE.MeshBasicMaterial({
    map: makeShaftTexture(),
    transparent: true,
    opacity: 0.34,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    fog: false,
  });
  const shafts = Array.from({ length: 18 }, () => {
    const w = 5 + rand() * 9;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, SEA_DEPTH * 1.1), shaftMat);
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(rand()) * (worldRadius + 10);
    mesh.position.set(Math.cos(a) * r, -SEA_DEPTH * 0.55, Math.sin(a) * r);
    mesh.frustumCulled = false;
    group.add(mesh);
    return { mesh, sway: rand() * Math.PI * 2 };
  });

  // ── Volcano ──────────────────────────────────────────────────────
  // Vent glow in the crater, so the way home is visible from across
  // the floor the way the portals are on the other worlds.
  const glowMat = new THREE.MeshBasicMaterial({
    color: 0xff7a26,
    transparent: true,
    opacity: 0.85,
    fog: false,
  });
  const vent = new THREE.Mesh(new THREE.CircleGeometry(VOLCANO_R * 0.82, 24), glowMat);
  vent.rotation.x = -Math.PI / 2;
  vent.position.set(VOLCANO.x, heightAt(VOLCANO.x, VOLCANO.z) + 0.25, VOLCANO.z);
  group.add(vent);

  const glowSprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: makeRadialTexture(),
      color: 0xffa347,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    })
  );
  glowSprite.scale.setScalar(18);
  glowSprite.position.set(VOLCANO.x, heightAt(VOLCANO.x, VOLCANO.z) + 4, VOLCANO.z);
  group.add(glowSprite);

  // Bubbles rising out of the vent, which is both decoration and the
  // arrow pointing at the exit.
  const bubbleMat = new THREE.MeshBasicMaterial({
    color: 0xdff4ff,
    transparent: true,
    opacity: 0.5,
    fog: false,
  });
  const bubbleGeo = new THREE.SphereGeometry(0.34, 8, 6);
  const bubbles = Array.from({ length: 26 }, (_, i) => {
    const mesh = new THREE.Mesh(bubbleGeo, bubbleMat);
    group.add(mesh);
    return {
      mesh,
      t: i / 26,
      speed: 0.09 + (i % 5) * 0.02,
      a: rand() * Math.PI * 2,
      r: 0.4 + rand() * VOLCANO_R,
      size: 0.5 + rand() * 1.1,
    };
  });

  // ── Kelp and coral ───────────────────────────────────────────────
  const obstacles: Array<{ x: number; z: number; radius: number }> = [];
  const kelpMat = new THREE.MeshStandardMaterial({
    color: 0x3f7a4a,
    roughness: 1,
    side: THREE.DoubleSide,
    flatShading: true,
  });
  const fronds: Array<{ mesh: THREE.Mesh; phase: number }> = [];
  for (let i = 0; i < 44; i++) {
    const a = rand() * Math.PI * 2;
    const r = 8 + Math.sqrt(rand()) * (worldRadius + 12);
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (Math.hypot(x - VOLCANO.x, z - VOLCANO.z) < VOLCANO_OUTER + 3) continue;
    const h = 4 + rand() * 7;
    const blade = new THREE.Mesh(new THREE.PlaneGeometry(1.1, h, 1, 5), kelpMat);
    blade.position.set(x, heightAt(x, z) + h / 2, z);
    blade.rotation.y = rand() * Math.PI;
    group.add(blade);
    fronds.push({ mesh: blade, phase: rand() * Math.PI * 2 });
  }
  for (let i = 0; i < 26; i++) {
    const a = rand() * Math.PI * 2;
    const r = 10 + Math.sqrt(rand()) * (worldRadius + 6);
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (Math.hypot(x - VOLCANO.x, z - VOLCANO.z) < VOLCANO_OUTER + 2) continue;
    const colour = [0xd4756b, 0xe0a35c, 0x6f9bd1, 0xb87fc4][Math.floor(rand() * 4)];
    const head = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1 + rand() * 1.6, 0),
      new THREE.MeshStandardMaterial({ color: colour, roughness: 1, flatShading: true })
    );
    head.position.set(x, heightAt(x, z) + 0.7, z);
    head.scale.y = 0.7 + rand() * 0.5;
    group.add(head);
    obstacles.push({ x, z, radius: 1.6 });
  }

  // Motes drifting in the water, close to the camera. Cheap, and the
  // single strongest cue that you are looking through water.
  const moteMat = new THREE.PointsMaterial({
    color: 0xcfeaf5,
    size: 2.4,
    sizeAttenuation: false,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
    fog: false,
  });
  const MOTES = 500;
  const motePos = new Float32Array(MOTES * 3);
  for (let i = 0; i < MOTES; i++) {
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(rand()) * (worldRadius + 20);
    motePos[i * 3] = Math.cos(a) * r;
    motePos[i * 3 + 1] = -SEA_DEPTH + rand() * SEA_DEPTH;
    motePos[i * 3 + 2] = Math.sin(a) * r;
  }
  const moteGeo = new THREE.BufferGeometry();
  moteGeo.setAttribute("position", new THREE.BufferAttribute(motePos, 3));
  const motes = new THREE.Points(moteGeo, moteMat);
  motes.frustumCulled = false;
  group.add(motes);

  // Its own light. The biome's sun is a warm low one built for a
  // sunset on the water, and forty-six units down it turns the whole
  // sea floor orange — so the surface lights get dimmed while the
  // avatar is here (see the ocean biome) and this cool pair takes
  // over: daylight filtering down from above, dark below.
  const deepSky = new THREE.HemisphereLight(0x9ce2f6, 0x123244, 1.9);
  group.add(deepSky);
  const deepSun = new THREE.DirectionalLight(0xd6f2ff, 0.75);
  deepSun.position.set(12, 60, 8);
  group.add(deepSun);

  let clock = 0;
  const tmp = new THREE.Vector3();

  return {
    group,
    heightAt,
    volcano: VOLCANO,
    volcanoR: VOLCANO_R,
    obstacles,
    tick(dt, t, player) {
      if (!group.visible) return;
      clock += dt;
      for (const b of bubbles) {
        b.t += dt * b.speed;
        if (b.t > 1) b.t -= 1;
        const y = heightAt(VOLCANO.x, VOLCANO.z) + b.t * (SEA_DEPTH + 4);
        const wobble = Math.sin(clock * 1.6 + b.a * 3) * (0.6 + b.t * 2.4);
        b.mesh.position.set(
          VOLCANO.x + Math.cos(b.a) * b.r + wobble,
          y,
          VOLCANO.z + Math.sin(b.a) * b.r + wobble * 0.6
        );
        b.mesh.scale.setScalar(b.size * (0.6 + b.t * 0.7));
      }
      for (const f of fronds) {
        f.mesh.rotation.z = Math.sin(clock * 0.8 + f.phase) * 0.16;
      }
      glowSprite.scale.setScalar(17 + Math.sin(clock * 1.3) * 1.6);
      // Light shafts lean and face the viewer, so they read as volume.
      if (player) {
        for (const s of shafts) {
          tmp.subVectors(player, s.mesh.position);
          s.mesh.rotation.y = Math.atan2(tmp.x, tmp.z);
          s.mesh.rotation.z = Math.sin(clock * 0.35 + s.sway) * 0.06;
        }
      }
      void t;
    },
  };
}

function makeShaftTexture(): THREE.CanvasTexture {
  const W = 32;
  const H = 128;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d")!;
  const img = g.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    // Three flips the image, so row 0 lands at the TOP of the plane —
    // which is where the light comes in. It has to be brightest there
    // and gone before the floor; the other way round it lights the
    // sand from below and reads as a starburst on the ground.
    const up = 1 - y / (H - 1);
    const vertical = Math.pow(up, 1.5);
    for (let x = 0; x < W; x++) {
      const across = 1 - Math.abs(((x + 0.5) / W) * 2 - 1);
      const a = Math.pow(across, 1.8) * vertical;
      const o = (y * W + x) * 4;
      img.data[o] = 214;
      img.data[o + 1] = 244;
      img.data[o + 2] = 255;
      img.data[o + 3] = Math.round(a * 255);
    }
  }
  g.putImageData(img, 0, 0);
  return new THREE.CanvasTexture(c);
}

function makeRadialTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const g = c.getContext("2d")!;
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, "rgba(255,220,160,1)");
  grd.addColorStop(0.35, "rgba(255,150,60,0.45)");
  grd.addColorStop(1, "rgba(255,110,30,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}
