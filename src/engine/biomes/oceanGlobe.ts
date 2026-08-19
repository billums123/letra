import * as THREE from "three";
import { mulberry32, freshSeed } from "../world";

// The ocean world, seen from somewhere else.
//
// Close up the ocean is what it has always been: a flat disc of water
// with islands on it. From the sun it was a blue lozenge lying in the
// dark, which is exactly what a flat world looks like edge-on and is
// not what anyone means by "my world".
//
// So the whole flat world lives inside a sphere. The sphere is
// front-face only, which means from the inside — standing on the
// water, where the kid spends all their time — every triangle faces
// away and nothing draws at all. From the outside it is a little blue
// planet with the flat world hidden inside it. No swap, no second
// scene, and the only thing that changes is which side of the shell
// the camera happens to be on.
//
// Radius is chosen to just contain the water disc; the deep-sea skirt
// and nothing else reaches past it, and the biome fades that out over
// the same window the globe fades in.

export type OceanGlobe = {
  group: THREE.Group;
  radius: number;
  // Drive from the viewer's distance to the world's centre.
  setViewerDistance: (d: number) => void;
  // 0 while the kid is at home, 1 once the world reads as a planet.
  amount: () => number;
};

const DEEP = new THREE.Color(0x11497e);
const SHALLOW = new THREE.Color(0x2f9fc4);
const SAND = new THREE.Color(0xe8d9a8);
const LAND = new THREE.Color(0x4f9a45);
const SNOW = new THREE.Color(0xc8e2ea);

// Distances over which the flat world resolves into a planet. Set well
// out so the change happens when the world is already small in frame
// — near the shell it would read as the sea folding up underneath you.
const FADE_NEAR = 170;
const FADE_FAR = 250;

function noise3(x: number, y: number, z: number, k: number): number {
  return (
    Math.sin(x * k + 1.3) * Math.sin(y * k * 1.27 + 0.4) * Math.sin(z * k * 0.91 + 2.8) +
    0.55 * Math.sin(x * k * 2.1 + 4.2) * Math.sin(y * k * 1.7 + 1.1) +
    0.3 * Math.sin(z * k * 3.3 + 0.7) * Math.sin(x * k * 2.7 + 3.9)
  );
}

export function buildOceanGlobe(radius: number): OceanGlobe {
  const group = new THREE.Group();
  const rand = mulberry32(freshSeed());
  const seed = rand() * 20;

  const geo = new THREE.IcosahedronGeometry(radius, 16);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + seed;
    const y = pos.getY(i);
    const z = pos.getZ(i);
    // One noise field read as an elevation map: below sea level it is
    // water, shading from deep to shallow; above it, beach then green.
    // Mostly the low octave, so continents come out as a few big
    // masses. Leaning on the fine octave gave a camouflage print.
    const h = noise3(x, y, z, 0.042) + 0.22 * noise3(x, y, z, 0.115);
    const polar = Math.abs(y / radius);
    if (h < 0.3) {
      c.copy(DEEP).lerp(SHALLOW, Math.min(1, Math.max(0, (h + 0.55) / 0.85)));
    } else if (h < 0.42) {
      // A beach, only where land actually meets water.
      c.copy(SAND).lerp(LAND, (h - 0.3) / 0.12);
    } else {
      c.copy(LAND).lerp(SAND, Math.min(0.35, (h - 0.42) * 0.35));
    }
    // A little frost at the poles, because a globe without caps does
    // not read as a globe.
    if (polar > 0.9) c.lerp(SNOW, Math.min(0.85, (polar - 0.9) / 0.09));
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 1,
    flatShading: true,
    transparent: true,
    // Depth-write is switched on below once the shell is effectively
    // opaque. While it is fading it must not occlude — it is being
    // composited over the flat world it is replacing — but once it is
    // solid it has to, or the starfield shines straight through the
    // planet.
    depthWrite: false,
    opacity: 0,
    side: THREE.FrontSide,
  });
  const shell = new THREE.Mesh(geo, mat);
  shell.frustumCulled = false;
  // First of the transparent objects, so its depth is already down
  // when the stars and the other planets are drawn.
  shell.renderOrder = -1;
  group.add(shell);

  // Thin band of atmosphere. Additive, and only on the far side of the
  // sphere, so it reads as air catching the light around the rim.
  const airMat = new THREE.MeshBasicMaterial({
    color: 0x7fc4ff,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.BackSide,
    fog: false,
  });
  const air = new THREE.Mesh(new THREE.IcosahedronGeometry(radius * 1.045, 4), airMat);
  air.frustumCulled = false;
  group.add(air);

  let amount = 0;
  group.visible = false;

  return {
    group,
    radius,
    setViewerDistance(d) {
      const k = Math.min(1, Math.max(0, (d - FADE_NEAR) / (FADE_FAR - FADE_NEAR)));
      amount = k * k * (3 - 2 * k);
      mat.opacity = amount;
      mat.depthWrite = amount > 0.9;
      airMat.opacity = amount * 0.28;
      group.visible = amount > 0.005;
    },
    amount: () => amount,
  };
}
