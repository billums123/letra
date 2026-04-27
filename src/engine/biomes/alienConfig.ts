// Tunable geometry parameters for the moon-biome aliens. Keeping
// every dimension in a single flat config object means the editor
// (src/ui/AlienEditor.tsx) can spit out a slider per field without
// hand-mapping prop names. The runtime makeAlien() merges this on
// top of DEFAULT_ALIEN_GEOMETRY before constructing meshes, so a
// kid (or designer) can save an override to localStorage and see
// it reflected next time they enter the moon biome.

export type AlienGeometry = {
  // Soft contact shadow disc on the ground.
  shadowRadius: number;
  shadowOpacity: number;

  // Body — squat egg.
  bodyRadius: number;
  bodyScaleY: number;
  bodyY: number;

  // Lighter belly inset on the front of the body.
  bellyRadius: number;
  bellyY: number;
  bellyZ: number;

  // Big oversized head.
  headRadius: number;
  headY: number;

  // Cheek blushes (mirrored on each side).
  cheekRadius: number;
  cheekX: number;
  cheekY: number;
  cheekZ: number;

  // Eye stalks — short cylinders rising from the head.
  eyeStalkX: number;
  eyeStalkY: number;
  eyeStalkZ: number;
  eyeStalkLength: number;
  eyeStalkRadius: number;

  // Eyeballs sitting on top of the stalks.
  eyeballRadius: number;
  // Pupil sits inside the eyeball at +Z.
  pupilRadius: number;
  pupilZ: number;
  // Shine highlight (offset from eye centre).
  shineRadius: number;
  shineX: number;
  shineY: number;
  shineZ: number;

  // Antennae — thin wires with glowing tips.
  antennaX: number;
  antennaY: number;
  antennaZ: number;
  antennaLength: number;
  antennaTipRadius: number;
  antennaRestTilt: number;

  // Smile + tongue.
  mouthRadius: number;
  mouthThickness: number;
  mouthY: number;
  mouthZ: number;
  tongueRadius: number;
  tongueY: number;
  tongueZ: number;

  // Arms — pivot at shoulder; sphere hand on the end.
  armPivotX: number;
  armPivotY: number;
  armRestTilt: number;
  armLength: number;
  armRadiusTop: number;
  armRadiusBottom: number;
  handRadius: number;

  // Feet — flattened spheres.
  footX: number;
  footY: number;
  footZ: number;
  footRadius: number;
  footScaleX: number;
  footScaleY: number;
  footScaleZ: number;
};

// Hand-tuned baseline matching the current makeAlien defaults.
export const DEFAULT_ALIEN_GEOMETRY: AlienGeometry = {
  shadowRadius: 0.45,
  shadowOpacity: 0.25,

  bodyRadius: 0.5,
  bodyScaleY: 1.05,
  bodyY: 0.5,

  bellyRadius: 0.3,
  bellyY: 0.42,
  bellyZ: 0.3,

  headRadius: 0.46,
  headY: 1.05,

  cheekRadius: 0.13,
  cheekX: 0.28,
  cheekY: 0.92,
  cheekZ: 0.33,

  eyeStalkX: 0.16,
  eyeStalkY: 1.32,
  eyeStalkZ: 0.06,
  eyeStalkLength: 0.18,
  eyeStalkRadius: 0.045,

  eyeballRadius: 0.18,
  pupilRadius: 0.09,
  pupilZ: 0.115,
  shineRadius: 0.03,
  shineX: -0.05,
  shineY: 0.34,
  shineZ: 0.16,

  antennaX: 0.24,
  antennaY: 1.4,
  antennaZ: -0.08,
  antennaLength: 0.32,
  antennaTipRadius: 0.07,
  antennaRestTilt: 0.3,

  mouthRadius: 0.16,
  mouthThickness: 0.03,
  mouthY: 0.9,
  mouthZ: 0.42,
  tongueRadius: 0.07,
  tongueY: 0.83,
  tongueZ: 0.45,

  armPivotX: 0.45,
  armPivotY: 0.7,
  armRestTilt: 0.25,
  armLength: 0.32,
  armRadiusTop: 0.07,
  armRadiusBottom: 0.06,
  handRadius: 0.11,

  footX: 0.2,
  footY: 0.06,
  footZ: 0.02,
  footRadius: 0.13,
  footScaleX: 1,
  footScaleY: 0.4,
  footScaleZ: 1.2,
};

const STORAGE_KEY = "letra:alienGeometry";

export function loadAlienGeometry(): AlienGeometry {
  if (typeof window === "undefined") return DEFAULT_ALIEN_GEOMETRY;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_ALIEN_GEOMETRY;
    const parsed = JSON.parse(raw) as Partial<AlienGeometry>;
    return { ...DEFAULT_ALIEN_GEOMETRY, ...parsed };
  } catch {
    return DEFAULT_ALIEN_GEOMETRY;
  }
}

export function saveAlienGeometry(g: AlienGeometry): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(g));
  } catch {
    // localStorage may be disabled — non-fatal.
  }
}

export function clearAlienGeometry(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

// Field metadata for the editor UI — tells the slider component
// what range to clamp to and what step granularity feels right per
// field. Anything not listed here gets a default range when rendered.
export type AlienFieldMeta = {
  label: string;
  min: number;
  max: number;
  step?: number;
};

export const ALIEN_FIELD_META: Record<keyof AlienGeometry, AlienFieldMeta> = {
  shadowRadius: { label: "Shadow radius", min: 0, max: 1.2, step: 0.01 },
  shadowOpacity: { label: "Shadow opacity", min: 0, max: 1, step: 0.01 },

  bodyRadius: { label: "Body radius", min: 0.1, max: 1.5, step: 0.01 },
  bodyScaleY: { label: "Body scale Y", min: 0.4, max: 2, step: 0.01 },
  bodyY: { label: "Body Y", min: 0, max: 2, step: 0.01 },

  bellyRadius: { label: "Belly radius", min: 0, max: 1, step: 0.01 },
  bellyY: { label: "Belly Y", min: 0, max: 2, step: 0.01 },
  bellyZ: { label: "Belly Z", min: 0, max: 1, step: 0.01 },

  headRadius: { label: "Head radius", min: 0.1, max: 1.5, step: 0.01 },
  headY: { label: "Head Y", min: 0, max: 2.5, step: 0.01 },

  cheekRadius: { label: "Cheek radius", min: 0, max: 0.6, step: 0.005 },
  cheekX: { label: "Cheek X", min: 0, max: 0.8, step: 0.005 },
  cheekY: { label: "Cheek Y", min: 0, max: 2, step: 0.005 },
  cheekZ: { label: "Cheek Z", min: 0, max: 1, step: 0.005 },

  eyeStalkX: { label: "Eye stalk X", min: 0, max: 0.6, step: 0.005 },
  eyeStalkY: { label: "Eye stalk Y", min: 0, max: 2.5, step: 0.005 },
  eyeStalkZ: { label: "Eye stalk Z", min: -0.4, max: 0.6, step: 0.005 },
  eyeStalkLength: { label: "Stalk length", min: 0, max: 1, step: 0.005 },
  eyeStalkRadius: { label: "Stalk radius", min: 0, max: 0.2, step: 0.002 },

  eyeballRadius: { label: "Eyeball radius", min: 0.05, max: 0.5, step: 0.005 },
  pupilRadius: { label: "Pupil radius", min: 0, max: 0.3, step: 0.002 },
  pupilZ: { label: "Pupil Z", min: 0, max: 0.4, step: 0.002 },
  shineRadius: { label: "Shine radius", min: 0, max: 0.1, step: 0.001 },
  shineX: { label: "Shine X", min: -0.2, max: 0.2, step: 0.002 },
  shineY: { label: "Shine Y", min: 0, max: 0.6, step: 0.002 },
  shineZ: { label: "Shine Z", min: 0, max: 0.4, step: 0.002 },

  antennaX: { label: "Antenna X", min: 0, max: 0.6, step: 0.005 },
  antennaY: { label: "Antenna Y", min: 0, max: 2.5, step: 0.005 },
  antennaZ: { label: "Antenna Z", min: -0.4, max: 0.4, step: 0.005 },
  antennaLength: { label: "Antenna length", min: 0, max: 1, step: 0.005 },
  antennaTipRadius: { label: "Antenna tip", min: 0, max: 0.2, step: 0.002 },
  antennaRestTilt: { label: "Antenna tilt", min: -1, max: 1, step: 0.02 },

  mouthRadius: { label: "Mouth radius", min: 0, max: 0.4, step: 0.005 },
  mouthThickness: { label: "Mouth thickness", min: 0, max: 0.1, step: 0.002 },
  mouthY: { label: "Mouth Y", min: 0, max: 2, step: 0.005 },
  mouthZ: { label: "Mouth Z", min: 0, max: 0.8, step: 0.005 },
  tongueRadius: { label: "Tongue radius", min: 0, max: 0.2, step: 0.002 },
  tongueY: { label: "Tongue Y", min: 0, max: 2, step: 0.005 },
  tongueZ: { label: "Tongue Z", min: 0, max: 0.8, step: 0.005 },

  armPivotX: { label: "Arm pivot X", min: 0, max: 1, step: 0.01 },
  armPivotY: { label: "Arm pivot Y", min: 0, max: 2, step: 0.01 },
  armRestTilt: { label: "Arm rest tilt", min: -1, max: 1, step: 0.01 },
  armLength: { label: "Arm length", min: 0, max: 1, step: 0.01 },
  armRadiusTop: { label: "Arm top r", min: 0, max: 0.2, step: 0.005 },
  armRadiusBottom: { label: "Arm bottom r", min: 0, max: 0.2, step: 0.005 },
  handRadius: { label: "Hand radius", min: 0, max: 0.3, step: 0.005 },

  footX: { label: "Foot X", min: 0, max: 0.6, step: 0.005 },
  footY: { label: "Foot Y", min: 0, max: 0.4, step: 0.005 },
  footZ: { label: "Foot Z", min: -0.2, max: 0.4, step: 0.005 },
  footRadius: { label: "Foot radius", min: 0, max: 0.4, step: 0.005 },
  footScaleX: { label: "Foot scale X", min: 0.1, max: 2, step: 0.05 },
  footScaleY: { label: "Foot scale Y", min: 0.1, max: 2, step: 0.05 },
  footScaleZ: { label: "Foot scale Z", min: 0.1, max: 3, step: 0.05 },
};

// Logical groupings the editor uses to render section headings.
export const ALIEN_FIELD_GROUPS: { label: string; fields: (keyof AlienGeometry)[] }[] = [
  { label: "Shadow", fields: ["shadowRadius", "shadowOpacity"] },
  { label: "Body", fields: ["bodyRadius", "bodyScaleY", "bodyY", "bellyRadius", "bellyY", "bellyZ"] },
  { label: "Head", fields: ["headRadius", "headY"] },
  { label: "Cheeks", fields: ["cheekRadius", "cheekX", "cheekY", "cheekZ"] },
  {
    label: "Eyes",
    fields: [
      "eyeStalkX",
      "eyeStalkY",
      "eyeStalkZ",
      "eyeStalkLength",
      "eyeStalkRadius",
      "eyeballRadius",
      "pupilRadius",
      "pupilZ",
      "shineRadius",
      "shineX",
      "shineY",
      "shineZ",
    ],
  },
  {
    label: "Antennae",
    fields: ["antennaX", "antennaY", "antennaZ", "antennaLength", "antennaTipRadius", "antennaRestTilt"],
  },
  {
    label: "Mouth",
    fields: ["mouthRadius", "mouthThickness", "mouthY", "mouthZ", "tongueRadius", "tongueY", "tongueZ"],
  },
  {
    label: "Arms",
    fields: [
      "armPivotX",
      "armPivotY",
      "armRestTilt",
      "armLength",
      "armRadiusTop",
      "armRadiusBottom",
      "handRadius",
    ],
  },
  {
    label: "Feet",
    fields: ["footX", "footY", "footZ", "footRadius", "footScaleX", "footScaleY", "footScaleZ"],
  },
];
