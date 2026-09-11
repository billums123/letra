import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { Scene } from "../world/Scene";
import { HUD } from "../ui/HUD";
import { audio } from "../audio/Player";
import { playChime, playWoo } from "../audio/sfx";
import { Engine } from "../engine/Engine";
import { loadFont, makeSharedLetterAssets } from "../engine/letters";
import {
  orientToSurface,
  pickSpot,
  plantLetter,
  replantLetters,
  type FieldLetter,
  type KeepOut,
} from "../engine/letterField";
import { FLAT_SURFACE, type Surface } from "../engine/surface";
import { makeBurst } from "../engine/particles";
import { ALPHABET } from "../audio/types";
import { useGameStore } from "../state/store";
import { openCue, openWay, openWayClip, shutWay } from "./travelGate";

// Sound-match: voice plays a letter sound, kid walks to the matching letter.
// Spawns a small set of choices (3 the first round, growing to 5) so a 3yo
// doesn't have to scan a wall of glyphs.
//
// One right answer also opens the way onward — the volcano in the sea, the
// pools on a planet. Rounds are endless, so the gate opens once per world
// and stays open until the ride is taken; landing somewhere new shuts it
// and starts the choices over there. See ./travelGate.ts.

const COLLECT_DIST = 1.7;
// Sound match is endless: we cycle through a shuffled alphabet so
// every letter shows up before any repeats, then reshuffle for the
// next cycle. Kids stop whenever they want via the back button.
// If the kid wanders for this many seconds without making contact, we
// chime in with an encouragement line and replay the target sound so
// they remember what they're looking for. The clock only starts after
// the round's audio cue finishes — see buildRound.
const HINT_AFTER_SECONDS = 10;

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Tween a Group's uniform scale over `durationS`. Used to pop letters in
// at the start of a round and shrink them away when the round ends so
// the round-to-round handoff feels like a transition rather than a
// teleport. Uses overshoot easing on the way in for a "bouncy" pop and
// linear-ish ease on the way out so it reads as "going away".
function tweenScale(
  engine: Engine,
  group: THREE.Group,
  from: number,
  to: number,
  durationS: number,
  delayS: number,
  onComplete?: () => void,
) {
  group.scale.setScalar(from);
  let elapsed = -delayS;
  const actor = {
    update(dt: number) {
      elapsed += dt;
      if (elapsed < 0) return;
      const k = Math.min(elapsed / durationS, 1);
      // Cubic overshoot (popping in) / cubic ease-in (sinking out).
      let eased: number;
      if (to > from) {
        const c = 1.70158;
        const c3 = c + 1;
        const x = k - 1;
        eased = 1 + c3 * x * x * x + c * x * x;
      } else {
        eased = k * k;
      }
      const s = from + (to - from) * eased;
      group.scale.setScalar(Math.max(0, s));
      if (k >= 1) {
        engine.removeActor(actor);
        onComplete?.();
      }
    },
  };
  engine.addActor(actor);
}

export function SoundMatchGame() {
  const collect = useGameStore((s) => s.collect);
  const letterCase = useGameStore((s) => s.letterCase);
  const [round, setRound] = useState(1);
  const engineRef = useRef<Engine | null>(null);
  const lettersRef = useRef<FieldLetter[]>([]);
  const surfaceRef = useRef<Surface>(FLAT_SURFACE);
  const [banner, setBanner] = useState<string | null>(null);
  const targetRef = useRef<string | null>(null);
  const lockRef = useRef(false);
  // Mirror of the round state so the tickHook closure (set up once in
  // bootstrap) reads the current round instead of the initial value —
  // otherwise every correct match recomputes 0+1 and the HUD pins to
  // "Round 2" forever.
  const roundRef = useRef(1);
  // Queue of letters remaining in the current alphabet cycle. We refill
  // from a fresh shuffle whenever it empties so every letter shows up
  // exactly once per cycle before any repeats.
  const letterQueueRef = useRef<string[]>([]);
  // Hint scheduling. lastProgressRef resets at the start of each round
  // and after a hint plays; hintScheduledRef is a re-entry guard so
  // the tickHook doesn't queue a second hint while the first is still
  // mid-flight.
  const lastProgressRef = useRef(performance.now());
  const hintScheduledRef = useRef(false);

  // Build round letters: pick the target plus N-1 random distractors.
  // `keepTarget` lays the same sound out again somewhere else rather
  // than asking for a new one. A kid who has just been told to find
  // the letter that says /b/ and is then flown to a star should still
  // be looking for /b/ when they land.
  const buildRound = (
    engine: Engine,
    font: Awaited<ReturnType<typeof loadFont>>,
    roundIndex: number,
    keepTarget = false,
  ) => {
    // Animate previous letters out (shrink to 0) before disposing. We
    // freeze the actor list to a local so the engine.removeActor inside
    // the tween's onComplete can't trip over a concurrent mutation.
    const outgoing = lettersRef.current;
    lettersRef.current = [];
    for (const entry of outgoing) {
      // Stop the character's own per-frame update (idle bob, celebrate
      // pulse) so it doesn't fight the scale tween.
      engine.removeActor(entry.character);
      tweenScale(engine, entry.character.group, 1, 0, 0.32, 0, () => entry.remove());
    }

    const choiceCount = Math.min(3 + Math.floor(roundIndex / 2), 5);
    // Pull the next target from the cycle queue. When empty, refill
    // with a fresh shuffle of the alphabet. If the new cycle would
    // start on the letter we just used (the prev target), rotate it
    // one slot back so the kid doesn't see the same answer twice in
    // a row across the cycle boundary.
    if (!keepTarget && letterQueueRef.current.length === 0) {
      const next = shuffle([...ALPHABET]);
      const prev = targetRef.current;
      if (prev && next[0] === prev && next.length > 1) {
        [next[0], next[1]] = [next[1], next[0]];
      }
      letterQueueRef.current = next;
    }
    // Carrying the sound over leaves the queue alone, so nothing is
    // burned by the trip and every letter still shows up once a cycle.
    const targetLetter = keepTarget && targetRef.current
      ? targetRef.current
      : letterQueueRef.current.shift()!;
    targetRef.current = targetLetter;
    // Distractor pool: any letter except the target. Shuffle and take
    // (choiceCount - 1) for the round's wrong answers.
    const distractors = shuffle(ALPHABET.filter((L) => L !== targetLetter)).slice(0, choiceCount - 1);
    const candidates = shuffle([targetLetter, ...distractors]);

    const surface = engine.surface;
    surfaceRef.current = surface;
    // The choices creep outward as the rounds go by. On a sphere that
    // is measured from the kid rather than from the middle of a disc,
    // so it starts closer and grows more gently — a star is a long
    // drive from one side to the other.
    const grow = Math.min(roundIndex * 0.4, 6);
    const minRange = surface.kind === "flat" ? 7 + grow : 5 + grow * 0.5;
    const maxRange = minRange + 6;
    const taken: { x: number; z: number; radius: number }[] = [];
    const planetTaken: KeepOut[] = [];
    const keepOut = surface.kind === "planet" ? (surface.spec.noBuild ?? []) : [];
    const around = engine.player.position().clone();
    const rng = (() => {
      // Re-roll each round so the choices land in a different
      // arrangement every time, while still being deterministic
      // within the round (so a single render's worth of placements
      // stays consistent if the function were called twice).
      let s = ((roundIndex * 9871 + 17) ^ ((Math.random() * 0xffffffff) | 0)) | 0;
      return () => {
        s = (s + 0x9e3779b9) | 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    })();
    // Wait for the outgoing shrink to clear before popping the new ones
    // in (320ms tween + a beat of breathing room). On the first round
    // there is nothing to shrink, so we kick off immediately.
    const enterDelay = outgoing.length > 0 ? 0.36 : 0;
    // Fresh shared bag each round. The previous round's bag would be
    // disposed by the outgoing letters' per-letter cleanup once the
    // exit tween completes — sharing a single bag across rounds would
    // mean the new letters end up referencing disposed materials.
    // Each round only allocates 7 materials/geometries vs. ~7 × N
    // when each letter built its own.
    const sharedLetterAssets = makeSharedLetterAssets();
    candidates.forEach((L, i) => {
      const spot = pickSpot(engine, surface, {
        taken,
        planetTaken,
        keepOut,
        around,
        minRange,
        maxRange,
        rng,
      });
      // Apply the kid's case selection. Mixed rolls per-letter so the
      // round can show e.g. "A b c" — same as Find the Alphabet.
      const lowercase =
        letterCase === "lowercase" ||
        (letterCase === "mixed" && Math.random() < 0.5);
      const entry = plantLetter(engine, font, surface, spot, {
        letter: L,
        lowercase,
        shared: sharedLetterAssets,
      });
      entry.faceCamera(engine.camera.position);
      // Pop in with a tiny per-letter stagger so the choices appear
      // sequentially instead of all at once — feels playful rather
      // than chunky.
      tweenScale(engine, entry.character.group, 0, 1, 0.42, enterDelay + i * 0.08);
      lettersRef.current.push(entry);
    });

    // Voice: play the prompt the first round, then the target sound.
    // Push the prompt back a bit on transitions so the voice arrives
    // after the new letters have settled in. The stall timer only
    // arms once the whole audio cue finishes — otherwise the
    // encouragement line would clobber the intro on round 1.
    const audioDelayMs = outgoing.length > 0 ? 700 : 400;
    // Park the timer in the far future so the tickHook can't fire a
    // hint while the cue is still playing.
    lastProgressRef.current = performance.now() + 1e9;
    hintScheduledRef.current = false;
    setTimeout(() => {
      audio.stop();
      const playSound = () =>
        audio.play(audio.letterSound(targetLetter), { interrupt: false }).then(() => {
          lastProgressRef.current = performance.now();
        });
      if (roundIndex === 1) {
        audio.play(audio.prompt("sound-match")).then(playSound);
      } else {
        playSound();
      }
    }, audioDelayMs);
  };

  const onEngineReady = (engine: Engine) => {
    engineRef.current = engine;
    bootstrap(engine);
  };

  const bootstrap = async (engine: Engine) => {
    const font = await loadFont();
    // Shut from the first frame: the sea has to be earned like every
    // other world, or the opening ride is free.
    shutWay(engine);
    buildRound(engine, font, 1);

    // Landing somewhere new: the gate shuts behind the kid and the
    // same sound is laid out again on this world.
    engine.onSurfaceChange = () => {
      shutWay(engine);
      setBanner(null);
      lockRef.current = false;
      buildRound(engine, font, roundRef.current, true);
    };

    // Same world, different floor — down the whirlpool and back. The
    // round carries on; only the ground under it changed.
    engine.onGroundChange = () => {
      const grow = Math.min(roundRef.current * 0.4, 6);
      replantLetters(engine, engine.surface, lettersRef.current, {
        around: engine.player.position().clone(),
        minRange: 7 + grow,
        maxRange: 13 + grow,
        rng: Math.random,
      });
    };

    engine.tickHook = (_dt, _t, playerPos) => {
      // Billboard every letter toward the camera each frame, and push
      // proximity so each letter glows + waves softly as the kid walks
      // up (rising-edge greeting only — no wave-spam if they hover).
      const cam = engine.camera.position;
      for (const entry of lettersRef.current) {
        entry.faceCamera(cam);
        entry.character.setPlayerProximity(entry.distanceTo(playerPos));
      }
      if (lockRef.current) return;
      // No collecting while the volcano launch is flying the avatar
      // over the map — collection distance is XZ-only.
      if (engine.inFlight) return;
      const target = targetRef.current;
      if (!target) return;
      for (const entry of lettersRef.current) {
        if (entry.distanceTo(playerPos) < COLLECT_DIST) {
          handleHit(engine, font, entry, playerPos);
          return;
        }
      }
      // Stall hint: if the kid has wandered without bumping anything
      // for HINT_AFTER_SECONDS, drop in a word of encouragement and
      // replay the target letter sound so they remember the cue.
      const since = (performance.now() - lastProgressRef.current) / 1000;
      if (since > HINT_AFTER_SECONDS && !hintScheduledRef.current) {
        hintScheduledRef.current = true;
        audio
          .play(audio.randomHint())
          .then(() => audio.play(audio.letterSound(target), { interrupt: false }))
          .then(() => {
            lastProgressRef.current = performance.now();
            hintScheduledRef.current = false;
          });
      }
    };
  };

  const handleHit = async (
    engine: Engine,
    font: Awaited<ReturnType<typeof loadFont>>,
    entry: FieldLetter,
    playerPos: THREE.Vector3
  ) => {
    if (lockRef.current) return;
    lockRef.current = true;
    const target = targetRef.current!;
    if (entry.letter === target) {
      // Correct: celebrate, advance round.
      entry.character.celebrate();
      const burst = makeBurst(playerPos.clone());
      // Confetti flies "up" in its own frame; on a star that has to be
      // out of the ground, not toward world +Y.
      orientToSurface(burst.group, surfaceRef.current, playerPos);
      engine.scene.add(burst.group);
      engine.addActor({
        update(dt) {
          const alive = burst.update(dt, 0);
          if (!alive) {
            engine.scene.remove(burst.group);
            engine.removeActor(this);
          }
        },
      });
      playChime();
      // One right answer is the toll for this world. It opens once and
      // stays open until the ride is taken, so the line only ever
      // plays on the round that earned it.
      const surface = surfaceRef.current;
      const opened = openWay(engine);
      if (opened) setBanner(openCue(surface).banner);
      await audio.playSequence([
        audio.letterName(entry.letter),
        opened ? openWayClip(surface) : audio.randomCelebrate(),
      ]);
      collect(entry.letter);
      // Bump the sound-match counter; this awards a Listening Star
      // every 10 successful matches (the store handles the threshold).
      useGameStore.getState().recordSoundMatch();
      const next = roundRef.current + 1;
      roundRef.current = next;
      setRound(next);
      // Endless mode: every (roundsPerCycle)th success closes a full
      // alphabet pass. Punctuate it with a celebratory whoop so the
      // kid feels the milestone, then keep going.
      if (next > 1 && letterQueueRef.current.length === 0) {
        playWoo();
      }
      // Brief pause before next round starts so kid can settle.
      setTimeout(() => {
        buildRound(engine, font, next);
        lockRef.current = false;
      }, 700);
    } else {
      // Wrong: gentle hint and replay the sound.
      await audio.playSequence([
        audio.letterName(entry.letter),
        "prompt-sound-match-replay",
        audio.letterSound(target),
      ]);
      // Player needs to actually leave the wrong letter before we re-arm so we
      // don't immediately re-trigger the hit.
      const wait = setInterval(() => {
        const p = engineRef.current?.player.position();
        if (!p) return;
        if (entry.distanceTo(p) > COLLECT_DIST + 0.6) {
          clearInterval(wait);
          lockRef.current = false;
        }
      }, 100);
    }
  };

  useEffect(() => {
    return () => {
      const engine = engineRef.current;
      if (!engine) return;
      for (const entry of lettersRef.current) entry.remove();
      lettersRef.current = [];
      engine.tickHook = undefined;
      engine.onSurfaceChange = undefined;
      engine.onGroundChange = undefined;
      engine.travelOpen = true;
    };
  }, []);

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <Scene onEngineReady={onEngineReady} />
      <HUD title={`Round ${round}`} banner={banner ?? undefined} />
    </div>
  );
}
