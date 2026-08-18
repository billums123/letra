import * as THREE from "three";
import type { PlanetSpec } from "../planet";
import { mulberry32, freshSeed } from "../world";
import { SPOT_ANGLE, BEAM_HEIGHT, SPOT_DIRS } from "./sunLayout";

// The sun, built as somewhere you can actually stand.
//
// It doubles as the ocean biome's distant space prop — the same
// object that rises over the horizon on a mega launch is the one the
// avatar lands on, so there is never a swap or a second sun. Every
// material fades together via setOpacity(), which the biome drives
// from the avatar's altitude.
//
// Everything lives in one group centred on the sun, and surface
// features are placed by unit direction rather than xyz, which keeps
// them honest when the radius gets tuned.

export type SunWorld = {
  group: THREE.Group;
  center: THREE.Vector3;
  radius: number;
  // Pass to engine.launchToPlanet(). Walking surface sits `hover`
  // above the visible shell.
  spec: PlanetSpec;
  // 0 = invisible (down at sea level), 1 = full space.
  setOpacity: (k: number) => void;
  // `viewer` is a world-space point to shade toward — the avatar
  // stands in for the camera, which trails it by a fixed offset.
  tick: (dt: number, t: number, viewer?: THREE.Vector3) => void;
  // Set by the biome: fired once when the avatar walks into a sunspot.
  onEnterSpot?: (dir: THREE.Vector3) => void;
  // Suppresses sunspot triggers — the biome arms them a beat after
  // touchdown so a landing right beside one doesn't bounce the kid
  // straight home again.
  armExits: (armed: boolean) => void;
};

// Surface palette, coolest to hottest. Every face sits somewhere on
// this ramp and drifts slowly along it, so the shell reads as boiling
// plasma rather than flat orange.
const COOL = new THREE.Color(0xf04907);
const MID = new THREE.Color(0xff9424);
const HOT = new THREE.Color(0xffeec0);

// Cheap smooth 3D noise. Real granulation cells are big soft blobs,
// so the value a face gets has to vary smoothly with WHERE the face
// is — seeding each face independently gives a checkerboard, which is
// exactly what a star does not look like.
function cellNoise(x: number, y: number, z: number, k: number): number {
  return (
    Math.sin(x * k) * Math.sin(y * k * 1.31 + 1.7) * Math.sin(z * k * 0.87 + 4.1) +
    0.5 * Math.sin(x * k * 2.13 + 2.4) * Math.sin(z * k * 1.77 + 0.6)
  );
}


export function buildSunWorld(opts: {
  center: THREE.Vector3;
  radius: number;
  hover?: number;
}): SunWorld {
  const { center, radius } = opts;
  const hover = opts.hover ?? 0.35;
  const rand = mulberry32(freshSeed());
  const group = new THREE.Group();
  group.position.copy(center);
  // Never culled: the camera is often 300 units away looking at a
  // 28-unit ball, and the bounding-sphere test on the animated body
  // is not worth the risk of a pop.
  group.frustumCulled = false;

  const fading: Array<{ opacity: number }> = [];

  // ── Body ─────────────────────────────────────────────────────────
  // Flat-shaded so the surface breaks into plasma cells, each of
  // which gets its own slow bright/dim cycle.
  // Icosahedron rather than a UV sphere: its triangles are near
  // enough equal all over, so the granulation reads as cells instead
  // of a mosaic of rectangles that pinches at the poles.
  //
  // `detail` here splits every edge into detail+1, so the face count
  // is 20 * (detail+1)^2 — NOT 4^detail. Detail 24 is 12.5k faces at
  // about 1.2 units to a side on a 28-unit star: fine enough that the
  // horizon reads as a curve when you are standing on it, coarse
  // enough that recolouring every face stays cheap.
  const bodyGeo = new THREE.IcosahedronGeometry(radius, 24);
  const vertCount = bodyGeo.attributes.position.count;
  const faceCount = vertCount / 3;
  const colors = new Float32Array(vertCount * 3);
  bodyGeo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  // Per-face granulation parameters, sampled from the face centroid so
  // neighbours agree and the cells come out as blobs.
  const pos = bodyGeo.attributes.position;
  const faceBase = new Float32Array(faceCount);
  const facePhase = new Float32Array(faceCount);
  // Centroids are kept because the per-frame limb darkening needs the
  // face's own outward direction, and on a sphere that is just the
  // normalised centroid.
  const faceCentroid = new Float32Array(faceCount * 3);
  const spin = rand() * 10;
  for (let f = 0; f < faceCount; f++) {
    const o = f * 3;
    const cx = (pos.getX(o) + pos.getX(o + 1) + pos.getX(o + 2)) / 3;
    const cy = (pos.getY(o) + pos.getY(o + 1) + pos.getY(o + 2)) / 3;
    const cz = (pos.getZ(o) + pos.getZ(o + 1) + pos.getZ(o + 2)) / 3;
    faceCentroid[f * 3] = cx;
    faceCentroid[f * 3 + 1] = cy;
    faceCentroid[f * 3 + 2] = cz;
    const big = cellNoise(cx + spin, cy, cz, 0.26);
    const fine = cellNoise(cx + spin, cy, cz, 0.72);
    faceBase[f] = Math.min(1, Math.max(0, 0.52 + big * 0.3 + fine * 0.12));
    facePhase[f] = big * 3.4 + fine * 1.1;
  }
  const bodyMat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0,
    fog: false,
  });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.frustumCulled = false;
  group.add(body);
  fading.push(bodyMat);
  const faceColor = new THREE.Color();

  // ── Corona ───────────────────────────────────────────────────────
  // A gradient sprite; a sphere cannot fade out at its own edge, and
  // dimming one just gives a duller flat disc.
  const glowTex = (() => {
    const c = document.createElement("canvas");
    c.width = 128;
    c.height = 128;
    const g = c.getContext("2d")!;
    const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, "rgba(255,244,205,1)");
    grd.addColorStop(0.22, "rgba(255,214,130,0.75)");
    grd.addColorStop(0.42, "rgba(255,150,50,0.32)");
    grd.addColorStop(1, "rgba(255,120,30,0)");
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  })();
  const haloMat = new THREE.SpriteMaterial({
    map: glowTex,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  });
  const halo = new THREE.Sprite(haloMat);
  halo.scale.setScalar(radius * 4.6);
  group.add(halo);
  fading.push(haloMat);

  // ── Prominences ──────────────────────────────────────────────────
  // Loops of plasma that leave the surface and come back down. Torus
  // arcs, stood on edge and tipped so their two feet meet the shell —
  // cheaper than a tube along a curve and the silhouette is the same.
  // Not additive: additive over a surface this bright just goes white
  // and the loops read as bent wire. Plain bright plasma against the
  // shell, and against space at the limb, reads far better.
  const promMat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0,
    fog: false,
    side: THREE.DoubleSide,
  });
  const PROM_FOOT = new THREE.Color(0xfff0c0);
  const PROM_TIP = new THREE.Color(0xff5e1c);
  fading.push(promMat);
  const proms: Array<{ pivot: THREE.Group; mesh: THREE.Mesh; rate: number; phase: number }> = [];
  const PROM_COUNT = 5;
  for (let i = 0; i < PROM_COUNT; i++) {
    // Even-ish spread with jitter, biased away from the north pole so
    // the landing site stays clear.
    const y = -0.85 + (i / (PROM_COUNT - 1)) * 1.5 + (rand() - 0.5) * 0.18;
    const dir = randomDirAtHeight(y, rand);
    const loopR = radius * (0.22 + rand() * 0.14);
    const arc = Math.PI * (0.9 + rand() * 0.5);
    const geo = new THREE.TorusGeometry(loopR, loopR * 0.14, 8, 30, arc);
    const mesh = new THREE.Mesh(geo, promMat);
    // The torus arc starts at +X and sweeps through +Y. Rotating it
    // back by half the arc centres the loop over its own feet, so it
    // stands up out of the surface instead of leaning off it.
    mesh.rotation.z = -arc / 2 + Math.PI / 2;
    mesh.position.set(0, loopR * 0.55, 0);
    // Hottest where it leaves the surface, cooling as it arcs — the
    // ramp is what stops a torus reading as bent wire. Height is
    // measured after the mesh's own transform, i.e. in the frame the
    // loop actually stands in.
    mesh.updateMatrix();
    const pv = geo.attributes.position;
    const promCols = new Float32Array(pv.count * 3);
    const lifted = new THREE.Vector3();
    let tallest = 1e-6;
    for (let v = 0; v < pv.count; v++) {
      lifted.fromBufferAttribute(pv, v).applyMatrix4(mesh.matrix);
      tallest = Math.max(tallest, lifted.y);
    }
    const promCol = new THREE.Color();
    for (let v = 0; v < pv.count; v++) {
      lifted.fromBufferAttribute(pv, v).applyMatrix4(mesh.matrix);
      promCol.copy(PROM_FOOT).lerp(PROM_TIP, Math.min(1, Math.max(0, lifted.y / tallest)));
      promCols[v * 3] = promCol.r;
      promCols[v * 3 + 1] = promCol.g;
      promCols[v * 3 + 2] = promCol.b;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(promCols, 3));
    const pivot = new THREE.Group();
    pivot.add(mesh);
    orientTo(pivot, dir, radius * 0.97);
    pivot.rotateY(rand() * Math.PI);
    group.add(pivot);
    proms.push({ pivot, mesh, rate: 0.35 + rand() * 0.4, phase: rand() * Math.PI * 2 });
  }

  // ── Sunspots ─────────────────────────────────────────────────────
  // Dark whirlpools in the surface, and the way home: drive into one
  // and the sun spits the avatar back down to the sea.
  const spotCoreMat = new THREE.MeshBasicMaterial({
    color: 0x2a0f06,
    transparent: true,
    opacity: 0,
    fog: false,
  });
  const spotPenumbraMat = new THREE.MeshBasicMaterial({
    color: 0x8f3308,
    transparent: true,
    opacity: 0,
    fog: false,
  });
  const spotRimMat = new THREE.MeshBasicMaterial({
    color: 0xffe6a8,
    transparent: true,
    opacity: 0,
    fog: false,
    side: THREE.DoubleSide,
  });
  fading.push(spotCoreMat, spotPenumbraMat, spotRimMat);
  const spots: Array<{ dir: THREE.Vector3; swirl: THREE.Group; beam: THREE.Mesh }> = [];
  // Spread so that from anywhere on the star at least one beacon is
  // over the horizon, and with the first one only a short drive from
  // the north pole, where every arrival lands.
  // Beacons. A sunspot is a dark patch on a dark-patterned star and a
  // four-year-old will never find one by looking; a cool column of
  // light standing over each is unmistakable, is the one thing on the
  // sun that isn't orange, and — being 14 units tall on a 28-unit
  // star — clears the horizon from about 40 units away, so there is
  // always one in sight to drive toward.
  const BEAM_H = BEAM_HEIGHT;
  const beamMat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
    side: THREE.DoubleSide,
  });
  fading.push(beamMat);
  // Vertical ramp baked into the vertices: bright where the beam
  // leaves the sunspot, black at the top. Additive blending renders
  // black as nothing, so the column dissolves into space instead of
  // ending in a hard rim — which is the whole difference between a
  // shaft of light and a pale blue traffic cone. Every beam shares
  // this geometry; they only differ in where they stand.
  const beamGeo = new THREE.CylinderGeometry(
    0.7,
    radius * Math.sin(SPOT_ANGLE * 0.62),
    BEAM_H,
    20,
    6,
    true
  );
  {
    const bp = beamGeo.attributes.position;
    const cols = new Float32Array(bp.count * 3);
    const tint = new THREE.Color(0x9fdcff);
    for (let v = 0; v < bp.count; v++) {
      const up = (bp.getY(v) + BEAM_H / 2) / BEAM_H;
      const a = Math.pow(1 - up, 1.6);
      cols[v * 3] = tint.r * a;
      cols[v * 3 + 1] = tint.g * a;
      cols[v * 3 + 2] = tint.b * a;
    }
    beamGeo.setAttribute("color", new THREE.BufferAttribute(cols, 3));
  }
  for (const raw of SPOT_DIRS) {
    const dir = raw.clone().normalize();
    // A spherical cap rather than a flat disc — a disc big enough to
    // be findable would sink most of a unit into the shell at its rim.
    const cap = new THREE.Mesh(
      new THREE.SphereGeometry(radius + 0.2, 32, 12, 0, Math.PI * 2, 0, SPOT_ANGLE * 0.62),
      spotCoreMat
    );
    cap.frustumCulled = false;
    // Penumbra between umbra and rim, so the spot reads as a dimple in
    // the plasma rather than a hole punched through the star.
    const penumbra = new THREE.Mesh(
      new THREE.SphereGeometry(radius + 0.14, 32, 12, 0, Math.PI * 2, 0, SPOT_ANGLE * 0.9),
      spotPenumbraMat
    );
    penumbra.frustumCulled = false;
    const rim = new THREE.Mesh(
      new THREE.SphereGeometry(
        radius + 0.08,
        32,
        6,
        0,
        Math.PI * 2,
        SPOT_ANGLE * 0.82,
        SPOT_ANGLE * 0.36
      ),
      spotRimMat
    );
    rim.frustumCulled = false;
    // The cap is built around +Y, so rotate the whole thing so +Y
    // lands on the spot's direction. Both meshes share the pivot, and
    // the pivot spins to give the spot its slow whirl.
    const swirl = new THREE.Group();
    swirl.add(rim, penumbra, cap);
    // Open-ended cone, wide at the base and pinched at the top, so it
    // reads as light escaping rather than as a solid traffic cone.
    const beam = new THREE.Mesh(beamGeo, beamMat);
    beam.position.y = radius + BEAM_H / 2 - 0.6;
    beam.frustumCulled = false;
    const pivot = new THREE.Group();
    pivot.add(swirl, beam);
    orientTo(pivot, dir, 0);
    group.add(pivot);
    spots.push({ dir, swirl, beam });
  }

  // ── Light ────────────────────────────────────────────────────────
  // Standing on a star, the light comes from under your feet. Range
  // is capped just past the surface so nothing down at sea level sees
  // it — the biome's own sun still lights the ocean.
  // decay 0: the avatar stands a full radius from the centre, and with
  // physical falloff over that distance the light may as well not be
  // there. This is a fill light standing in for "the ground is on
  // fire", not a physical source.
  const glow = new THREE.PointLight(0xffc27a, 0, radius * 2.4, 0);
  group.add(glow);

  let armed = false;
  let insideSpot = false;
  let opacity = 0;
  let colorClock = 0;

  const spec: PlanetSpec = {
    center,
    radius,
    hover,
    onWalk: (dir) => {
      // Nearest spot by angle. Four of them, once a frame — not worth
      // anything cleverer.
      let hit = false;
      for (const s of spots) {
        if (dir.angleTo(s.dir) < SPOT_ANGLE * 0.75) {
          hit = true;
          if (armed && !insideSpot) world.onEnterSpot?.(s.dir);
          break;
        }
      }
      insideSpot = hit;
    },
  };

  const world: SunWorld = {
    group,
    center,
    radius,
    spec,
    setOpacity(k) {
      opacity = Math.min(1, Math.max(0, k));
      for (const m of fading) m.opacity = opacity;
      promMat.opacity = opacity * 0.8;
      spotRimMat.opacity = opacity * 0.95;
      beamMat.opacity = opacity * 0.8;
      spotPenumbraMat.opacity = opacity;
      glow.intensity = opacity * 2.6;
      group.visible = opacity > 0.01;
    },
    armExits(next) {
      armed = next;
      if (!next) insideSpot = false;
    },
    tick(dt, t, viewer) {
      if (!group.visible) return;
      // The corona is a sprite the width of four suns. Seen from a
      // long way off that is the glow; seen from the surface it is a
      // brown sheet across the whole sky. So it fades out as the
      // viewer closes in, and is gone well before touchdown.
      const viewDist = viewer ? viewer.distanceTo(center) : radius * 12;
      const near = Math.min(1, Math.max(0, (viewDist - radius * 1.6) / (radius * 3)));
      haloMat.opacity = opacity * 0.85 * near;
      halo.visible = near > 0.01;
      // Granulation, plus limb darkening against the viewer. Rewriting
      // 60k vertex colours every frame is wasted work on a surface
      // that boils this slowly, so it runs at ~12Hz and the eye cannot
      // tell. The darkening is what stops a self-lit sphere reading as
      // flat paper: the ground under your feet is the brightest thing
      // in shot and it falls off toward the horizon.
      colorClock += dt;
      if (colorClock > 0.08) {
        colorClock = 0;
        const vx = viewer ? viewer.x - center.x : 0;
        const vy = viewer ? viewer.y - center.y : radius * 12;
        const vz = viewer ? viewer.z - center.z : 0;
        for (let f = 0; f < faceCount; f++) {
          // Slow drift along the ramp, in phase with the neighbours a
          // face shares a cell with.
          const heat = Math.min(
            1,
            Math.max(0, faceBase[f] + 0.2 * Math.sin(t * 0.45 + facePhase[f]))
          );
          if (heat < 0.5) faceColor.copy(COOL).lerp(MID, heat * 2);
          else faceColor.copy(MID).lerp(HOT, (heat - 0.5) * 2);
          const cx = faceCentroid[f * 3];
          const cy = faceCentroid[f * 3 + 1];
          const cz = faceCentroid[f * 3 + 2];
          let dx = vx - cx;
          let dy = vy - cy;
          let dz = vz - cz;
          const dl = Math.hypot(dx, dy, dz) || 1;
          dx /= dl;
          dy /= dl;
          dz /= dl;
          // Limb darkening. The floor is deliberately high: with the
          // avatar standing barely a third of a unit off the surface,
          // the view direction goes tangential within a couple of
          // units, and any stronger falloff turns the ground under
          // its feet into mud a step away.
          const facing = (cx * dx + cy * dy + cz * dz) / radius;
          const lit = 0.72 + 0.28 * Math.sqrt(Math.max(0, facing));
          const o = f * 9;
          for (let v = 0; v < 3; v++) {
            colors[o + v * 3] = faceColor.r * lit;
            colors[o + v * 3 + 1] = faceColor.g * lit;
            colors[o + v * 3 + 2] = faceColor.b * lit;
          }
        }
        bodyGeo.attributes.color.needsUpdate = true;
      }
      for (const p of proms) {
        const breathe = 1 + Math.sin(t * p.rate + p.phase) * 0.18;
        p.mesh.scale.set(breathe, breathe, 1);
        p.pivot.rotateY(dt * 0.05);
      }
      for (let i = 0; i < spots.length; i++) {
        const s = spots[i];
        s.swirl.rotation.y += dt * 0.5;
        s.beam.rotation.y -= dt * 0.9;
        const pulse = 1 + Math.sin(t * 1.6 + i * 1.9) * 0.07;
        s.beam.scale.set(pulse, 1, pulse);
      }
      halo.scale.setScalar(radius * (4.6 + Math.sin(t * 0.7) * 0.12));
    },
  };
  world.setOpacity(0);
  return world;
}

// Orient a group so its local +Y points along `dir`, and sit it
// `dist` out from the sun's centre along the same direction.
function orientTo(obj: THREE.Object3D, dir: THREE.Vector3, dist: number): void {
  obj.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  obj.position.copy(dir).multiplyScalar(dist);
}

// Unit vector at a given height on the sphere (y in -1..1), random
// around the axis.
function randomDirAtHeight(y: number, rand: () => number): THREE.Vector3 {
  const clamped = Math.max(-0.95, Math.min(0.95, y));
  const r = Math.sqrt(Math.max(0, 1 - clamped * clamped));
  const th = rand() * Math.PI * 2;
  return new THREE.Vector3(Math.cos(th) * r, clamped, Math.sin(th) * r).normalize();
}
