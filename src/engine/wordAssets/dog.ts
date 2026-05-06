import type { CreatureGeometry, WordAsset } from "./types";
import { buildCreature } from "./creature";

// Hand-tuned default dog. Slightly stockier than the cat, with a
// broader snout, floppy ears, and a relaxed (uncurled) tail with no
// fluff. Same shared factory — only the parameters differ.
export const DOG_DEFAULTS: CreatureGeometry = {
  scale: 1,

  // Stockier, more dog-like proportions. Body ~2.6× as long as it is
  // thick, vs. the previous ~3.9× sausage. Head pulled in close so
  // the silhouette reads as one connected shape.
  bodyLength: 0.85,
  bodyRadius: 0.33,
  bodyHeight: 0.55,
  bodyColorR: 0.78,
  bodyColorG: 0.55,
  bodyColorB: 0.32,
  bellyColorR: 0.96,
  bellyColorG: 0.85,
  bellyColorB: 0.62,

  headRadius: 0.34,
  headForward: 0.04,
  headHeight: 0.06,

  // Smaller, lower snout so the head still reads as a head rather
  // than a giant white cone with a nose stuck on it.
  snoutRadius: 0.12,
  snoutForward: 0.28,
  snoutDrop: -0.1,
  snoutScaleZ: 0.95,

  // Floppy ears anchor at the *top* of the head, slightly forward,
  // so when they hang they fall alongside the cheeks. earFloppy=1
  // pulls the cone almost horizontal via the new 1.5 rad lerp.
  earSize: 0.24,
  earSpread: 0.16,
  earForward: 0.02,
  earUp: 0.18,
  earTilt: 0.05,
  earFloppy: 1,

  // Eyes nudged outward (more eyeSpread) and back from the snout so
  // they sit on the visible curve of the head instead of getting
  // tucked inside the sphere or hidden behind the muzzle.
  eyeRadius: 0.07,
  eyeForward: 0.12,
  eyeSpread: 0.2,
  eyeUp: 0.1,
  pupilRadius: 0.04,

  legLength: 0.38,
  legRadius: 0.07,
  legSpread: 0.18,

  // Tail curls up slightly — typical happy-dog pose. Wags faster than
  // a cat's idle lash.
  tailLength: 0.34,
  tailRadius: 0.05,
  tailCurl: 0.4,
  tailFluff: 0,

  whiskerLength: 0,

  walkSpeed: 1,
  tailWagSpeed: 1.8,
  blinkInterval: 3.6,

  voice: "bark",
};

export const dogWordAsset: WordAsset = {
  word: "DOG",
  defaults: DOG_DEFAULTS,
  build: buildCreature,
};
