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

// Hand-tuned baseline. Update via the AlienEditor (👽 Alien on the
// menu in dev builds) → Save → Export → paste the JSON back in here
// to bake the change into the codebase. The previous default lives
// in git history if you ever want to roll back.
export const DEFAULT_ALIEN_GEOMETRY: AlienGeometry = {
  shadowRadius: 0.52,
  shadowOpacity: 0.25,

  bodyRadius: 0.41,
  bodyScaleY: 1.02,
  bodyY: 0.53,

  bellyRadius: 0.24,
  bellyY: 0.51,
  bellyZ: 0.24,

  headRadius: 0.42,
  headY: 1.09,

  cheekRadius: 0.05,
  cheekX: 0.28,
  cheekY: 1.165,
  cheekZ: 0.355,

  eyeStalkX: 0.185,
  eyeStalkY: 1.255,
  eyeStalkZ: 0.225,
  eyeStalkLength: 0.235,
  eyeStalkRadius: 0.045,

  eyeballRadius: 0.16,
  pupilRadius: 0.09,
  pupilZ: 0.115,
  shineRadius: 0.03,
  shineX: -0.04,
  shineY: 0.332,
  shineZ: 0.16,

  antennaX: 0.26,
  antennaY: 1.245,
  antennaZ: -0.23,
  antennaLength: 0.39,
  antennaTipRadius: 0.09,
  antennaRestTilt: 0.62,

  mouthRadius: 0.125,
  mouthThickness: 0.048,
  mouthY: 0.9,
  mouthZ: 0.18,
  tongueRadius: 0.16,
  tongueY: 1.055,
  tongueZ: 0.43,

  armPivotX: 0.34,
  armPivotY: 0.7,
  armRestTilt: -1,
  armLength: 0.32,
  armRadiusTop: 0.1,
  armRadiusBottom: 0.055,
  handRadius: 0.12,

  footX: 0.2,
  footY: 0.03,
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
