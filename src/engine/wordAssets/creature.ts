import * as THREE from "three";
import type { CreatureGeometry, WordAssetHandles } from "./types";

// Shared low-poly quadruped factory used by every word asset that's
// some kind of animal (cat, dog today; a fish or pig later might
// override). Geometry is fully data-driven so the WordAssetEditor can
// reshape the creature without touching code.
//
// The animation is deliberately simple:
//   • Phase 1 (entry) — creature walks in from a small offset behind
//     the camera-facing direction, body bobbing, legs alternating.
//   • Phase 2 (settle) — short ease into a sit; tail starts wagging.
//   • Phase 3 (idle)   — sits forever, tail wag + occasional blink.
// Total entry duration is exposed so SpellWord can fire the voice
// line and any audio-reveal at the right moment.

const ENTRY_WALK_S = 1.4;
const ENTRY_SETTLE_S = 0.5;
const ENTRY_TOTAL_S = ENTRY_WALK_S + ENTRY_SETTLE_S;
const ENTRY_DISTANCE = 2.4; // how far the creature trots from the spawn point

export function buildCreature(g: CreatureGeometry): WordAssetHandles {
  const root = new THREE.Group();
  root.name = "WordAssetRoot";
  // walker carries the entry-walk translation (along its local +X).
  // Putting it between root and inner lets callers rotate the whole
  // creature by setting root.rotation.y without warping the walk
  // direction — the walk always plays out along the creature's
  // local "forward" axis.
  const walker = new THREE.Group();
  root.add(walker);
  // Inner group carries the per-creature scale so the entry-walk
  // translation in `walker` doesn't get scaled with it.
  const inner = new THREE.Group();
  inner.scale.setScalar(g.scale);
  walker.add(inner);

  const bodyColor = new THREE.Color(g.bodyColorR, g.bodyColorG, g.bodyColorB);
  const bellyColor = new THREE.Color(g.bellyColorR, g.bellyColorG, g.bellyColorB);
  const bodyMat = new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.55 });
  const bellyMat = new THREE.MeshStandardMaterial({ color: bellyColor, roughness: 0.55 });

  // ── Body — horizontal capsule along +X. Cylinder + two end-caps.
  const bodyCenterY = g.bodyHeight;
  const bodyCyl = new THREE.Mesh(
    new THREE.CylinderGeometry(g.bodyRadius, g.bodyRadius, g.bodyLength, 16),
    bodyMat,
  );
  bodyCyl.rotation.z = Math.PI / 2; // lay it on its side, length along X
  bodyCyl.position.y = bodyCenterY;
  bodyCyl.castShadow = true;
  bodyCyl.receiveShadow = true;
  inner.add(bodyCyl);
  for (const sign of [-1, 1] as const) {
    const cap = new THREE.Mesh(
      new THREE.SphereGeometry(g.bodyRadius, 14, 12),
      bodyMat,
    );
    cap.position.set((g.bodyLength / 2) * sign, bodyCenterY, 0);
    cap.castShadow = true;
    inner.add(cap);
  }

  // Belly — slightly lighter colour, smaller cylinder under the body.
  const bellyCyl = new THREE.Mesh(
    new THREE.CylinderGeometry(g.bodyRadius * 0.78, g.bodyRadius * 0.78, g.bodyLength * 0.85, 14),
    bellyMat,
  );
  bellyCyl.rotation.z = Math.PI / 2;
  bellyCyl.position.set(0, bodyCenterY - g.bodyRadius * 0.45, 0);
  bellyCyl.scale.set(1, 0.5, 1);
  inner.add(bellyCyl);

  // ── Head ──────────────────────────────────────────────────────────
  const headX = g.bodyLength / 2 + g.headForward;
  const headY = bodyCenterY + g.headHeight;
  const head = new THREE.Mesh(new THREE.SphereGeometry(g.headRadius, 18, 14), bodyMat);
  head.position.set(headX, headY, 0);
  head.castShadow = true;
  inner.add(head);

  // Snout
  if (g.snoutRadius > 0.02) {
    const snout = new THREE.Mesh(new THREE.SphereGeometry(g.snoutRadius, 14, 10), bellyMat);
    snout.scale.set(1, 1, g.snoutScaleZ);
    snout.position.set(headX + g.snoutForward, headY + g.snoutDrop, 0);
    inner.add(snout);

    // Nose — small black blob on the very front of the snout.
    const noseMat = new THREE.MeshStandardMaterial({ color: 0x1a1414, roughness: 0.5 });
    const nose = new THREE.Mesh(new THREE.SphereGeometry(g.snoutRadius * 0.42, 10, 8), noseMat);
    nose.position.set(headX + g.snoutForward + g.snoutRadius * 0.7, headY + g.snoutDrop + g.snoutRadius * 0.05, 0);
    inner.add(nose);
  }

  // ── Ears ──────────────────────────────────────────────────────────
  const earMat = new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.55 });
  const earInsideMat = new THREE.MeshStandardMaterial({ color: 0xffb0b8, roughness: 0.6 });
  const earPivotsForAnim: THREE.Group[] = [];
  for (const sign of [-1, 1] as const) {
    const pivot = new THREE.Group();
    pivot.position.set(headX + g.earForward, headY + g.earUp, sign * g.earSpread);
    pivot.rotation.z = sign * g.earTilt;
    // Floppy adds an X-axis droop interpolated against the upright
    // pose. 0 = perky triangle pointing straight up; 1 = ear hangs
    // ~85° outward, almost horizontal — like a beagle / lab. The
    // larger range (1.5 rad ≈ 86°) is needed for the ear to read as
    // "floppy" rather than just "tilted".
    pivot.rotation.x = THREE.MathUtils.lerp(0, sign * 1.5, g.earFloppy);
    inner.add(pivot);
    earPivotsForAnim.push(pivot);
    // Ear shape: cone for triangle ears, longer flatter cone for floppy.
    const earHeight = g.earSize * THREE.MathUtils.lerp(1, 1.6, g.earFloppy);
    const earCone = new THREE.Mesh(
      new THREE.ConeGeometry(g.earSize * 0.6, earHeight, 6, 1, true),
      earMat,
    );
    earCone.position.y = earHeight * 0.5;
    // Floppy ears flatten on Z so they read as a fin / flap rather
    // than a cone. Cat-style triangle ears keep their full thickness.
    const flatten = THREE.MathUtils.lerp(1, 0.35, g.earFloppy);
    earCone.scale.set(1, 1, flatten);
    earCone.castShadow = true;
    pivot.add(earCone);
    // Inside ear — slightly smaller pink cone, pulled forward.
    const earInside = new THREE.Mesh(
      new THREE.ConeGeometry(g.earSize * 0.42, earHeight * 0.85, 6, 1, true),
      earInsideMat,
    );
    earInside.position.set(g.earSize * 0.05, earHeight * 0.45, 0);
    earInside.scale.set(1, 1, flatten);
    pivot.add(earInside);
  }

  // ── Eyes ──────────────────────────────────────────────────────────
  const eyeWhiteMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 });
  const pupilMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.4 });
  const shineMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const eyes: THREE.Mesh[] = [];
  for (const sign of [-1, 1] as const) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(g.eyeRadius, 14, 10), eyeWhiteMat);
    eye.position.set(headX + g.eyeForward, headY + g.eyeUp, sign * g.eyeSpread);
    inner.add(eye);
    eyes.push(eye);
    if (g.pupilRadius > 0.005) {
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(g.pupilRadius, 10, 8), pupilMat);
      pupil.position.set(eye.position.x + g.eyeRadius * 0.4, eye.position.y, eye.position.z);
      inner.add(pupil);
      // Tiny shine highlight, top-left of the pupil for that "alive" look.
      const shine = new THREE.Mesh(new THREE.SphereGeometry(g.pupilRadius * 0.35, 6, 6), shineMat);
      shine.position.set(eye.position.x + g.eyeRadius * 0.55, eye.position.y + g.pupilRadius * 0.35, eye.position.z + (sign * g.eyeRadius * 0.18));
      inner.add(shine);
    }
  }

  // ── Whiskers ──────────────────────────────────────────────────────
  if (g.whiskerLength > 0.005 && g.snoutRadius > 0.02) {
    const whiskerMat = new THREE.LineBasicMaterial({ color: 0xefe7d8, transparent: true, opacity: 0.85 });
    const baseX = headX + g.snoutForward + g.snoutRadius * 0.4;
    const baseY = headY + g.snoutDrop;
    for (const sideSign of [-1, 1] as const) {
      for (const tilt of [-0.18, 0, 0.18]) {
        const startZ = sideSign * (g.snoutRadius * 0.5);
        const endZ = startZ + sideSign * g.whiskerLength;
        const startY = baseY + tilt * 0.05;
        const endY = baseY + tilt * 0.18;
        const geo = new THREE.BufferGeometry();
        geo.setAttribute(
          "position",
          new THREE.Float32BufferAttribute([baseX, startY, startZ, baseX + g.whiskerLength * 0.3, endY, endZ], 3),
        );
        const line = new THREE.Line(geo, whiskerMat);
        inner.add(line);
      }
    }
  }

  // ── Legs ──────────────────────────────────────────────────────────
  const legMat = new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.55 });
  // 0/1 = front-left/right; 2/3 = back-left/right.
  const legPivots: THREE.Group[] = [];
  const legBaseY = bodyCenterY - g.bodyRadius * 0.7;
  for (let i = 0; i < 4; i++) {
    const isFront = i < 2;
    const isLeft = i % 2 === 0;
    const xOffset = (isFront ? 1 : -1) * g.bodyLength * 0.32;
    const zOffset = (isLeft ? -1 : 1) * g.legSpread;
    const pivot = new THREE.Group();
    pivot.position.set(xOffset, legBaseY, zOffset);
    inner.add(pivot);
    legPivots.push(pivot);
    const legGeo = new THREE.CylinderGeometry(g.legRadius, g.legRadius * 0.92, g.legLength, 10);
    const leg = new THREE.Mesh(legGeo, legMat);
    leg.position.y = -g.legLength / 2;
    leg.castShadow = true;
    pivot.add(leg);
    // Foot pad — small dark sphere at the bottom.
    const padMat = new THREE.MeshStandardMaterial({ color: 0x2c1f17, roughness: 0.7 });
    const pad = new THREE.Mesh(new THREE.SphereGeometry(g.legRadius * 1.05, 8, 6), padMat);
    pad.position.y = -g.legLength;
    pad.scale.set(1, 0.5, 1);
    pivot.add(pad);
  }

  // ── Tail ──────────────────────────────────────────────────────────
  const tailPivot = new THREE.Group();
  tailPivot.position.set(-g.bodyLength / 2 - g.bodyRadius * 0.2, bodyCenterY + g.bodyRadius * 0.2, 0);
  // Curl rotates around Z (up/down). Positive = curled over back.
  tailPivot.rotation.z = g.tailCurl * 0.9;
  inner.add(tailPivot);
  const tailMat = new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.55 });
  const tail = new THREE.Mesh(
    new THREE.CylinderGeometry(g.tailRadius * 0.4, g.tailRadius, g.tailLength, 8),
    tailMat,
  );
  // Cylinder is built along Y; rotate -Z so its axis points -X (rear).
  tail.rotation.z = -Math.PI / 2;
  tail.position.x = -g.tailLength / 2;
  tail.castShadow = true;
  tailPivot.add(tail);
  if (g.tailFluff > 0.01) {
    const fluff = new THREE.Mesh(new THREE.SphereGeometry(g.tailFluff, 10, 8), tailMat);
    fluff.position.x = -g.tailLength;
    tailPivot.add(fluff);
  }

  // ── Animation state ───────────────────────────────────────────────
  let entryT = 0;
  let blinkPhaseStart = 0.5 + Math.random() * 1.5;
  let blinkInflightK = -1;
  let lastVoiceFiredAt = -1;
  // Walk direction is +X (the creature's "forward"). Start the walker
  // pulled back along -X so the entry animation can ease it forward
  // to local 0. External callers can rotate `root` freely without
  // affecting which way the creature walks relative to itself.
  walker.position.x = -ENTRY_DISTANCE;

  const eyeBaseScaleY = 1;

  const handles: WordAssetHandles = {
    group: root,
    entryDurationS: ENTRY_TOTAL_S,
    triggerVoice() {
      lastVoiceFiredAt = entryT; // arms playSfx on next tick
      playVoice(g.voice);
    },
    tick(dt) {
      entryT += dt;

      // ── Entry walk ─────────────────────────────────────────────
      const walkK = Math.min(1, entryT / ENTRY_WALK_S);
      // Ease-out cubic so it settles smoothly into place.
      const easedK = 1 - Math.pow(1 - walkK, 3);
      walker.position.x = -ENTRY_DISTANCE * (1 - easedK);

      // Body bob during the walk; calm settle during phase 2; near-still
      // during idle (just tail + ear twitches).
      const inSettle = entryT > ENTRY_WALK_S && entryT < ENTRY_TOTAL_S;
      const inIdle = entryT >= ENTRY_TOTAL_S;
      const stride = inIdle ? 0 : Math.sin(entryT * Math.PI * 8) * (1 - walkK * 0.3);

      // Body bob — abs sin so it doesn't sink below feet.
      const bodyBob = inIdle ? 0 : Math.abs(Math.sin(entryT * Math.PI * 8)) * 0.04 * (1 - walkK * 0.5);
      inner.position.y = bodyBob;

      // Leg swing — front-left & back-right move together; the other
      // diagonal pair moves opposite, classic quadruped trot.
      const legSwing = stride * 0.6;
      legPivots[0].rotation.z = legSwing;          // FL
      legPivots[3].rotation.z = legSwing;          // BR
      legPivots[1].rotation.z = -legSwing;         // FR
      legPivots[2].rotation.z = -legSwing;         // BL

      // ── Settle ─────────────────────────────────────────────────
      // Once the walk is done, ease the body slightly down (sit) and
      // park the legs neutral.
      if (inSettle) {
        const sk = (entryT - ENTRY_WALK_S) / ENTRY_SETTLE_S;
        inner.position.y = -sk * 0.08;
        for (const lp of legPivots) lp.rotation.z *= 1 - sk;
      } else if (inIdle) {
        inner.position.y = -0.08;
        for (const lp of legPivots) lp.rotation.z = 0;
      }

      // ── Idle: tail wag, ear twitch, blink, voice cue ───────────
      if (inIdle) {
        // Tail wags around its curled-rest pose by rotating Y.
        tailPivot.rotation.y = Math.sin(entryT * g.tailWagSpeed * Math.PI * 2) * 0.7;
        // Ear twitches — very small; ears tilt up/down by ±0.05 rad.
        const earTwitch = Math.sin(entryT * 1.3) * 0.04;
        for (const ep of earPivotsForAnim) ep.rotation.x += (earTwitch - ep.rotation.x) * 0.05;

        // Blinking. blinkPhaseStart is the next blink trigger time;
        // when entryT crosses it, we run a 0.18s close-and-open and
        // schedule the next blink.
        if (blinkInflightK < 0 && entryT >= blinkPhaseStart) {
          blinkInflightK = 0;
        }
        if (blinkInflightK >= 0) {
          blinkInflightK += dt / 0.18;
          // Close-then-open envelope: sin(0..π) hits 1 at midpoint.
          const env = Math.max(0, Math.sin(Math.min(1, blinkInflightK) * Math.PI));
          const sy = 1 - env * 0.95;
          for (const eye of eyes) eye.scale.y = sy;
          if (blinkInflightK >= 1) {
            blinkInflightK = -1;
            for (const eye of eyes) eye.scale.y = eyeBaseScaleY;
            const jitter = (Math.random() - 0.5) * 0.5;
            blinkPhaseStart = entryT + Math.max(1.5, g.blinkInterval * (1 + jitter));
          }
        }

        // Fire the voice line exactly once, the moment we cross into idle.
        if (lastVoiceFiredAt < 0) {
          lastVoiceFiredAt = entryT;
          playVoice(g.voice);
        }
      }
    },
    dispose() {
      root.traverse((obj) => {
        const m = obj as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        const mat = m.material;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else if (mat) (mat as THREE.Material).dispose();
      });
    },
  };

  return handles;
}

// ── Voice / SFX ────────────────────────────────────────────────────
// Tiny synthetic SFX so we don't depend on new ElevenLabs clips just
// for a meow / bark. WebAudio only — uses the existing audio player's
// context indirectly (via a fresh OscillatorNode sequence).
function playVoice(kind: "meow" | "bark" | "none"): void {
  if (kind === "none") return;
  if (typeof window === "undefined") return;
  let ctx: AudioContext | null = null;
  try {
    const Ctor: typeof AudioContext | undefined =
      window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    ctx = new Ctor();
  } catch {
    return;
  }
  if (!ctx) return;
  const now = ctx.currentTime;
  if (kind === "meow") {
    // Two-note slide: low-up-down, soft envelope.
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(420, now);
    osc.frequency.linearRampToValueAtTime(640, now + 0.18);
    osc.frequency.linearRampToValueAtTime(380, now + 0.55);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.32, now + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.62);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.66);
  } else if (kind === "bark") {
    // Short woof-woof burst: two ~80ms notes.
    for (let i = 0; i < 2; i++) {
      const t = now + i * 0.16;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(220, t);
      osc.frequency.exponentialRampToValueAtTime(110, t + 0.08);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.linearRampToValueAtTime(0.28, t + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.12);
    }
  }
  // Let the context finish before closing.
  setTimeout(() => {
    void ctx?.close();
  }, 1200);
}
