import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Scene } from "../world/Scene";
import { HUD } from "../ui/HUD";
import { audio } from "../audio/Player";
import { Engine } from "../engine/Engine";
import { buildLetterCharacter, distanceXZ, loadFont } from "../engine/letters";
import { makeBurst } from "../engine/particles";
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

export function FindAlphabetGame() {
  const collect = useGameStore((s) => s.collect);
  const [foundCount, setFoundCount] = useState(0);
  const [completed, setCompleted] = useState(false);
  const engineRef = useRef<Engine | null>(null);
  const lettersRef = useRef<LetterEntry[]>([]);
  const currentIndex = useRef(0);
  const hintScheduledRef = useRef(false);
  const lastProgressRef = useRef(performance.now());

  const positions = useMemo(() => {
    // 26 letters arranged in an outward spiral so the early ones are close to
    // spawn and the harder ones (Q, X, Z) further away. Keeps the early game
    // feeling fast and easy.
    const list: THREE.Vector3[] = [];
    for (let i = 0; i < ALPHABET.length; i++) {
      const t = i / ALPHABET.length;
      const r = RING_INNER + t * (RING_OUTER - RING_INNER);
      const angle = i * 2.39996; // golden-angle-ish for nice spread
      list.push(new THREE.Vector3(Math.cos(angle) * r, 0, Math.sin(angle) * r));
    }
    return list;
  }, []);

  const onEngineReady = (engine: Engine) => {
    engineRef.current = engine;
    bootstrap(engine);
  };

  const bootstrap = async (engine: Engine) => {
    const font = await loadFont();
    const letters: LetterEntry[] = ALPHABET.map((L, i) => {
      const character = buildLetterCharacter(font, { letter: L });
      character.group.position.copy(positions[i]);
      character.group.position.y = 0;
      character.group.lookAt(0, character.group.position.y, 0);
      engine.scene.add(character.group);
      engine.addActor(character);
      return { letter: L, index: i, character };
    });
    lettersRef.current = letters;

    engine.tickHook = (_dt, _t, playerPos) => {
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

    setTimeout(() => audio.play(audio.prompt("find-alphabet")), 250);
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
    audio.stop();
    audio.play(audio.letterName(entry.letter)).then(() => audio.play(audio.letterSound(entry.letter), { interrupt: false }));
    collect(entry.letter);
    setFoundCount((n) => n + 1);
    currentIndex.current += 1;
    lastProgressRef.current = performance.now();
    if (currentIndex.current >= ALPHABET.length) {
      setCompleted(true);
      setTimeout(() => audio.play(audio.randomCelebrate()), 800);
    }
  };

  const onReplayPrompt = () => {
    audio.stop();
    if (completed) audio.play(audio.randomCelebrate());
    else {
      const next = lettersRef.current[currentIndex.current];
      if (next) audio.play(audio.letterName(next.letter));
      else audio.play(audio.prompt("find-alphabet"));
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
        prompt={completed ? "You found the whole alphabet!" : "Walk to the next letter!"}
        targets={targets}
        onReplayPrompt={onReplayPrompt}
      />
    </div>
  );
}
