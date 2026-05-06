import { catWordAsset } from "./cat";
import { dogWordAsset } from "./dog";
import type { CreatureGeometry, WordAsset, WordAssetHandles } from "./types";

export type { CreatureGeometry, WordAsset, WordAssetHandles };

// Registry of every word that has an associated 3D payoff. Words not
// in this registry fall through SpellWord's existing audio-only flow
// — adding a new payoff is just a matter of adding an entry here.
export const WORD_ASSETS: Record<string, WordAsset> = {
  CAT: catWordAsset,
  DOG: dogWordAsset,
};

// Slider metadata — drives the WordAssetEditor's UI. Each entry is
// { label, min, max, step }. Anything authored as a `0..1` channel
// (color components) gets a step of 0.005 so colour transitions are
// smooth in the preview. Position fields use 0.005 too because the
// creature is small.
export type CreatureFieldMeta = {
  label: string;
  min: number;
  max: number;
  step: number;
};

export const CREATURE_FIELD_META: Record<keyof CreatureGeometry, CreatureFieldMeta> = {
  scale: { label: "Overall scale", min: 0.4, max: 2.5, step: 0.01 },

  bodyLength: { label: "Body length", min: 0.4, max: 2, step: 0.01 },
  bodyRadius: { label: "Body radius", min: 0.08, max: 0.6, step: 0.005 },
  bodyHeight: { label: "Body Y", min: 0.1, max: 1.5, step: 0.005 },
  bodyColorR: { label: "Body R", min: 0, max: 1, step: 0.005 },
  bodyColorG: { label: "Body G", min: 0, max: 1, step: 0.005 },
  bodyColorB: { label: "Body B", min: 0, max: 1, step: 0.005 },
  bellyColorR: { label: "Belly R", min: 0, max: 1, step: 0.005 },
  bellyColorG: { label: "Belly G", min: 0, max: 1, step: 0.005 },
  bellyColorB: { label: "Belly B", min: 0, max: 1, step: 0.005 },

  headRadius: { label: "Head radius", min: 0.08, max: 0.6, step: 0.005 },
  headForward: { label: "Head forward", min: -0.2, max: 0.6, step: 0.005 },
  headHeight: { label: "Head height", min: -0.3, max: 0.5, step: 0.005 },

  snoutRadius: { label: "Snout radius", min: 0, max: 0.4, step: 0.005 },
  snoutForward: { label: "Snout forward", min: 0, max: 0.5, step: 0.005 },
  snoutDrop: { label: "Snout drop", min: -0.3, max: 0.2, step: 0.005 },
  snoutScaleZ: { label: "Snout width", min: 0.4, max: 1.6, step: 0.01 },

  earSize: { label: "Ear size", min: 0, max: 0.5, step: 0.005 },
  earSpread: { label: "Ear spread", min: 0, max: 0.4, step: 0.005 },
  earForward: { label: "Ear X", min: -0.3, max: 0.3, step: 0.005 },
  earUp: { label: "Ear up", min: -0.1, max: 0.5, step: 0.005 },
  earTilt: { label: "Ear tilt", min: -1, max: 1, step: 0.01 },
  earFloppy: { label: "Floppy", min: 0, max: 1, step: 0.01 },

  eyeRadius: { label: "Eye radius", min: 0.01, max: 0.18, step: 0.002 },
  eyeForward: { label: "Eye forward", min: 0, max: 0.4, step: 0.005 },
  eyeSpread: { label: "Eye spread", min: 0, max: 0.3, step: 0.005 },
  eyeUp: { label: "Eye up", min: -0.2, max: 0.3, step: 0.005 },
  pupilRadius: { label: "Pupil radius", min: 0, max: 0.08, step: 0.002 },

  legLength: { label: "Leg length", min: 0.05, max: 0.7, step: 0.005 },
  legRadius: { label: "Leg radius", min: 0.02, max: 0.18, step: 0.002 },
  legSpread: { label: "Leg spread", min: 0.05, max: 0.4, step: 0.005 },

  tailLength: { label: "Tail length", min: 0, max: 1, step: 0.005 },
  tailRadius: { label: "Tail radius", min: 0.01, max: 0.15, step: 0.002 },
  tailCurl: { label: "Tail curl", min: -1, max: 1, step: 0.01 },
  tailFluff: { label: "Tail fluff", min: 0, max: 0.4, step: 0.005 },

  whiskerLength: { label: "Whiskers", min: 0, max: 0.4, step: 0.005 },

  walkSpeed: { label: "Walk speed", min: 0.3, max: 2.5, step: 0.05 },
  tailWagSpeed: { label: "Tail wag", min: 0.2, max: 4, step: 0.05 },
  blinkInterval: { label: "Blink (s)", min: 1, max: 8, step: 0.1 },

  // Discrete enum — rendered separately by the editor as a
  // dropdown. Range values are placeholders.
  voice: { label: "Voice", min: 0, max: 0, step: 0 },
};

export const CREATURE_FIELD_GROUPS: Array<{ label: string; fields: (keyof CreatureGeometry)[] }> = [
  { label: "Overall", fields: ["scale", "voice"] },
  {
    label: "Body",
    fields: [
      "bodyLength",
      "bodyRadius",
      "bodyHeight",
      "bodyColorR",
      "bodyColorG",
      "bodyColorB",
      "bellyColorR",
      "bellyColorG",
      "bellyColorB",
    ],
  },
  {
    label: "Head",
    fields: ["headRadius", "headForward", "headHeight", "snoutRadius", "snoutForward", "snoutDrop", "snoutScaleZ"],
  },
  { label: "Ears", fields: ["earSize", "earSpread", "earForward", "earUp", "earTilt", "earFloppy"] },
  { label: "Eyes", fields: ["eyeRadius", "eyeForward", "eyeSpread", "eyeUp", "pupilRadius"] },
  { label: "Legs", fields: ["legLength", "legRadius", "legSpread"] },
  { label: "Tail", fields: ["tailLength", "tailRadius", "tailCurl", "tailFluff"] },
  { label: "Extras", fields: ["whiskerLength"] },
  { label: "Animation", fields: ["walkSpeed", "tailWagSpeed", "blinkInterval"] },
];

// ── Storage ──────────────────────────────────────────────────────────
// Per-word localStorage override merged on top of the bundled
// defaults. Same pattern as letterFixtures / alienConfig: the editor
// writes here on Save; runtime reads on every word-asset spawn.

const STORAGE_PREFIX = "letra:wordAsset:";

export function loadCreatureGeometry(word: string): CreatureGeometry {
  const asset = WORD_ASSETS[word.toUpperCase()];
  if (!asset) throw new Error(`No word asset for ${word}`);
  if (typeof window === "undefined") return asset.defaults;
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + word.toUpperCase());
    if (!raw) return asset.defaults;
    const parsed = JSON.parse(raw) as Partial<CreatureGeometry>;
    return { ...asset.defaults, ...parsed };
  } catch {
    return asset.defaults;
  }
}

export function saveCreatureGeometry(word: string, geom: CreatureGeometry): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_PREFIX + word.toUpperCase(), JSON.stringify(geom));
  } catch {
    /* non-fatal */
  }
}

export function clearCreatureGeometry(word: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_PREFIX + word.toUpperCase());
  } catch {
    /* non-fatal */
  }
}

export function getWordAsset(word: string): WordAsset | null {
  return WORD_ASSETS[word.toUpperCase()] ?? null;
}
