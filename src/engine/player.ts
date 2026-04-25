import * as THREE from "three";

export type PlayerHandles = {
  group: THREE.Group;
  update: (dt: number, input: { x: number; y: number }) => void;
  position: () => THREE.Vector3;
};

const SPEED = 7;
const TURN_LERP = 0.18;

export function buildPlayer(): PlayerHandles {
  const group = new THREE.Group();
  group.name = "Player";

  // Body
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.45, 0.6, 6, 12),
    new THREE.MeshStandardMaterial({ color: 0xff8c4a, roughness: 0.7 })
  );
  body.position.y = 0.55;
  body.castShadow = true;
  group.add(body);

  // Belly
  const belly = new THREE.Mesh(
    new THREE.SphereGeometry(0.3, 12, 10),
    new THREE.MeshStandardMaterial({ color: 0xffd56b, roughness: 0.8 })
  );
  belly.position.set(0, 0.45, 0.32);
  group.add(belly);

  // Eyes
  const whiteMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
  const pupilMat = new THREE.MeshStandardMaterial({ color: 0x222222 });
  for (const x of [-0.18, 0.18]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), whiteMat);
    eye.position.set(x, 0.92, 0.34);
    group.add(eye);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), pupilMat);
    pupil.position.set(x, 0.92, 0.44);
    group.add(pupil);
  }

  // Smile
  const smile = new THREE.Mesh(
    new THREE.TorusGeometry(0.08, 0.025, 8, 12, Math.PI),
    new THREE.MeshStandardMaterial({ color: 0xa13b1b })
  );
  smile.position.set(0, 0.78, 0.46);
  smile.rotation.x = Math.PI / 2;
  group.add(smile);

  // Feet
  const footMat = new THREE.MeshStandardMaterial({ color: 0x5c3a1a });
  const leftFoot = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8), footMat);
  leftFoot.position.set(-0.2, 0.05, 0.05);
  leftFoot.castShadow = true;
  group.add(leftFoot);
  const rightFoot = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8), footMat);
  rightFoot.position.set(0.2, 0.05, 0.05);
  rightFoot.castShadow = true;
  group.add(rightFoot);

  let facing = 0;
  let bob = 0;

  return {
    group,
    update(dt, input) {
      const isMoving = Math.hypot(input.x, input.y) > 0.05;
      if (isMoving) {
        const speed = SPEED * dt;
        group.position.x += input.x * speed;
        group.position.z += input.y * speed;
        const targetYaw = Math.atan2(input.x, input.y);
        let delta = targetYaw - facing;
        while (delta > Math.PI) delta -= Math.PI * 2;
        while (delta < -Math.PI) delta += Math.PI * 2;
        facing += delta * TURN_LERP;
        group.rotation.y = facing + Math.PI;
        bob += dt * 12;
      } else {
        bob += dt * 3;
      }
      const bobAmt = isMoving ? 0.12 : 0.05;
      group.position.y = Math.abs(Math.sin(bob)) * bobAmt;
    },
    position() {
      return group.position;
    },
  };
}
