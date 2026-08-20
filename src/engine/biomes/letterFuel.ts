import * as THREE from "three";
import { loadFont, makeLetterShape } from "../letters";
import type { Font } from "three/examples/jsm/loaders/FontLoader.js";

// Letters as fuel.
//
// The ocean is full of things worth doing that have nothing to do with
// the alphabet — a volcano that fires you into the sky, a waterspout
// that hauls you off the water and throws you at Jupiter. Left alone
// they are free, which means a kid can spend a whole session riding
// them and never touch a letter, and the spectacle ends up competing
// with the thing the game is for.
//
// So the rides run on letters. Every letter picked up flies to the
// volcano and joins a ring of them turning over the crater; the
// mountain glows hotter with each one. A charged volcano throws you
// clear of the world; an empty one still fires you into the air,
// because the ride has to be worth taking either way — a four-year-old
// who is told "no" by a mountain stops going to the mountain.
//
// Nothing here says any of that out loud. The letter flies to the
// volcano in front of you, the volcano gets brighter, and the next
// eruption is the big one.

export const FUEL_FULL = 3;

export type LetterFuel = {
  group: THREE.Group;
  // Take a letter, from wherever it was picked up. It flies there.
  bank: (letter: string, from: THREE.Vector3 | null) => void;
  // Burn what's in the tank. The ring dives into the crater.
  spend: () => void;
  charged: () => boolean;
  // 0 to 1, for anything that wants to glow in step with it.
  amount: () => number;
  count: () => number;
  // `viewer` is where the eye is, so the glyphs can turn to face it.
  tick: (dt: number, t: number, viewer?: THREE.Vector3) => void;
  dispose: () => void;
  // One letter landed. `step` is how many are in the tank now.
  onBanked?: (step: number, full: number) => void;
  // The tank just filled.
  onFull?: () => void;
};

// A glyph in flight, in the ring, or on its way into the crater.
type Ember = {
  obj: THREE.Object3D;
  slot: number;
  // "flying" from the pickup, "orbit" once it arrives, "spent" going in.
  phase: "flying" | "orbit" | "spent";
  t: number;
  from: THREE.Vector3;
  // Which way it leans on the way over, so two letters banked in the
  // same place don't trace the same line.
  bow: number;
  dispose: () => void;
};

export function makeLetterFuel(opts: {
  // The crater the ring turns over.
  at: { x: number; y: number; z: number };
  radius: number;
}): LetterFuel {
  const { at, radius } = opts;
  const group = new THREE.Group();
  group.position.set(at.x, at.y, at.z);
  // The ring hangs over the crater, so it must not be culled when the
  // mountain itself is off screen — you are usually looking at it from
  // across the water.
  group.frustumCulled = false;

  // Hot, and lit from inside: these are sitting over a volcano, and
  // they have to read against a bright sky from a long way off.
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffd27a,
    emissive: 0xff9c30,
    emissiveIntensity: 1.4,
    roughness: 0.45,
  });

  let font: Font | null = null;
  const waiting: Array<{ letter: string; from: THREE.Vector3 | null }> = [];
  const embers: Ember[] = [];
  let disposed = false;

  loadFont().then((f) => {
    if (disposed) return;
    font = f;
    for (const w of waiting) add(w.letter, w.from);
    waiting.length = 0;
  });

  const FLY_SECONDS = 1.15;
  const SPEND_SECONDS = 0.55;
  // Low and tight, so the ring reads as sitting on the crater rather
  // than hovering somewhere over the island.
  const HEIGHT = 2.2;

  function add(letter: string, from: THREE.Vector3 | null) {
    if (!font) return;
    const shape = makeLetterShape(font, letter, mat);
    const holder = new THREE.Group();
    // A glyph comes back baseline-at-zero and centred across; scale it
    // to a constant height so a W and an I are the same size in the
    // ring, which is not true of their own dimensions.
    const s = 1.55 / Math.max(0.001, shape.height);
    shape.object.scale.setScalar(s);
    shape.object.position.y = (-shape.height * s) / 2;
    holder.add(shape.object);
    holder.frustumCulled = false;
    group.add(holder);
    const slot = embers.length;
    const start = new THREE.Vector3();
    if (from) start.copy(from).sub(group.position);
    else start.set(0, HEIGHT, 0);
    embers.push({
      obj: holder,
      slot,
      phase: from ? "flying" : "orbit",
      t: 0,
      from: start,
      // Alternating, so a run of pickups from the same spot fans out.
      bow: slot % 2 === 0 ? 1 : -1,
      dispose: shape.dispose,
    });
  }

  // Where slot `i` of `n` sits in the ring at time `t`.
  const slotAt = (i: number, n: number, t: number, out: THREE.Vector3) => {
    const a = (i / Math.max(1, n)) * Math.PI * 2 + t * 0.55;
    out.set(
      Math.cos(a) * radius,
      HEIGHT + Math.sin(t * 1.3 + i * 1.7) * 0.35,
      Math.sin(a) * radius
    );
    return out;
  };

  const tmp = new THREE.Vector3();
  const world: LetterFuel = {
    group,
    bank(letter, from) {
      if (embers.length + waiting.length >= FUEL_FULL) return;
      if (font) add(letter, from);
      else waiting.push({ letter, from: from ? from.clone() : null });
      const n = embers.length + waiting.length;
      world.onBanked?.(n, FUEL_FULL);
      if (n >= FUEL_FULL) world.onFull?.();
    },
    spend() {
      for (const e of embers) {
        if (e.phase === "spent") continue;
        e.phase = "spent";
        e.t = 0;
        e.from.copy(e.obj.position);
      }
    },
    charged: () => embers.filter((e) => e.phase !== "spent").length >= FUEL_FULL,
    amount: () =>
      Math.min(1, embers.filter((e) => e.phase !== "spent").length / FUEL_FULL),
    count: () => embers.filter((e) => e.phase !== "spent").length,
    tick(dt, t, viewer) {
      const live = embers.filter((e) => e.phase !== "spent").length;
      // Which way to turn so a glyph faces the eye. Letters that face
      // outward from the ring are edge-on for half of every lap, and a
      // letter you cannot read is not teaching anybody anything.
      const facing =
        viewer ?
          Math.atan2(viewer.x - group.position.x, viewer.z - group.position.z)
        : 0;
      for (let i = embers.length - 1; i >= 0; i--) {
        const e = embers[i];
        e.t += dt;
        if (e.phase === "spent") {
          // Down the throat, shrinking as it goes.
          const k = Math.min(1, e.t / SPEND_SECONDS);
          e.obj.position.copy(e.from).lerp(tmp.set(0, -1.5, 0), k * k);
          e.obj.scale.setScalar(Math.max(0.001, 1 - k));
          e.obj.rotation.y += dt * 9;
          if (k >= 1) {
            group.remove(e.obj);
            e.dispose();
            embers.splice(i, 1);
            // Slots close up behind it.
            embers.forEach((rest, j) => (rest.slot = j));
          }
          continue;
        }
        slotAt(e.slot, live, t, tmp);
        if (e.phase === "flying") {
          const k = Math.min(1, e.t / FLY_SECONDS);
          // Eased, and thrown wide of the straight line, so it arcs
          // across the water rather than sliding along a ruler.
          const g = k * k * (3 - 2 * k);
          e.obj.position.lerpVectors(e.from, tmp, g);
          e.obj.position.y += Math.sin(g * Math.PI) * 9;
          e.obj.position.x += Math.sin(g * Math.PI) * e.bow * 5;
          e.obj.rotation.y = facing + (1 - g) * Math.PI * 4;
          e.obj.scale.setScalar(0.4 + 0.6 * g);
          if (k >= 1) e.phase = "orbit";
          continue;
        }
        e.obj.position.copy(tmp);
        e.obj.rotation.y = facing;
        e.obj.scale.setScalar(1);
      }
    },
    dispose() {
      disposed = true;
      for (const e of embers) e.dispose();
      embers.length = 0;
      mat.dispose();
    },
  };
  return world;
}
