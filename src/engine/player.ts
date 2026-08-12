import * as THREE from "three";
import type { AvatarKind } from "../state/store";
import { motor, playKidStep, playCarPutt, thrust } from "../audio/sfx";

export type PlayerHandles = {
  group: THREE.Group;
  update: (dt: number, input: { x: number; y: number }) => void;
  position: () => THREE.Vector3;
  // Current yaw in radians. The engine reads this to compose the
  // avatar's full orientation (yaw + terrain tilt) — so avatars must
  // NOT write to group.rotation.y themselves.
  facing: () => number;
  // Whether the engine should tilt this avatar to match the terrain
  // incline. Hovering avatars (rocket) opt out by setting this false.
  terrainAlign?: boolean;
  // Tear-down hook called by Engine.dispose(). Used by avatars that
  // own continuous resources (the car's motor loop, etc.).
  dispose?: () => void;
};

const SPEED = 7;
const TURN_LERP = 0.18;

// Top-level factory the engine calls. Adds avatar variants without
// each game/screen needing to know about the underlying meshes.
export function buildAvatar(kind: AvatarKind): PlayerHandles {
  if (kind === "car") return buildCar();
  if (kind === "rocket") return buildRocket();
  if (kind === "boat") return buildBoat();
  return buildKid();
}

// Backwards-compatible alias — older callers just want the original kid.
export function buildPlayer(): PlayerHandles {
  return buildKid();
}

function buildKid(): PlayerHandles {
  const group = new THREE.Group();
  group.name = "Player";

  // Body
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.45, 0.6, 6, 12),
    new THREE.MeshStandardMaterial({ color: 0xff8c4a, roughness: 0.7 }),
  );
  body.position.y = 0.55;
  body.castShadow = true;
  group.add(body);

  // Belly — a flattened oval patch on the body surface rather than a
  // protruding hemisphere. From the side the original sphere read as
  // a stuck-on blob; the squashed Z scale hugs the capsule curve.
  const belly = new THREE.Mesh(
    new THREE.SphereGeometry(0.3, 16, 12),
    new THREE.MeshStandardMaterial({ color: 0xffd56b, roughness: 0.8 }),
  );
  belly.scale.set(1.05, 0.95, 0.35);
  // Drop the patch below the smile (smile sits at y=0.78) so the
  // tummy and the mouth don't merge into one shape from the front.
  belly.position.set(0, 0.32, 0.42);
  group.add(belly);

  // Eyes
  const whiteMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
  const pupilMat = new THREE.MeshStandardMaterial({ color: 0x222222 });
  for (const x of [-0.18, 0.18]) {
    const eye = new THREE.Mesh(
      new THREE.SphereGeometry(0.13, 12, 10),
      whiteMat,
    );
    eye.position.set(x, 0.92, 0.34);
    group.add(eye);
    const pupil = new THREE.Mesh(
      new THREE.SphereGeometry(0.06, 10, 8),
      pupilMat,
    );
    pupil.position.set(x, 0.92, 0.44);
    group.add(pupil);
  }

  // Smile
  const smile = new THREE.Mesh(
    new THREE.TorusGeometry(0.08, 0.025, 8, 12, Math.PI),
    new THREE.MeshStandardMaterial({ color: 0xa13b1b }),
  );
  smile.position.set(0, 0.78, 0.46);
  // Rotate the half-torus so it faces the camera as an upward-opening
  // "smile" (⌣) instead of lying flat in the XZ plane.
  smile.rotation.x = Math.PI;
  group.add(smile);

  // Feet
  const footMat = new THREE.MeshStandardMaterial({ color: 0x5c3a1a });
  const leftFoot = new THREE.Mesh(
    new THREE.SphereGeometry(0.18, 10, 8),
    footMat,
  );
  leftFoot.position.set(-0.2, 0.05, 0.05);
  leftFoot.castShadow = true;
  group.add(leftFoot);
  const rightFoot = new THREE.Mesh(
    new THREE.SphereGeometry(0.18, 10, 8),
    footMat,
  );
  rightFoot.position.set(0.2, 0.05, 0.05);
  rightFoot.castShadow = true;
  group.add(rightFoot);

  let facing = 0;
  let bob = 0;
  let prevBobAbs = 0;

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
        // The character's face is built on local +Z. atan2(input.x, input.y)
        // gives the yaw whose forward (+Z after rotation) points along the
        // movement vector — no offset needed. Engine composes yaw + terrain
        // tilt onto group.quaternion each frame; we just track facing here.
        bob += dt * 12;
      } else {
        bob += dt * 3;
      }
      const bobAmt = isMoving ? 0.12 : 0.05;
      const curBobAbs = Math.abs(Math.sin(bob));
      group.position.y = curBobAbs * bobAmt;
      // Trigger a footstep blip each time the bob peaks while moving — the
      // peak coincides with the foot landing visually. We detect the peak
      // by watching for the |sin| derivative changing from rising to
      // falling. playKidStep is internally throttled so we can call it
      // freely.
      if (isMoving && prevBobAbs > 0.92 && curBobAbs < prevBobAbs) {
        playKidStep();
      }
      prevBobAbs = curBobAbs;
    },
    position() {
      return group.position;
    },
    facing() {
      return facing;
    },
  };
}

// ─── Car avatar ──────────────────────────────────────────────────────────────
// A cartoony low-poly buggy. Exposes the same PlayerHandles shape as the
// kid so the engine treats it identically. The body and cabin are
// rounded boxes; the wheels rotate based on travelled distance, and the
// chassis bobs faintly while moving for an "engine vibration" feel.
//
// Controls are deliberately not realistic — no inertia, no traditional
// steering. Same omnidirectional input as the kid because a 3yo cannot
// reverse-park anything.

const CAR_COLOR = 0xff5555; // bright cherry red
const CAR_ACCENT = 0xfff7d6; // soft cream for cabin / details
const CAR_TIRE = 0x222222;
const CAR_RIM = 0xffd56b;

function buildCar(): PlayerHandles {
  const group = new THREE.Group();
  group.name = "Player";

  // Chassis: a rounded box (BoxGeometry with bevel-ish look via slight
  // separate shapes). For pre-K simplicity we use a single BoxGeometry
  // and rely on the cute proportions + face to read as cartoony.
  const bodyMat = new THREE.MeshStandardMaterial({
    color: CAR_COLOR,
    roughness: 0.5,
    metalness: 0.05,
  });
  const accentMat = new THREE.MeshStandardMaterial({
    color: CAR_ACCENT,
    roughness: 0.7,
  });

  const body = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.5, 1.9), bodyMat);
  body.position.y = 0.45;
  body.castShadow = true;
  group.add(body);

  // Hood — slight wedge at the front so the car has a visible "front".
  const hood = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.18, 0.55), bodyMat);
  hood.position.set(0, 0.62, 0.65);
  hood.castShadow = true;
  group.add(hood);

  // Cabin — rounded-roof block on top centred slightly back.
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.55, 0.95), bodyMat);
  cabin.position.set(0, 0.95, -0.15);
  cabin.castShadow = true;
  group.add(cabin);

  // Cabin roof topper — a lighter cream stripe so the cabin reads
  // visually distinct from the body even on small screens.
  const roof = new THREE.Mesh(
    new THREE.BoxGeometry(1.0, 0.08, 0.85),
    accentMat,
  );
  roof.position.set(0, 1.27, -0.15);
  group.add(roof);

  // Windshield — a tilted dark plate front of the cabin so it reads
  // as glass rather than another solid panel.
  const windshield = new THREE.Mesh(
    new THREE.BoxGeometry(1.05, 0.45, 0.08),
    new THREE.MeshStandardMaterial({
      color: 0x2a4a6a,
      roughness: 0.2,
      metalness: 0.4,
      transparent: true,
      opacity: 0.8,
    }),
  );
  windshield.position.set(0, 0.97, 0.34);
  windshield.rotation.x = -Math.PI / 12;
  group.add(windshield);

  // Headlight "eyes" — big white spheres so the kid recognises which
  // way the car is facing.
  const whiteMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.3,
    emissive: 0xfff8c2,
    emissiveIntensity: 0.25,
  });
  const pupilMat = new THREE.MeshStandardMaterial({
    color: 0x111111,
    roughness: 0.4,
  });
  for (const dx of [-0.42, 0.42]) {
    const eye = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 14, 12),
      whiteMat,
    );
    eye.position.set(dx, 0.6, 0.92);
    group.add(eye);
    const pupil = new THREE.Mesh(
      new THREE.SphereGeometry(0.07, 10, 8),
      pupilMat,
    );
    pupil.position.set(dx, 0.6, 1.05);
    group.add(pupil);
  }

  // Cute grille smile under the headlights. The torus sits IN the front-
  // face plane (XY at the bumper) so the camera sees it broadside; we
  // only need a Z-axis flip to turn the default upper-half arc (frown)
  // into a lower-half smile. The previous extra X rotation rolled the
  // torus 90° forward so it appeared as a thin edge-on line from the
  // front — which is what the screenshot showed.
  const smile = new THREE.Mesh(
    new THREE.TorusGeometry(0.18, 0.04, 8, 16, Math.PI),
    new THREE.MeshStandardMaterial({ color: 0x3a1c10 }),
  );
  smile.position.set(0, 0.34, 0.97);
  smile.rotation.z = Math.PI;
  group.add(smile);

  // Wheels — 4 cylinders, capped on each side so the rim shows from any
  // angle. Stored so the update loop can spin them with travel speed.
  const wheelMat = new THREE.MeshStandardMaterial({
    color: CAR_TIRE,
    roughness: 0.9,
  });
  const rimMat = new THREE.MeshStandardMaterial({
    color: CAR_RIM,
    roughness: 0.6,
  });
  const wheels: THREE.Group[] = [];
  const wheelGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.22, 18);
  const rimGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.24, 12);
  for (const [dx, dz] of [
    [-0.7, -0.6],
    [0.7, -0.6],
    [-0.7, 0.6],
    [0.7, 0.6],
  ] as [number, number][]) {
    const wheel = new THREE.Group();
    const tire = new THREE.Mesh(wheelGeo, wheelMat);
    tire.rotation.z = Math.PI / 2;
    tire.castShadow = true;
    wheel.add(tire);
    const rim = new THREE.Mesh(rimGeo, rimMat);
    rim.rotation.z = Math.PI / 2;
    wheel.add(rim);
    wheel.position.set(dx, 0.3, dz);
    group.add(wheel);
    wheels.push(wheel);
  }

  // Tail pipe — a short dark stub tucked under the rear of the car so
  // it reads as "exhaust pipe" without breaking the silhouette. Sits
  // below the body (body bottom is at y=0.20) and slightly off-centre
  // so the centred grille smile up front isn't visually mirrored by
  // a centred outlet at the back.
  const pipeMat = new THREE.MeshStandardMaterial({
    color: 0x2a2a2a,
    roughness: 0.5,
    metalness: 0.5,
  });
  const tailPipe = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.06, 0.18, 12),
    pipeMat,
  );
  tailPipe.rotation.x = Math.PI / 2;
  // Pipe centred on the rear bumper (rear face at z = -0.95) so only
  // a short stub pokes out — reads as a tucked-in tail pipe rather
  // than a long external exhaust standing off the back.
  tailPipe.position.set(0.38, 0.16, -0.95);
  tailPipe.castShadow = true;
  group.add(tailPipe);

  // Exhaust trail — a small ring of puff sprites that emit from the
  // pipe outlet, drift backward + upward, grow and fade out, then
  // reset. Multiple staggered puffs read as "smoke trail" instead of
  // a single pulsing blob. Each puff owns its own material clone so
  // it can fade independently. depthWrite is off so the transparent
  // edges don't punch a hole in whatever's behind them.
  const PUFF_COUNT = 6;
  // Origin sits at the pipe outlet (pipe centre z=-0.95, length 0.18,
  // so the back face is at z=-1.04). Puffs spawn just behind that.
  const puffOrigin = new THREE.Vector3(0.38, 0.14, -1.07);
  const puffs: { mesh: THREE.Mesh; age: number; lifetime: number; jitter: number }[] = [];
  for (let i = 0; i < PUFF_COUNT; i++) {
    const m = new THREE.MeshBasicMaterial({
      // A barely-warm grey — a hair off neutral so the trail reads as
      // exhaust on green grass without looking like a UI element.
      color: 0xc8c2bc,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), m);
    group.add(mesh);
    puffs.push({
      mesh,
      // Stagger initial ages so the trail starts populated rather
      // than spawning all six at once on the first frame.
      age: (i / PUFF_COUNT) * 1.0,
      lifetime: 0.9 + Math.random() * 0.4,
      jitter: Math.random() * Math.PI * 2,
    });
  }

  let facing = 0;
  let bob = 0;
  let wheelSpin = 0;
  // Schedule the next cartoony "putt-putt" at a random interval so the
  // engine flourishes don't feel metronomic. Re-rolled after each pop.
  let nextPuttAt = performance.now() + 1500 + Math.random() * 2500;

  // Kick the motor loop the moment the car spawns so the kid hears an
  // idle purr while parked. setActivity() in update() animates between
  // idle and full-throttle.
  motor.start();

  return {
    group,
    update(dt, input) {
      const mag = Math.hypot(input.x, input.y);
      const isMoving = mag > 0.05;
      if (isMoving) {
        const speed = SPEED * dt;
        group.position.x += input.x * speed;
        group.position.z += input.y * speed;
        const targetYaw = Math.atan2(input.x, input.y);
        let delta = targetYaw - facing;
        while (delta > Math.PI) delta -= Math.PI * 2;
        while (delta < -Math.PI) delta += Math.PI * 2;
        // Slightly snappier turn than the kid because a car turning
        // slowly looks lazier than a character.
        facing += delta * (TURN_LERP + 0.05);
        bob += dt * 18;
        // Spin wheels at travel speed. tire radius = 0.3, so radians per
        // second = linear speed / radius. We use SPEED directly because
        // the input magnitude is clamped to 1 and we want full-speed
        // wheel rotation when fully forward.
        wheelSpin += dt * (SPEED / 0.3) * mag;
      } else {
        bob += dt * 4;
      }
      // Engine-vibration bob: only a few mm — never below the rest pose.
      const bobAmt = isMoving ? 0.04 : 0.012;
      group.position.y = Math.abs(Math.sin(bob)) * bobAmt;
      // Apply wheel spin around each wheel's local X (already rotated
      // 90° on Z to lay flat, so X is now the world rolling axis).
      for (const w of wheels) w.rotation.x = wheelSpin;
      // Engine pitch + volume tracks input magnitude.
      motor.setActivity(mag);
      // Exhaust trail — each puff ages forward, drifts backward + up,
      // grows, and fades out, then resets to a fresh lifetime. Speeds
      // up under throttle so the trail visibly spools when the car is
      // driving. All positions are in car-local space; the puffs
      // therefore travel with the car when it turns, which reads
      // correctly as "trailing behind".
      const emitRate = 0.7 + mag * 1.3;
      const trailDistance = 0.5 + mag * 0.55;
      for (const p of puffs) {
        p.age += dt * emitRate;
        if (p.age >= p.lifetime) {
          p.age -= p.lifetime;
          p.lifetime = 0.85 + Math.random() * 0.5;
          p.jitter = Math.random() * Math.PI * 2;
        }
        const t = Math.min(1, p.age / p.lifetime);
        // Drift backwards (-Z) + slowly upward (+Y), with a small
        // sideways wobble so the line of puffs doesn't read as a
        // straight ruler. The wobble phase comes from p.jitter so
        // every puff snakes differently.
        const sideways = Math.sin(p.jitter + t * 6) * 0.06 * t;
        p.mesh.position.set(
          puffOrigin.x + sideways,
          puffOrigin.y + t * 0.14,
          puffOrigin.z - t * trailDistance,
        );
        // Grow as it ages — fresh puffs are tight, old puffs are
        // billowy clouds. Restrained growth so the trail stays a
        // subtle wisp rather than a smoke screen.
        const scale = 0.45 + t * 1.1;
        p.mesh.scale.setScalar(scale);
        // Opacity envelope: fade in fast, fade out slow. Idle puffs
        // are barely-there; throttle puffs are still wispy. The
        // numbers are deliberately low — exhaust is meant to read
        // as ambient detail, not a focal effect.
        const fadeIn = Math.min(1, t / 0.12);
        const fadeOut = Math.max(0, 1 - (t - 0.12) / 0.88);
        const baseAlpha = 0.04 + mag * 0.14;
        (p.mesh.material as THREE.MeshBasicMaterial).opacity =
          baseAlpha * fadeIn * fadeOut;
      }
      // Cartoony putt-putts sprinkle through the drive at random
      // intervals so the engine reads as alive. No takeoff vroom —
      // it kept retriggering on direction changes mid-turn.
      if (isMoving && performance.now() >= nextPuttAt) {
        playCarPutt();
        nextPuttAt = performance.now() + 2000 + Math.random() * 2500;
      }
    },
    position() {
      return group.position;
    },
    facing() {
      return facing;
    },
    dispose() {
      motor.stop();
    },
  };
}

// Rocket avatar — hovers ~1.5 units above the ground, tilts in the
// direction of travel, and trails a flickering flame from its nozzle.
// Movement uses the same omnidirectional model as the car/kid; the
// only differences are the floating Y, the lean-into-direction
// rotation, and the flame trail.
function buildRocket(): PlayerHandles {
  const group = new THREE.Group();
  group.name = "Player";
  // The rocket as a whole hovers at this baseline Y plus a small bob.
  const HOVER_Y = 1.5;

  // Pivot subgroup so we can lean the rocket forward without moving
  // its hover position. Children of `body` are positioned in rocket-
  // local space; `body` itself rotates.
  const body = new THREE.Group();
  group.add(body);

  // Main fuselage — a tall rounded cylinder.
  const fuselage = new THREE.Mesh(
    new THREE.CylinderGeometry(0.4, 0.5, 1.2, 16),
    new THREE.MeshStandardMaterial({
      color: 0xf5f5f7,
      roughness: 0.55,
      metalness: 0.1,
    }),
  );
  fuselage.position.y = 0;
  fuselage.castShadow = true;
  body.add(fuselage);

  // Red accent stripe near the top.
  const stripe = new THREE.Mesh(
    new THREE.CylinderGeometry(0.405, 0.405, 0.18, 16),
    new THREE.MeshStandardMaterial({ color: 0xff5e5e, roughness: 0.5 }),
  );
  stripe.position.y = 0.32;
  body.add(stripe);

  // Nose cone.
  const nose = new THREE.Mesh(
    new THREE.ConeGeometry(0.4, 0.7, 16),
    new THREE.MeshStandardMaterial({ color: 0xff5e5e, roughness: 0.45 }),
  );
  nose.position.y = 0.95;
  nose.castShadow = true;
  body.add(nose);

  // Round window with a friendly cyan tint and a tiny shine.
  const windowFrame = new THREE.Mesh(
    new THREE.SphereGeometry(0.18, 16, 12),
    new THREE.MeshStandardMaterial({ color: 0x3a2a14, roughness: 0.6 }),
  );
  windowFrame.position.set(0, 0.18, 0.42);
  windowFrame.scale.z = 0.4;
  body.add(windowFrame);
  const windowGlass = new THREE.Mesh(
    new THREE.SphereGeometry(0.14, 16, 12),
    new THREE.MeshStandardMaterial({
      color: 0x9ee3ff,
      roughness: 0.2,
      metalness: 0.2,
      emissive: 0x4ab0e8,
      emissiveIntensity: 0.2,
    }),
  );
  windowGlass.position.set(0, 0.18, 0.46);
  windowGlass.scale.z = 0.4;
  body.add(windowGlass);
  const windowShine = new THREE.Mesh(
    new THREE.SphereGeometry(0.04, 8, 8),
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
  );
  windowShine.position.set(-0.05, 0.23, 0.5);
  windowShine.scale.z = 0.4;
  body.add(windowShine);

  // Four fins around the base.
  const finMat = new THREE.MeshStandardMaterial({
    color: 0xff5e5e,
    roughness: 0.5,
  });
  const finShape = new THREE.Shape();
  finShape.moveTo(0, 0);
  finShape.lineTo(0.45, -0.1);
  finShape.lineTo(0.45, -0.3);
  finShape.lineTo(0, -0.4);
  finShape.lineTo(0, 0);
  const finGeo = new THREE.ExtrudeGeometry(finShape, {
    depth: 0.04,
    bevelEnabled: false,
  });
  for (let i = 0; i < 4; i++) {
    const fin = new THREE.Mesh(finGeo, finMat);
    fin.position.y = -0.5;
    fin.rotation.y = (i / 4) * Math.PI * 2;
    // Push the fin out from centre along its facing axis.
    fin.position.x = Math.cos(fin.rotation.y) * 0.42;
    fin.position.z = Math.sin(fin.rotation.y) * 0.42;
    fin.castShadow = true;
    body.add(fin);
  }

  // Flame — a stretched cone hanging from the nozzle. Pulses + flickers
  // each frame in the update loop. Uses additive blending so it glows
  // against the dark stripe of the body.
  const flameMat = new THREE.MeshBasicMaterial({
    color: 0xff8c2a,
    transparent: true,
    opacity: 0.95,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.7, 14), flameMat);
  flame.position.y = -0.95;
  flame.rotation.x = Math.PI; // point downward
  body.add(flame);
  // Inner brighter core for extra glow.
  const flameCoreMat = new THREE.MeshBasicMaterial({
    color: 0xffe066,
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const flameCore = new THREE.Mesh(
    new THREE.ConeGeometry(0.18, 0.45, 12),
    flameCoreMat,
  );
  flameCore.position.y = -0.85;
  flameCore.rotation.x = Math.PI;
  body.add(flameCore);

  // State for the per-frame update loop.
  let facing = 0;
  let bob = 0;
  let leanX = 0;
  let leanZ = 0;
  // Hover offset so the spawn position (y=0) is interpreted as ground.
  group.position.y = HOVER_Y;

  thrust.start();

  return {
    group,
    update(dt, input) {
      const mag = Math.hypot(input.x, input.y);
      const isMoving = mag > 0.05;
      if (isMoving) {
        const speed = SPEED * dt;
        group.position.x += input.x * speed;
        group.position.z += input.y * speed;
        const targetYaw = Math.atan2(input.x, input.y);
        let delta = targetYaw - facing;
        while (delta > Math.PI) delta -= Math.PI * 2;
        while (delta < -Math.PI) delta += Math.PI * 2;
        facing += delta * (TURN_LERP + 0.05);
        bob += dt * 16;
      } else {
        bob += dt * 5;
      }
      // Hover bob — gentle vertical oscillation.
      const bobAmt = isMoving ? 0.18 : 0.1;
      group.position.y = HOVER_Y + Math.sin(bob) * bobAmt;
      // Yaw is composed by the engine onto group.quaternion (along with
      // terrain tilt for ground avatars; we opt out of that below).
      // Lean the body forward in the direction of travel. We compute
      // body-local lean: forward vector is +Z in body space because
      // the group is yawed to face that direction.
      const targetLeanX = isMoving ? 0.45 * mag : 0; // forward pitch
      leanX += (targetLeanX - leanX) * 0.12;
      // A subtle side-lean adds character — shift the lean axis based
      // on how much the rocket is turning. Approximated via a delta.
      const targetLeanZ = 0;
      leanZ += (targetLeanZ - leanZ) * 0.12;
      body.rotation.x = leanX;
      body.rotation.z = leanZ;
      // Flame flicker — randomized scale + opacity each frame.
      const intensity = 0.6 + mag * 0.6;
      const flick = 0.85 + Math.random() * 0.3;
      flame.scale.set(flick, intensity * flick, flick);
      flameCore.scale.set(flick * 0.8, intensity * 0.85 * flick, flick * 0.8);
      (flame.material as THREE.MeshBasicMaterial).opacity = 0.6 + mag * 0.4;
      (flameCore.material as THREE.MeshBasicMaterial).opacity = 0.7 + mag * 0.3;
      // Thrust loop tracks input magnitude — quiet hiss while idle,
      // brighter and louder under full input.
      thrust.setActivity(mag);
    },
    position() {
      return group.position;
    },
    facing() {
      return facing;
    },
    // Hovering avatar — terrain incline shouldn't tilt the rocket.
    terrainAlign: false,
    dispose() {
      thrust.stop();
    },
  };
}


// ─── Boat avatar ─────────────────────────────────────────────────────────────
// A chubby cartoon tugboat for the ocean biome. Same omnidirectional
// control model as the car; terrainAlign stays true so the engine's
// terrain-tilt rides the biome's animated wave field — that pitch and
// roll over swells is most of what makes the boat feel like it's on
// water. A white foam wake streams from the stern, and the smokestack
// drips little steam puffs that speed up under throttle.
function buildBoat(): PlayerHandles {
  const group = new THREE.Group();
  group.name = "Player";

  const hullMat = new THREE.MeshStandardMaterial({ color: 0x3f7fd0, roughness: 0.55 });
  const hullTrimMat = new THREE.MeshStandardMaterial({ color: 0xe6473a, roughness: 0.6 });
  const deckMat = new THREE.MeshStandardMaterial({ color: 0xfff3da, roughness: 0.75 });

  // Hull — wide rounded box, slightly narrower at the bow via a scaled
  // second box overlapping the front. Sits low so the waterline reads.
  const hull = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.55, 2.1), hullMat);
  hull.position.y = 0.42;
  hull.castShadow = true;
  group.add(hull);
  // Red boot stripe under the hull.
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.34, 0.16, 2.14), hullTrimMat);
  stripe.position.y = 0.2;
  group.add(stripe);
  // Rounded bow cap — a full vertical cylinder centred on the hull's
  // front face: the back half embeds in the hull box and the front
  // half rounds the bow. The face features sit ON this curve.
  const BOW_R = 0.65;
  const BOW_Z = 1.05;
  const bow = new THREE.Mesh(new THREE.CylinderGeometry(BOW_R, BOW_R, 0.55, 16), hullMat);
  bow.position.set(0, 0.42, BOW_Z);
  bow.castShadow = true;
  group.add(bow);

  // Deck cabin — cream block with a little roof.
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.55, 0.9), deckMat);
  cabin.position.set(0, 0.95, -0.25);
  cabin.castShadow = true;
  group.add(cabin);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.12, 1.0), hullTrimMat);
  roof.position.set(0, 1.28, -0.25);
  group.add(roof);
  // Porthole windows on the cabin sides.
  const portholeMat = new THREE.MeshStandardMaterial({
    color: 0x9ee3ff,
    roughness: 0.25,
    emissive: 0x4ab0e8,
    emissiveIntensity: 0.15,
  });
  for (const side of [-1, 1]) {
    const porthole = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.06, 12), portholeMat);
    porthole.rotation.z = Math.PI / 2;
    porthole.position.set(side * 0.45, 1.0, -0.25);
    group.add(porthole);
  }

  // Smokestack with a red band. Centred over the cabin (z = -0.25,
  // same as the cabin and roof) and standing clear of the roof slab,
  // whose top face is at y = 1.34. It used to sit at z = -0.6 with its
  // base at y = 1.25 — off to the back edge AND sunk into the roof, so
  // the two solids intersected and the stack looked like it was
  // melting through the corner.
  const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 0.5, 10), hullMat);
  stack.position.set(0, 1.62, -0.25);
  stack.castShadow = true;
  group.add(stack);
  const stackBand = new THREE.Mesh(new THREE.CylinderGeometry(0.155, 0.155, 0.12, 10), hullTrimMat);
  stackBand.position.set(0, 1.8, -0.25);
  group.add(stackBand);

  // Googly eyes on the bow so the kid knows which way is forward.
  // Each eye sits half-sunk into the bow curve: its centre is pushed
  // to just inside the cylinder surface at its own x-offset, so the
  // sphere visibly emerges from the hull instead of floating ahead
  // of it.
  const whiteMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 });
  const pupilMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.4 });
  for (const dx of [-0.28, 0.28]) {
    const surfaceZ = BOW_Z + Math.sqrt(BOW_R * BOW_R - dx * dx);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.15, 14, 12), whiteMat);
    eye.position.set(dx, 0.62, surfaceZ - 0.07);
    group.add(eye);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), pupilMat);
    pupil.position.set(dx, 0.62, surfaceZ + 0.05);
    group.add(pupil);
  }
  // Bow smile — flat torus arc pressed into the front of the bow
  // curve (slightly embedded at its widest points).
  const smile = new THREE.Mesh(
    new THREE.TorusGeometry(0.16, 0.035, 8, 16, Math.PI),
    new THREE.MeshStandardMaterial({ color: 0x203a5c }),
  );
  smile.position.set(0, 0.36, BOW_Z + BOW_R - 0.06);
  smile.rotation.z = Math.PI;
  smile.rotation.x = -0.15;
  group.add(smile);

  // Steam puffs from the stack — reuse the car's recycled-pool pattern
  // but drifting straight up and white.
  const STEAM_COUNT = 5;
  const steamOrigin = new THREE.Vector3(0, 1.8, -0.6);
  const steams: { mesh: THREE.Mesh; age: number; lifetime: number; jitter: number }[] = [];
  for (let i = 0; i < STEAM_COUNT; i++) {
    const m = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), m);
    group.add(mesh);
    steams.push({ mesh, age: (i / STEAM_COUNT) * 1.1, lifetime: 1.0 + Math.random() * 0.4, jitter: Math.random() * Math.PI * 2 });
  }
  // Wake foam behind the stern, hugging the waterline.
  // Wake — a fan of flat foam blobs streaming off the stern, plus two
  // V-arm trails peeling off the bow sides. Deliberately loud: the
  // wake is half of what sells "boat on water".
  const WAKE_COUNT = 12;
  const wakeOrigin = new THREE.Vector3(0, 0.1, -1.15);
  const wakes: { mesh: THREE.Mesh; age: number; lifetime: number; side: number; arm: number }[] = [];
  for (let i = 0; i < WAKE_COUNT; i++) {
    const m = new THREE.MeshBasicMaterial({ color: 0xeafaff, transparent: true, opacity: 0, depthWrite: false });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), m);
    mesh.scale.y = 0.3;
    group.add(mesh);
    // Every third blob rides a V-arm instead of the centre churn.
    const arm = i % 3 === 0 ? (i % 2 === 0 ? 1 : -1) : 0;
    wakes.push({
      mesh,
      age: (i / WAKE_COUNT) * 0.9,
      lifetime: 0.9 + Math.random() * 0.4,
      side: Math.random() * 2 - 1,
      arm,
    });
  }

  let facing = 0;
  let bob = 0;
  let roll = 0;

  motor.start();

  return {
    group,
    update(dt, input) {
      const mag = Math.hypot(input.x, input.y);
      const isMoving = mag > 0.05;
      let turnDelta = 0;
      if (isMoving) {
        const speed = SPEED * dt;
        group.position.x += input.x * speed;
        group.position.z += input.y * speed;
        const targetYaw = Math.atan2(input.x, input.y);
        let delta = targetYaw - facing;
        while (delta > Math.PI) delta -= Math.PI * 2;
        while (delta < -Math.PI) delta += Math.PI * 2;
        turnDelta = delta;
        facing += delta * TURN_LERP;
        bob += dt * 8;
      } else {
        bob += dt * 3.5;
      }
      // Gentle bob on top of whatever the biome's wave terrain adds.
      const bobAmt = isMoving ? 0.05 : 0.03;
      group.position.y = Math.abs(Math.sin(bob)) * bobAmt;
      // Lean into turns like a boat heeling over. The engine owns
      // group.quaternion (yaw + terrain tilt), so bank the HULL pieces
      // via a slight z-rotation on the whole visible stack — cheap:
      // rotate children through a shared roll applied on the group's
      // own child transforms is overkill; a subtle scale-free roll on
      // the hull mesh alone sells it.
      const targetRoll = THREE.MathUtils.clamp(-turnDelta * 1.6, -0.3, 0.3);
      roll += (targetRoll - roll) * 0.1;
      hull.rotation.z = roll;
      cabin.rotation.z = roll * 0.7;
      // Motor putt tracks throttle.
      motor.setActivity(mag);
      // Steam puffs — rise from the stack, drift back a little.
      const steamRate = 0.8 + mag * 1.2;
      for (const p of steams) {
        p.age += dt * steamRate;
        if (p.age >= p.lifetime) {
          p.age -= p.lifetime;
          p.lifetime = 0.9 + Math.random() * 0.5;
          p.jitter = Math.random() * Math.PI * 2;
        }
        const t = Math.min(1, p.age / p.lifetime);
        p.mesh.position.set(
          steamOrigin.x + Math.sin(p.jitter + t * 5) * 0.05,
          steamOrigin.y + t * 0.7,
          steamOrigin.z - t * (0.2 + mag * 0.4),
        );
        p.mesh.scale.setScalar(0.5 + t * 1.4);
        const fadeIn = Math.min(1, t / 0.15);
        const fadeOut = Math.max(0, 1 - (t - 0.15) / 0.85);
        (p.mesh.material as THREE.MeshBasicMaterial).opacity = (0.12 + mag * 0.1) * fadeIn * fadeOut;
      }
      // Wake foam — flat white blobs sliding back from the stern,
      // spreading sideways as they age. Only really visible under way.
      const wakeRate = 0.5 + mag * 1.8;
      for (const w of wakes) {
        w.age += dt * wakeRate;
        if (w.age >= w.lifetime) {
          w.age -= w.lifetime;
          w.lifetime = 0.8 + Math.random() * 0.45;
          w.side = Math.random() * 2 - 1;
        }
        const t = Math.min(1, w.age / w.lifetime);
        if (w.arm === 0) {
          // Centre churn — spreads into a widening fan behind the stern.
          w.mesh.position.set(
            wakeOrigin.x + w.side * t * 1.0,
            wakeOrigin.y,
            wakeOrigin.z - t * (0.6 + mag * 2.2),
          );
          w.mesh.scale.set(0.7 + t * 2.4, 0.3, 0.7 + t * 1.8);
        } else {
          // V-arms — peel diagonally off the bow sides.
          w.mesh.position.set(
            w.arm * (0.7 + t * 1.7),
            wakeOrigin.y,
            0.9 - t * (2.0 + mag * 1.6),
          );
          w.mesh.scale.set(0.5 + t * 1.4, 0.25, 0.5 + t * 1.1);
        }
        const fadeIn = Math.min(1, t / 0.1);
        const fadeOut = Math.max(0, 1 - (t - 0.1) / 0.9);
        (w.mesh.material as THREE.MeshBasicMaterial).opacity =
          (0.06 + mag * 0.5) * fadeIn * fadeOut;
      }
    },
    position() {
      return group.position;
    },
    facing() {
      return facing;
    },
    dispose() {
      motor.stop();
    },
  };
}
