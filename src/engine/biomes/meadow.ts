import * as THREE from "three";
import type { Biome } from "./types";
import { buildMeadow } from "../world";

// The original Letra world — sunny pastel meadow with trees, mushrooms,
// hills, a lily-pad pond, scattered flowers, and drifting butterflies.
// Default biome the kid sees on first launch.
export const meadowBiome: Biome = {
  id: "meadow",
  label: "Meadow",
  emoji: "🌳",
  recommendedAvatar: "kid",
  applyScene(scene) {
    const prevBg = scene.background;
    const prevFog = scene.fog;
    scene.background = new THREE.Color(0xa8e2ff);
    scene.fog = new THREE.Fog(0xa8e2ff, 60, 160);
    const hemi = new THREE.HemisphereLight(0xfff7d6, 0x86d36a, 0.6);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(15, 25, 10);
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
    const ambient = new THREE.AmbientLight(0xffffff, 0.4);
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
