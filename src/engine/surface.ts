import * as THREE from "three";
import type { PlanetSpec } from "./planet";

// Where the avatar is standing.
//
// The game modes used to assume one answer: a ground plane, with a
// height sampler for the bumps. Then the ocean grew a sun you can walk
// all the way around, and "spell the word here" stopped having a
// meaning on half the places a kid can be. This type is the smallest
// thing that lets a mode ask the question without caring which.

export type Surface =
  | { kind: "flat" }
  | {
      kind: "planet";
      // Stable name for the sphere — "sun", "saturn", "jupiter".
      id: string;
      spec: PlanetSpec;
    };

// The flat world is the same answer every time, so it needs no
// allocation. Handy for identity checks too.
export const FLAT_SURFACE: Surface = { kind: "flat" };

// A name for the surface a kid is on, usable as a map key. The flat
// world is "flat"; a sphere is its own id.
export function surfaceId(s: Surface): string {
  return s.kind === "flat" ? "flat" : s.id;
}

// Human-facing name, for a HUD line telling a kid where they are.
export function surfaceLabel(s: Surface): string {
  if (s.kind === "flat") return "the sea";
  switch (s.id) {
    case "sun":
      return "the sun";
    case "saturn":
      return "Saturn";
    case "jupiter":
      return "Jupiter";
    default:
      return "this world";
  }
}

// Unit direction from a sphere's centre to a world point — the
// spherical equivalent of "which bit of ground is this over".
export function dirOnPlanet(
  spec: PlanetSpec,
  point: THREE.Vector3,
  out = new THREE.Vector3(),
): THREE.Vector3 {
  return out.copy(point).sub(spec.center).normalize();
}
