import * as THREE from "three";

// Word-asset = the optional 3D payoff that appears when a kid finishes
// spelling a word in SpellWord. CAT trots up and meows, DOG trots up
// and barks, etc. Words without an asset fall back to the existing
// audio reveal — the asset is purely a visual reward.

// Every asset today is a quadruped (cat, dog) so they share the same
// geometry shape. New asset types (a sun, a bus, a fish) would each
// add their own shape; the WordAsset factory is what couples a word
// to a geometry+factory pair.

export type CreatureGeometry = {
  // Overall scale multiplier on the whole creature. Lets the editor
  // resize the asset without touching every individual field.
  scale: number;

  // Body — capsule built from a cylinder + two caps. Length is along
  // the creature's local +X axis (head forward).
  bodyLength: number;
  bodyRadius: number;
  bodyHeight: number; // Y offset of the body's centre off the ground.
  bodyColorR: number;
  bodyColorG: number;
  bodyColorB: number;
  bellyColorR: number;
  bellyColorG: number;
  bellyColorB: number;

  // Head — sphere placed forward of the body.
  headRadius: number;
  headForward: number; // +X offset from body front
  headHeight: number;  // additional Y offset above body centre

  // Snout — flatter sphere on the front of the head.
  snoutRadius: number;
  snoutForward: number; // +X offset from head centre
  snoutDrop: number;    // Y offset below head centre (negative = lower)
  snoutScaleZ: number;  // narrows the snout for cats vs broader for dogs

  // Ears — pair, mirrored on Z. Two styles: triangle (cat) or floppy
  // (dog) controlled by `earFloppy` (0 = upright triangle, 1 = floppy).
  earSize: number;
  earSpread: number;    // Z offset from head midline
  earForward: number;   // X offset (positive = ears slightly forward)
  earUp: number;        // Y offset above head
  earTilt: number;      // outward tilt in radians
  earFloppy: number;    // 0..1 lerp between triangle and droopy

  // Eyes — pair on the head front.
  eyeRadius: number;
  eyeForward: number; // X offset from head centre toward snout
  eyeSpread: number;  // Z offset from head midline
  eyeUp: number;      // Y offset above head centre
  pupilRadius: number;

  // Legs — four cylinders. Front legs at +bodyLength/2, back legs at
  // -bodyLength/2; spread on Z.
  legLength: number;
  legRadius: number;
  legSpread: number; // Z offset of left/right legs from centre

  // Tail — a thin cylinder behind the body. `tailCurl` rolls it up
  // (positive = curled over the back like a husky); `tailFluff` adds
  // a small puff at the tip.
  tailLength: number;
  tailRadius: number;
  tailCurl: number;  // -1..1
  tailFluff: number; // 0..0.4

  // Whiskers — three little white lines per side of the snout.
  // Disable by setting to 0.
  whiskerLength: number;

  // Animation tuning.
  walkSpeed: number;     // body forward speed during the trot-in
  tailWagSpeed: number;  // wag oscillations per second when idle
  blinkInterval: number; // seconds between blinks (random ±25% jitter)

  // Voice line — fired once when the creature finishes its entry
  // animation. "meow" / "bark" today; future words use whatever fits.
  // Plain SFX; not driven by the elevenlabs voice clips.
  voice: "meow" | "bark" | "none";
};

export type WordAssetHandles = {
  group: THREE.Group;
  // Per-frame update. Returns the duration (seconds) of the entry
  // animation so callers can schedule any side-effects after it lands.
  // Subsequent frames keep the creature idle.
  tick: (dt: number, t: number) => void;
  // Manually trigger the voice line (used by the editor preview).
  triggerVoice: () => void;
  // Tear down geometry / materials.
  dispose: () => void;
  // How long the trot-in animation runs. Caller (SpellWord) uses
  // this to decide when to show the Next-Word button without
  // stepping on the animation.
  entryDurationS: number;
};

export type WordAsset = {
  // Display word — uppercase canonical (CAT, DOG). SpellWord matches
  // against `word.word.toUpperCase()`.
  word: string;
  // Default geometry — used when no localStorage override exists.
  defaults: CreatureGeometry;
  // Builder that produces a renderable creature. The geometry is
  // resolved (defaults merged with any localStorage override) by the
  // caller; this function just consumes it.
  build: (geometry: CreatureGeometry) => WordAssetHandles;
};
