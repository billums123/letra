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
  | {
      kind: "flat";
      // Which part of the flat world — "sea", "seafloor". A biome with
      // one place leaves it "flat". Two places on the same ground are
      // still two places: the sea bed is forty-six units under the
      // waves with its own letters to find and its own way out.
      id: string;
    }
  | {
      kind: "planet";
      // Stable name for the sphere — "sun", "saturn", "jupiter".
      id: string;
      spec: PlanetSpec;
    };

// What a biome that never moves the kid anywhere reports.
export const FLAT_SURFACE: Surface = { kind: "flat", id: "flat" };

// A name for the surface a kid is on, usable as a map key.
export function surfaceId(s: Surface): string {
  return s.id;
}

// Human-facing name, for a HUD line telling a kid where they are.
export function surfaceLabel(s: Surface): string {
  switch (s.id) {
    case "seafloor":
      return "the sea floor";
    case "sea":
    case "flat":
      return "the sea";
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
