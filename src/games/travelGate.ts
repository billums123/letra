import { playWoo } from "../audio/sfx";
import type { Engine } from "../engine/Engine";
import type { Surface } from "../engine/surface";

// The way onward.
//
// Every world holds the kid until they finish what they came for. The
// ocean's volcano only fires them at the sun once the word is spelled;
// a planet's pools stay dark until they have done it again up there.
// The rule is the same in all three games and the wording of it lives
// here rather than three times over.
//
// One thing this deliberately does NOT do is shut again when a new
// round starts. The unlock belongs to the kid until they spend it: a
// four-year-old who spells a second word in the ocean before they get
// around to the volcano has not lost their ride. It is the *arrival*
// somewhere new that shuts the gate, and games do that from the
// engine's onSurfaceChange.

export type GateCue = {
  // Short line under the HUD, read out by an adult or recognised by
  // shape. The emoji is doing most of the work.
  banner: string;
};

// What a kid should do next, now that the way is open.
export function openCue(surface: Surface): GateCue {
  if (surface.kind === "flat") {
    return { banner: "🌋 The volcano is awake! Ride it to a new world 🌪️" };
  }
  return { banner: "💧 The pools are open! Jump in one to go home" };
}

// The line for "you can leave now", which the caller drops into
// whatever it was already going to say. Keeping it out of openWay is
// what lets Spell the Word put the word's own reveal first.
export function openWayClip(surface: Surface): string {
  return surface.kind === "flat" ? "gate-open-sea" : "gate-open-planet";
}

// Open the way onward, returning whether this call is the one that did
// it. Only the first time counts: Sound Match lands a correct answer
// every few seconds and Find the Alphabet finishes a letter at a time,
// and announcing the same unlock over and over would turn the best
// moment in the loop into nagging.
//
// The flag flips now, not when the audio finishes. A kid who taps past
// the celebration has still earned the ride.
export function openWay(engine: Engine): boolean {
  if (engine.travelOpen) return false;
  engine.travelOpen = true;
  playWoo();
  return true;
}

// Shut it again. Called when the avatar lands somewhere new, so the
// next world has to be earned on its own terms.
export function shutWay(engine: Engine): void {
  engine.travelOpen = false;
}
