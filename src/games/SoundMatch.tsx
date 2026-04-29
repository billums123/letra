import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { Scene } from "../world/Scene";
import { HUD } from "../ui/HUD";
import { audio } from "../audio/Player";
import { playChime, playWoo } from "../audio/sfx";
import { Engine } from "../engine/Engine";
import { buildLetterCharacter, distanceXZ, loadFont } from "../engine/letters";
import { makeBurst } from "../engine/particles";
import { pickClearSpawn } from "../engine/world";
import { ALPHABET } from "../audio/types";
import { useGameStore } from "../state/store";

// Sound-match: voice plays a letter sound, kid walks to the matching letter.
// Spawns a small set of choices (3 the first round, growing to 5) so a 3yo
// doesn't have to scan a wall of glyphs.

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

type LetterEntry = {
  letter: string;
  character: ReturnType<typeof buildLetterCharacter>;
};

export function SoundMatchGame() {
  const collect = useGameStore((s) => s.collect);
  const letterCase = useGameStore((s) => s.letterCase);
  const [round, setRound] = useState(1);
  const engineRef = useRef<Engine | null>(null);
  const lettersRef = useRef<LetterEntry[]>([]);
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
  const buildRound = (engine: Engine, font: Awaited<ReturnType<typeof loadFont>>, roundIndex: number) => {
    // Animate previous letters out (shrink to 0) before disposing. We
    // freeze the actor list to a local so the engine.removeActor inside
    // the tween's onComplete can't trip over a concurrent mutation.
    const outgoing = lettersRef.current;
    lettersRef.current = [];
    for (const entry of outgoing) {
      // Stop the character's own per-frame update (idle bob, celebrate
      // pulse) so it doesn't fight the scale tween.
      engine.removeActor(entry.character);
      tweenScale(engine, entry.character.group, 1, 0, 0.32, 0, () => {
        engine.scene.remove(entry.character.group);
        const dispose = entry.character.group.userData.dispose as (() => void) | undefined;
        dispose?.();
      });
    }

    const choiceCount = Math.min(3 + Math.floor(roundIndex / 2), 5);
    // Pull the next target from the cycle queue. When empty, refill
    // with a fresh shuffle of the alphabet. If the new cycle would
    // start on the letter we just used (the prev target), rotate it
    // one slot back so the kid doesn't see the same answer twice in
    // a row across the cycle boundary.
    if (letterQueueRef.current.length === 0) {
      const next = shuffle([...ALPHABET]);
      const prev = targetRef.current;
      if (prev && next[0] === prev && next.length > 1) {
        [next[0], next[1]] = [next[1], next[0]];
      }
      letterQueueRef.current = next;
    }
    const targetLetter = letterQueueRef.current.shift()!;
    targetRef.current = targetLetter;
    // Distractor pool: any letter except the target. Shuffle and take
    // (choiceCount - 1) for the round's wrong answers.
    const distractors = shuffle(ALPHABET.filter((L) => L !== targetLetter)).slice(0, choiceCount - 1);
    const candidates = shuffle([targetLetter, ...distractors]);

    const minR = 7 + roundIndex * 0.4;
    const maxR = minR + 6;
    const taken: { x: number; z: number; radius: number }[] = [];
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
    candidates.forEach((L, i) => {
      const spawn = pickClearSpawn(engine.obstacles, taken, { minRadius: minR, maxRadius: maxR }, 1.0, rng);
      const baseY = engine.terrainHeight?.(spawn.x, spawn.z) ?? 0;
      // Apply the kid's case selection. Mixed rolls per-letter so the
      // round can show e.g. "A b c" — same as Find the Alphabet.
      const lowercase =
        letterCase === "lowercase" ||
        (letterCase === "mixed" && Math.random() < 0.5);
      const character = buildLetterCharacter(font, { letter: L, lowercase, baseY });
      character.group.position.set(spawn.x, baseY, spawn.z);
      taken.push({ x: spawn.x, z: spawn.z, radius: 1.0 });
      character.faceTowards(engine.camera.position.x, engine.camera.position.z);
      engine.scene.add(character.group);
      engine.addActor(character);
      // Pop in with a tiny per-letter stagger so the choices appear
      // sequentially instead of all at once — feels playful rather
      // than chunky.
      tweenScale(engine, character.group, 0, 1, 0.42, enterDelay + i * 0.08);
      lettersRef.current.push({ letter: L, character });
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
    buildRound(engine, font, 1);

    engine.tickHook = (_dt, _t, playerPos) => {
      // Billboard every letter toward the camera each frame.
      for (const entry of lettersRef.current) {
        entry.character.faceTowards(engine.camera.position.x, engine.camera.position.z);
      }
      if (lockRef.current) return;
      const target = targetRef.current;
      if (!target) return;
      for (const entry of lettersRef.current) {
        const d = distanceXZ(playerPos, entry.character.positionXZ());
        if (d < COLLECT_DIST) {
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
    entry: LetterEntry,
    playerPos: THREE.Vector3
  ) => {
    if (lockRef.current) return;
    lockRef.current = true;
    const target = targetRef.current!;
    if (entry.letter === target) {
      // Correct: celebrate, advance round.
      entry.character.celebrate();
      const burst = makeBurst(playerPos.clone());
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
      await audio.playSequence([audio.letterName(entry.letter), audio.randomCelebrate()]);
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
      const wrongPos = entry.character.positionXZ();
      const wait = setInterval(() => {
        const p = engineRef.current?.player.position();
        if (!p) return;
        if (distanceXZ(p, wrongPos) > COLLECT_DIST + 0.6) {
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
      for (const entry of lettersRef.current) {
        engine.removeActor(entry.character);
        engine.scene.remove(entry.character.group);
        const dispose = entry.character.group.userData.dispose as (() => void) | undefined;
        dispose?.();
      }
      lettersRef.current = [];
      engine.tickHook = undefined;
    };
  }, []);

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <Scene onEngineReady={onEngineReady} />
      <HUD title={`Round ${round}`} />
    </div>
  );
}
