import { useEffect, useMemo, useRef, useState } from "react";
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

// Find the alphabet from A to Z. Letters scattered in a wide ring; the kid
// walks to each in order. The current target pulses on the HUD and the world.

const COLLECT_DIST = 1.6;
const RING_INNER = 6;
const RING_OUTER = 30;
const HINT_AFTER_SECONDS = 22;

type LetterEntry = {
  letter: string;
  index: number;
  character: ReturnType<typeof buildLetterCharacter>;
};

// Avatar-aware prompt id and verb. Walking is the default; if the kid is
// driving the car we swap to the "drive" wording so the audio matches what
// they're actually doing on screen.
function alphabetPromptId(avatar: "kid" | "car"): string {
  return avatar === "car" ? "prompt-find-alphabet-drive" : "prompt-find-alphabet";
}
function moveVerb(avatar: "kid" | "car"): string {
  return avatar === "car" ? "Drive" : "Walk";
}

export function FindAlphabetGame() {
  const collect = useGameStore((s) => s.collect);
  const avatar = useGameStore((s) => s.avatar);
  const [foundCount, setFoundCount] = useState(0);
  const [completed, setCompleted] = useState(false);
  const engineRef = useRef<Engine | null>(null);
  const lettersRef = useRef<LetterEntry[]>([]);
  const currentIndex = useRef(0);
  const hintScheduledRef = useRef(false);
  const lastProgressRef = useRef(performance.now());

  // We can't pre-compute spawn positions without the engine's obstacle list,
  // so they're chosen during bootstrap. The spiral is then used as a *seed*
  // for retry attempts that respect the obstacle layout.
  const onEngineReady = (engine: Engine) => {
    engineRef.current = engine;
    bootstrap(engine);
  };

  const bootstrap = async (engine: Engine) => {
    const font = await loadFont();
    const taken: { x: number; z: number; radius: number }[] = [];
    let spiralI = 0;
    const rng = (() => {
      // Fresh seed each time the game mounts so the alphabet lands in
      // a different layout every session — pickClearSpawn still keeps
      // every letter clear of obstacles and other letters, so nothing
      // ends up morphed into a tree or another glyph.
      let s = (Math.random() * 0xffffffff) | 0;
      return () => {
        s = (s + 0x9e3779b9) | 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    })();

    const letters: LetterEntry[] = ALPHABET.map((L, i) => {
      const character = buildLetterCharacter(font, { letter: L });
      // Try a spiral position first; if obstructed, pickClearSpawn retries.
      const t = i / ALPHABET.length;
      const minR = Math.max(RING_INNER, RING_INNER + t * 4);
      const maxR = Math.min(RING_OUTER, RING_INNER + t * (RING_OUTER - RING_INNER) + 6);
      const spawn = pickClearSpawn(engine.obstacles, taken, { minRadius: minR, maxRadius: maxR }, 1.0, rng);
      character.group.position.set(spawn.x, 0, spawn.z);
      taken.push({ x: spawn.x, z: spawn.z, radius: 1.0 });
      character.faceTowards(engine.camera.position.x, engine.camera.position.z);
      engine.scene.add(character.group);
      engine.addActor(character);
      spiralI++;
      return { letter: L, index: i, character };
    });
    lettersRef.current = letters;
    void spiralI;

    engine.tickHook = (_dt, _t, playerPos) => {
      for (const entry of lettersRef.current) {
        entry.character.faceTowards(engine.camera.position.x, engine.camera.position.z);
      }
      const next = lettersRef.current[currentIndex.current];
      if (!next) return;
      const d = distanceXZ(playerPos, next.character.positionXZ());
      if (d < COLLECT_DIST && !next.character.isCollected) {
        collectLetter(engine, next, playerPos);
      }
      const since = (performance.now() - lastProgressRef.current) / 1000;
      if (since > HINT_AFTER_SECONDS && !hintScheduledRef.current) {
        hintScheduledRef.current = true;
        audio.play(audio.hint("keepLooking")).then(() => {
          audio.play(audio.letterName(next.letter), { interrupt: false });
          lastProgressRef.current = performance.now();
          hintScheduledRef.current = false;
        });
      }
    };

    setTimeout(() => audio.play(alphabetPromptId(avatar)), 250);
  };

  const collectLetter = (engine: Engine, entry: LetterEntry, playerPos: THREE.Vector3) => {
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
    // Queue the letter name. Multiple rapid pickups (the kid speed-walks
    // through close-together letters) will play in order rather than
    // each cancelling the last and leaving the user in silence.
    audio.enqueue(audio.letterName(entry.letter));
    collect(entry.letter);
    setFoundCount((n) => n + 1);
    currentIndex.current += 1;
    lastProgressRef.current = performance.now();
    if (currentIndex.current >= ALPHABET.length) {
      setCompleted(true);
      playWoo();
      setTimeout(() => audio.play(audio.randomCelebrate()), 800);
    }
  };

  const onReplayPrompt = () => {
    audio.stop();
    if (completed) audio.play(audio.randomCelebrate());
    else {
      const next = lettersRef.current[currentIndex.current];
      if (next) audio.play(audio.letterName(next.letter));
      else audio.play(alphabetPromptId(avatar));
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

  // HUD: show a window of letters around the current target so the bar
  // doesn't get unreadably long.
  const windowSize = 10;
  const windowStart = Math.max(0, Math.min(foundCount - 2, ALPHABET.length - windowSize));
  const targets = ALPHABET.slice(windowStart, windowStart + windowSize).map((L, i) => ({
    letter: L,
    found: windowStart + i < foundCount,
  }));

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <Scene onEngineReady={onEngineReady} />
      <HUD
        title={completed ? "Alphabet found!" : `Find: ${ALPHABET[foundCount] ?? "🎉"}`}
        prompt={completed ? "You found the whole alphabet!" : `${moveVerb(avatar)} to the next letter!`}
        targets={targets}
        onReplayPrompt={onReplayPrompt}
      />
    </div>
  );
}
