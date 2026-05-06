import * as THREE from "three";
import type { Biome } from "./types";
import { buildMeadow } from "../world";
import { rollTimeOfDay, type TimeOfDay } from "./timeOfDay";

// The original Letra world — sunny pastel meadow with trees, mushrooms,
// hills, a lily-pad pond, scattered flowers, and drifting butterflies.
// Default biome the kid sees on first launch.
//
// Each mount rolls a fresh time-of-day so the same park alternates
// between morning, midday, sunset, and dusk. Geometry / gameplay are
// untouched — only the sky, fog, and lights change.

type MeadowMood = {
  bg: number;
  fogColor: number;
  fogNear: number;
  fogFar: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  sunColor: number;
  sunIntensity: number;
  // Sun direction is shifted lower at sunset so shadows stretch out.
  sunPos: [number, number, number];
  ambientColor: number;
  ambientIntensity: number;
};

// Mood table. Tunable by hand — the rule of thumb is to keep ambient
// + hemi summing to >= ~0.85 so letter glyphs and props stay clearly
// readable even in the cooler moods. Sun intensity can drop further
// because diffuse fill carries readability.
const MEADOW_MOODS: Record<Extract<TimeOfDay, "morning" | "midday" | "sunset" | "dusk">, MeadowMood> = {
  // Soft cool morning — pale mint sky, low warm sun raking in.
  morning: {
    bg: 0xc6ecff,
    fogColor: 0xc6ecff,
    fogNear: 60,
    fogFar: 160,
    hemiSky: 0xfff1d0,
    hemiGround: 0x9adf7d,
    hemiIntensity: 0.6,
    sunColor: 0xffe5b8,
    sunIntensity: 1.3,
    sunPos: [22, 18, 8],
    ambientColor: 0xffffff,
    ambientIntensity: 0.42,
  },
  // The original sunny look — kept as the reference / cheerful default.
  midday: {
    bg: 0xa8e2ff,
    fogColor: 0xa8e2ff,
    fogNear: 60,
    fogFar: 160,
    hemiSky: 0xfff7d6,
    hemiGround: 0x86d36a,
    hemiIntensity: 0.6,
    sunColor: 0xffffff,
    sunIntensity: 1.4,
    sunPos: [15, 25, 10],
    ambientColor: 0xffffff,
    ambientIntensity: 0.4,
  },
  // Warm sunset — peach sky, orange sun low on the horizon, shadows
  // stretch across the world. Hemi ground tilts toward warm green so
  // grass picks up the golden hour.
  sunset: {
    bg: 0xffb27a,
    fogColor: 0xffb27a,
    fogNear: 50,
    fogFar: 140,
    hemiSky: 0xffc59a,
    hemiGround: 0xb98c5a,
    hemiIntensity: 0.55,
    sunColor: 0xff9656,
    sunIntensity: 1.25,
    sunPos: [28, 9, 6],
    ambientColor: 0xffd6a8,
    ambientIntensity: 0.42,
  },
  // Cool dusk — twilight blue sky, silver-gray sun (last light), a
  // touch of warm fill from the horizon. Dim but not dark; letters
  // stay readable.
  dusk: {
    bg: 0x6f7faf,
    fogColor: 0x6f7faf,
    fogNear: 50,
    fogFar: 140,
    hemiSky: 0xa9b4d8,
    hemiGround: 0x4f6048,
    hemiIntensity: 0.5,
    sunColor: 0xc8c4d8,
    sunIntensity: 0.85,
    sunPos: [12, 14, 8],
    ambientColor: 0xb6b8d6,
    ambientIntensity: 0.45,
  },
};

const MEADOW_POOL = ["morning", "midday", "sunset", "dusk"] as const;

export const meadowBiome: Biome = {
  id: "meadow",
  label: "Park",
  emoji: "🌳",
  recommendedAvatar: "kid",
  applyScene(scene) {
    const prevBg = scene.background;
    const prevFog = scene.fog;
    const tod = rollTimeOfDay("meadow", MEADOW_POOL);
    const m = MEADOW_MOODS[tod as keyof typeof MEADOW_MOODS];
    scene.background = new THREE.Color(m.bg);
    scene.fog = new THREE.Fog(m.fogColor, m.fogNear, m.fogFar);
    const hemi = new THREE.HemisphereLight(m.hemiSky, m.hemiGround, m.hemiIntensity);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(m.sunColor, m.sunIntensity);
    sun.position.set(m.sunPos[0], m.sunPos[1], m.sunPos[2]);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -25;
    sun.shadow.camera.right = 25;
    sun.shadow.camera.top = 25;
    sun.shadow.camera.bottom = -25;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 70;
    sun.shadow.bias = -0.0005;
    scene.add(sun);
    const ambient = new THREE.AmbientLight(m.ambientColor, m.ambientIntensity);
    scene.add(ambient);
    return () => {
      scene.remove(hemi);
      scene.remove(sun);
      scene.remove(ambient);
      sun.dispose();
      scene.background = prevBg;
      scene.fog = prevFog;
    };
  },
  buildProps: buildMeadow,
};
