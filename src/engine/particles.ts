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
