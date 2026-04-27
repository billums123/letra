import * as THREE from "three";

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

// A two-phase firework: a single bright "rocket" climbs straight up
// from `position` for ~0.45s, then explodes into a wide spherical
// shower of glowing bits that fall and fade. Used during the dance-
// party finale when the kid bumps a letter — each contact launches
// a small firework instead of speaking the letter's name.
export function makeFirework(position: THREE.Vector3, count = 36): Burst {
  const group = new THREE.Group();
  group.position.copy(position);

  const launchY = 1.2;
  const peakY = 4.0;
  const launchTime = 0.45;
  let elapsed = 0;
  let exploded = false;

  // Rocket — a single bright glowing dot rising upward.
  const rocketColor = COLORS[(Math.random() * COLORS.length) | 0];
  const rocket = new THREE.Mesh(
    new THREE.SphereGeometry(0.18, 10, 8),
    new THREE.MeshBasicMaterial({ color: rocketColor, transparent: true, opacity: 1 })
  );
  rocket.position.y = launchY;
  group.add(rocket);
  // Trailing tail — a tall thin sprite stretched behind the rocket so
  // the rise reads as motion even at 60fps.
  const tail = new THREE.Mesh(
    new THREE.PlaneGeometry(0.14, 0.9),
    new THREE.MeshBasicMaterial({
      color: rocketColor,
      transparent: true,
      opacity: 0.6,
      side: THREE.DoubleSide,
    })
  );
  tail.position.y = launchY - 0.5;
  tail.rotation.y = Math.random() * Math.PI;
  group.add(tail);

  // Shower bits get materialized at explosion time.
  type Bit = {
    mesh: THREE.Mesh;
    vel: THREE.Vector3;
    life: number;
    max: number;
  };
  const shower: Bit[] = [];

  function explode() {
    exploded = true;
    group.remove(rocket);
    rocket.geometry.dispose();
    (rocket.material as THREE.Material).dispose();
    group.remove(tail);
    tail.geometry.dispose();
    (tail.material as THREE.Material).dispose();
    // Burst — N bits launched outward in a sphere from the explosion
    // point. Use a couple of palette colours so the firework reads as
    // multi-coloured rather than monochrome.
    for (let i = 0; i < count; i++) {
      const c1 = COLORS[(Math.random() * COLORS.length) | 0];
      const c2 = COLORS[(Math.random() * COLORS.length) | 0];
      const color = i % 3 === 0 ? c2 : c1;
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(0.09, 6, 6),
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 1,
        })
      );
      // Random direction on a sphere — uniform sampling.
      const u = Math.random() * 2 - 1;
      const phi = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      const dir = new THREE.Vector3(r * Math.cos(phi), u, r * Math.sin(phi));
      const speed = 5 + Math.random() * 4;
      m.position.set(0, peakY, 0);
      group.add(m);
      shower.push({
        mesh: m,
        vel: dir.multiplyScalar(speed),
        life: 0,
        max: 1.4 + Math.random() * 0.6,
      });
    }
  }

  return {
    group,
    update(dt) {
      elapsed += dt;
      if (!exploded) {
        // Rocket rises with a slight ease-out so it visually pauses at
        // the peak before bursting.
        const k = Math.min(1, elapsed / launchTime);
        const eased = 1 - (1 - k) * (1 - k);
        rocket.position.y = launchY + (peakY - launchY) * eased;
        tail.position.y = rocket.position.y - 0.5;
        // Mild sparkle: pulse the opacity so the rocket reads as glowing.
        (rocket.material as THREE.MeshBasicMaterial).opacity = 0.85 + Math.sin(elapsed * 50) * 0.15;
        if (k >= 1) explode();
        return true;
      }
      // Shower phase — gravity-bound bits fade out as they fall.
      let anyAlive = false;
      for (const b of shower) {
        if (b.life >= b.max) continue;
        b.life += dt;
        b.vel.y -= 9 * dt;
        b.mesh.position.addScaledVector(b.vel, dt);
        const k = b.life / b.max;
        (b.mesh.material as THREE.MeshBasicMaterial).opacity = 1 - k * k;
        // Slight per-frame shrink near the end so they don't pop out.
        const s = 1 - 0.3 * k;
        b.mesh.scale.setScalar(s);
        anyAlive = true;
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
