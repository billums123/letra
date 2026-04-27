import * as THREE from "three";
import { playFireworkLaunch, playFireworkBurst } from "../audio/sfx";

// Tiny burst of confetti shapes when a letter is collected. Cheap, additive,
// disposed automatically when the burst finishes.

export type Burst = {
  group: THREE.Group;
  update: (dt: number, t: number) => boolean; // returns false when done
};

const COLORS = [0xff5e7e, 0xffd83b, 0x9bdc4a, 0x46c2cb, 0x6f9bff, 0xb886ff];

export function makeBurst(position: THREE.Vector3, count = 32): Burst {
  const group = new THREE.Group();
  group.position.copy(position);

  type Bit = {
    mesh: THREE.Mesh;
    vel: THREE.Vector3;
    spin: THREE.Vector3;
    life: number;
    max: number;
  };
  const bits: Bit[] = [];

  for (let i = 0; i < count; i++) {
    const color = COLORS[(Math.random() * COLORS.length) | 0];
    const geo = i % 2 === 0
      ? new THREE.PlaneGeometry(0.18, 0.28)
      : new THREE.PlaneGeometry(0.22, 0.22);
    const mat = new THREE.MeshBasicMaterial({
      color,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 1,
    });
    const m = new THREE.Mesh(geo, mat);
    const angle = Math.random() * Math.PI * 2;
    const power = 4 + Math.random() * 4;
    const upwards = 4 + Math.random() * 5;
    bits.push({
      mesh: m,
      vel: new THREE.Vector3(Math.cos(angle) * power, upwards, Math.sin(angle) * power),
      spin: new THREE.Vector3(
        (Math.random() - 0.5) * 8,
        (Math.random() - 0.5) * 8,
        (Math.random() - 0.5) * 8
      ),
      life: 0,
      max: 1.4 + Math.random() * 0.6,
    });
    m.position.set(0, 1.2, 0);
    group.add(m);
  }

  return {
    group,
    update(dt) {
      let anyAlive = false;
      for (const b of bits) {
        if (b.life >= b.max) continue;
        b.life += dt;
        // Gravity
        b.vel.y -= 18 * dt;
        b.mesh.position.addScaledVector(b.vel, dt);
        b.mesh.rotation.x += b.spin.x * dt;
        b.mesh.rotation.y += b.spin.y * dt;
        b.mesh.rotation.z += b.spin.z * dt;
        const k = b.life / b.max;
        (b.mesh.material as THREE.MeshBasicMaterial).opacity = 1 - k * k;
        anyAlive = true;
      }
      if (!anyAlive) {
        for (const b of bits) {
          b.mesh.geometry.dispose();
          (b.mesh.material as THREE.Material).dispose();
        }
      }
      return anyAlive;
    },
  };
}

// A two-phase firework: a single bright "rocket" climbs from `position`
// trailing a streak of sparks, then explodes into a wide ring of
// glowing bits that drift outward, leave little sparkly afterimages,
// then fall under gravity and fade. Used during the dance-party
// finale when the kid bumps a letter — each contact launches a small
// firework instead of speaking the letter's name.
//
// All meshes use additive blending so overlapping bits read as glowing
// rather than muddy. Each shower bit also drips a fading micro-spark
// behind it on a fixed cadence so the explosion has a "starry" feel
// instead of being just a sparse spray of dots.
export function makeFirework(position: THREE.Vector3, count = 32): Burst {
  const group = new THREE.Group();
  group.position.copy(position);

  const launchY = 1.2;
  const peakY = 4.4;
  const launchTime = 0.42;
  let elapsed = 0;
  let exploded = false;
  let flashLife = 0;
  const flashMax = 0.32;

  // Audible launch the moment the rocket spawns. The matching burst
  // fires inside explode() — we want both sounds inseparable from the
  // visual so callers don't have to plumb audio themselves.
  playFireworkLaunch();

  // Rocket palette — pick a strong primary colour that the explosion
  // bits will inherit. Multiple firework instances therefore land on
  // different but coherent palettes.
  const rocketColor = COLORS[(Math.random() * COLORS.length) | 0];
  const accentColor = COLORS[(Math.random() * COLORS.length) | 0];

  // ── Phase 1: rocket + trail ────────────────────────────────────────
  // Glowing core
  const rocket = new THREE.Mesh(
    new THREE.SphereGeometry(0.18, 10, 8),
    new THREE.MeshBasicMaterial({
      color: rocketColor,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );
  rocket.position.y = launchY;
  group.add(rocket);
  // Halo around the rocket so it reads as glowing rather than as a
  // hard ball. Larger, lower opacity, additive.
  const halo = new THREE.Mesh(
    new THREE.SphereGeometry(0.36, 12, 10),
    new THREE.MeshBasicMaterial({
      color: rocketColor,
      transparent: true,
      opacity: 0.45,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );
  halo.position.y = launchY;
  group.add(halo);
  // Sparking trail dropped behind the rocket — a small pool of
  // sparks each dripped at a fixed cadence and decayed independently.
  type TrailSpark = { mesh: THREE.Mesh; life: number; max: number };
  const trail: TrailSpark[] = [];
  let trailTimer = 0;

  // ── Phase 2: shower bits + secondary sparks ────────────────────────
  type Bit = {
    mesh: THREE.Mesh;
    vel: THREE.Vector3;
    life: number;
    max: number;
    sparkTimer: number;
    color: number;
  };
  const shower: Bit[] = [];
  // Secondary trail-sparks dripped by shower bits — same shape as
  // TrailSpark but with their own lifecycle.
  const sparks: TrailSpark[] = [];
  // Single brief flash flat-shaded ring at the explosion centre so
  // the burst has a bright "pop" frame.
  let flash: THREE.Mesh | null = null;

  function dropSpark(at: THREE.Vector3, color: number, max = 0.32) {
    const s = new THREE.Mesh(
      new THREE.SphereGeometry(0.06, 6, 6),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.8,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    s.position.copy(at);
    group.add(s);
    sparks.push({ mesh: s, life: 0, max });
  }

  function explode() {
    exploded = true;
    flashLife = 0;
    playFireworkBurst();
    // Tear down the rocket meshes — keep them around any longer and
    // they'd hang in mid-air.
    group.remove(rocket);
    rocket.geometry.dispose();
    (rocket.material as THREE.Material).dispose();
    group.remove(halo);
    halo.geometry.dispose();
    (halo.material as THREE.Material).dispose();
    for (const s of trail) {
      group.remove(s.mesh);
      s.mesh.geometry.dispose();
      (s.mesh.material as THREE.Material).dispose();
    }
    trail.length = 0;

    // Bright additive disc that pops at the explosion point and
    // shrinks/fades over flashMax. Sells the "flash bulb" moment.
    flash = new THREE.Mesh(
      new THREE.SphereGeometry(0.6, 14, 12),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.95,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    flash.position.set(0, peakY, 0);
    group.add(flash);

    // Burst — N bits launched outward in a sphere from the explosion
    // point. Most take the rocket colour; every fourth one takes the
    // accent so the firework reads as two-tone instead of monochrome.
    for (let i = 0; i < count; i++) {
      const color = i % 4 === 0 ? accentColor : rocketColor;
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(0.085, 6, 6),
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 1,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        })
      );
      // Random direction on a sphere — uniform sampling.
      const u = Math.random() * 2 - 1;
      const phi = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      const dir = new THREE.Vector3(r * Math.cos(phi), u, r * Math.sin(phi));
      // Bias the burst slightly upward so it reads more like a real
      // firework dome than a perfect sphere. Then add a little
      // randomization to speed so the front edge isn't a clean ring.
      dir.y += 0.25;
      dir.normalize();
      const speed = 6 + Math.random() * 4;
      m.position.set(0, peakY, 0);
      group.add(m);
      shower.push({
        mesh: m,
        vel: dir.multiplyScalar(speed),
        life: 0,
        max: 1.6 + Math.random() * 0.5,
        sparkTimer: Math.random() * 0.05,
        color,
      });
    }
  }

  return {
    group,
    update(dt) {
      elapsed += dt;
      if (!exploded) {
        // Rocket rises with an ease-out so it visually pauses at the
        // peak before bursting.
        const k = Math.min(1, elapsed / launchTime);
        const eased = 1 - (1 - k) * (1 - k);
        const y = launchY + (peakY - launchY) * eased;
        rocket.position.y = y;
        halo.position.y = y;
        // Halo pulses size + alpha for extra glow energy.
        const pulse = 1 + Math.sin(elapsed * 38) * 0.12;
        halo.scale.setScalar(pulse);
        (halo.material as THREE.MeshBasicMaterial).opacity = 0.4 + Math.sin(elapsed * 38) * 0.1;
        // Drop a trail spark every ~30ms for a streaked look.
        trailTimer += dt;
        while (trailTimer > 0.03) {
          trailTimer -= 0.03;
          const s = new THREE.Mesh(
            new THREE.SphereGeometry(0.08 - Math.random() * 0.03, 6, 6),
            new THREE.MeshBasicMaterial({
              color: rocketColor,
              transparent: true,
              opacity: 0.9,
              blending: THREE.AdditiveBlending,
              depthWrite: false,
            })
          );
          s.position.set((Math.random() - 0.5) * 0.08, y - 0.2, (Math.random() - 0.5) * 0.08);
          group.add(s);
          trail.push({ mesh: s, life: 0, max: 0.45 });
        }
        // Decay existing trail sparks.
        for (const s of trail) {
          s.life += dt;
          const tk = Math.min(1, s.life / s.max);
          (s.mesh.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - tk);
          s.mesh.scale.setScalar(1 - tk * 0.7);
        }
        if (k >= 1) explode();
        return true;
      }

      // Flash phase — disc-flash shrinks and fades.
      if (flash) {
        flashLife += dt;
        const fk = Math.min(1, flashLife / flashMax);
        const fs = 1 + fk * 4;
        flash.scale.setScalar(fs);
        (flash.material as THREE.MeshBasicMaterial).opacity = 0.95 * (1 - fk);
        if (fk >= 1) {
          group.remove(flash);
          flash.geometry.dispose();
          (flash.material as THREE.Material).dispose();
          flash = null;
        }
      }

      // Shower bits + their dripped sparks.
      let anyAlive = !!flash;
      for (const b of shower) {
        if (b.life >= b.max) continue;
        b.life += dt;
        // Light gravity so the spray drifts down rather than nose-
        // dives — feels floatier and more "magical".
        b.vel.y -= 7 * dt;
        // Air drag so bits slow as they go, like real fireworks.
        b.vel.multiplyScalar(0.985);
        b.mesh.position.addScaledVector(b.vel, dt);
        const k = b.life / b.max;
        const fade = 1 - k * k;
        (b.mesh.material as THREE.MeshBasicMaterial).opacity = fade;
        // Twinkle: brief brightness flicker so the bits sparkle as
        // they trail off rather than just dimming linearly.
        const twinkle = 0.85 + Math.sin(elapsed * 18 + b.sparkTimer * 100) * 0.15;
        (b.mesh.material as THREE.MeshBasicMaterial).opacity *= twinkle;
        const s = 1 - 0.4 * k;
        b.mesh.scale.setScalar(s);
        // Drop a micro-spark every ~50ms in the first half of the bit's
        // life, so the burst leaves a light fading sparkle behind each
        // streamer.
        b.sparkTimer += dt;
        if (b.sparkTimer > 0.05 && k < 0.55) {
          b.sparkTimer = 0;
          dropSpark(b.mesh.position, b.color, 0.28);
        }
        anyAlive = true;
      }

      // Decay micro-sparks dropped by the shower.
      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i];
        s.life += dt;
        const k = Math.min(1, s.life / s.max);
        (s.mesh.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - k);
        s.mesh.scale.setScalar(1 - k * 0.6);
        if (k >= 1) {
          group.remove(s.mesh);
          s.mesh.geometry.dispose();
          (s.mesh.material as THREE.Material).dispose();
          sparks.splice(i, 1);
        } else {
          anyAlive = true;
        }
      }

      if (!anyAlive) {
        for (const b of shower) {
          b.mesh.geometry.dispose();
          (b.mesh.material as THREE.Material).dispose();
        }
      }
      return anyAlive;
    },
  };
}
