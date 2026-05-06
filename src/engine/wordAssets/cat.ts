import type { CreatureGeometry, WordAsset } from "./types";
import { buildCreature } from "./creature";

// Hand-tuned default cat. Slim body, perky triangle ears, narrow snout,
// curled tail, gentle whiskers. Edit live in the WordAssetEditor; the
// editor saves overrides to localStorage so this default only changes
// when someone "Export → paste back here" bakes them in.
export const CAT_DEFAULTS: CreatureGeometry = {
  scale: 1,

  bodyLength: 0.95,
  bodyRadius: 0.22,
  bodyHeight: 0.5,
  bodyColorR: 0.95,
  bodyColorG: 0.78,
  bodyColorB: 0.45,
  bellyColorR: 1,
  bellyColorG: 0.92,
  bellyColorB: 0.78,

  headRadius: 0.26,
  headForward: 0.12,
  headHeight: 0.05,

  snoutRadius: 0.1,
  snoutForward: 0.18,
  snoutDrop: -0.05,
  snoutScaleZ: 0.85,

  earSize: 0.18,
  earSpread: 0.14,
  earForward: -0.05,
  earUp: 0.18,
  earTilt: 0.18,
  earFloppy: 0,

  eyeRadius: 0.05,
  eyeForward: 0.16,
  eyeSpread: 0.11,
  eyeUp: 0.08,
  pupilRadius: 0.025,

  legLength: 0.32,
  legRadius: 0.06,
  legSpread: 0.13,

  tailLength: 0.55,
  tailRadius: 0.05,
  tailCurl: 0.55,
  tailFluff: 0.07,

  whiskerLength: 0.16,

  walkSpeed: 1,
  tailWagSpeed: 0.9,
  blinkInterval: 3.2,

  voice: "meow",
};

export const catWordAsset: WordAsset = {
  word: "CAT",
  defaults: CAT_DEFAULTS,
  build: buildCreature,
};
