import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Scene } from "../world/Scene";
import { HUD } from "../ui/HUD";
import { audio } from "../audio/Player";
import { Engine } from "../engine/Engine";
import { buildLetterCharacter, distanceXZ, loadFont } from "../engine/letters";
import { makeBurst } from "../engine/particles";
import { SPELL_WORDS } from "../audio/types";
import { useGameStore } from "../state/store";

// "Spell-the-Word" adventure: pick a random missing-pet word, scatter the
// letters around the world, and ask the kid to walk over them in order.
//
// Audio-driven: full prompt on start, hint after 18s of no progress, fanfare
// on each letter, big celebration line on completion.

const WORLD_R = 22; // letters spawn within this radius
const COLLECT_DIST = 1.6;
const HINT_AFTER_SECONDS = 18;

type LetterEntry = {
  letter: string;
  index: number;
  character: ReturnType<typeof buildLetterCharacter>;
  spawnPos: THREE.Vector3;
};

function pickWord() {
  return SPELL_WORDS[Math.floor(Math.random() * SPELL_WORDS.length)];
}

function scatterPositions(count: number, seed: number) {
  // Distribute letters evenly around an arc, jittered so it doesn't look like
  // a perfect circle. Keep them at least 4 units apart so kids don't pick up
  // two at once.
  const positions: THREE.Vector3[] = [];
  const rand = (() => {
    let s = seed | 0;
    return () => {
      s = (s + 0x9e3779b9) | 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  })();
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + (rand() - 0.5) * 0.6;
    const dist = 8 + rand() * (WORLD_R - 9);
    positions.push(new THREE.Vector3(Math.cos(angle) * dist, 0, Math.sin(angle) * dist));
  }
  return positions;
}

export function SpellWordGame() {
  const collect = useGameStore((s) => s.collect);
  const word = useMemo(pickWord, []);
  const [foundCount, setFoundCount] = useState(0);
  const [completed, setCompleted] = useState(false);
  const engineRef = useRef<Engine | null>(null);
  const lettersRef = useRef<LetterEntry[]>([]);
  const lastProgressRef = useRef(performance.now());

  const onEngineReady = (engine: Engine) => {
    engineRef.current = engine;
    bootstrap(engine);
  };

  const bootstrap = async (engine: Engine) => {
    const font = await loadFont();
    const positions = scatterPositions(word.word.length, word.word.charCodeAt(0) * 31);
    const letters: LetterEntry[] = word.word.split("").map((L, i) => {
      const character = buildLetterCharacter(font, { letter: L });
      character.group.position.copy(positions[i]);
      character.group.position.y = 0;
      // Each letter rotates to face the world center so its face is visible.
      character.group.lookAt(0, character.group.position.y, 0);
      engine.scene.add(character.group);
      engine.addActor(character);
      return { letter: L, index: i, character, spawnPos: positions[i].clone() };
    });
    lettersRef.current = letters;

    // Tick hook handles: proximity collection, hint timer.
    engine.tickHook = (_dt, _t, playerPos) => {
      const next = lettersRef.current.find((l) => !l.character.isCollected && l.index === currentIndex.current);
      if (!next) return;
      const d = distanceXZ(playerPos, next.character.positionXZ());
      if (d < COLLECT_DIST) {
        collectLetter(engine, next, playerPos);
      }
      // Hint — replay prompt or speak hint after no progress.
      const since = (performance.now() - lastProgressRef.current) / 1000;
      if (since > HINT_AFTER_SECONDS && !hintScheduledRef.current) {
        hintScheduledRef.current = true;
        audio.play(audio.hint("lookAround")).then(() => {
          // Re-arm
          lastProgressRef.current = performance.now();
          hintScheduledRef.current = false;
        });
      }
    };

    // Kick off the prompt.
    setTimeout(() => audio.play(audio.prompt(`spell-${word.word}`)), 250);
  };

  const currentIndex = useRef(0);
  const hintScheduledRef = useRef(false);

  const collectLetter = (engine: Engine, entry: LetterEntry, playerPos: THREE.Vector3) => {
    if (entry.character.isCollected) return;
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

    // Audio cue: letter name then sound, then any celebration.
    audio.stop();
    audio.play(audio.letterName(entry.letter)).then(() => audio.play(audio.letterSound(entry.letter), { interrupt: false }));

    collect(entry.letter);
    setFoundCount((n) => n + 1);
    currentIndex.current += 1;
    lastProgressRef.current = performance.now();

    if (currentIndex.current >= word.word.length) {
      setCompleted(true);
      // Finish line: reveal phrase then a celebrate line.
      setTimeout(() => {
        audio.play(`reveal-spell-${word.word}`).then(() => audio.play(audio.randomCelebrate()));
      }, 700);
    }
  };

  // Replay the latest prompt on demand.
  const onReplayPrompt = () => {
    if (completed) {
      audio.play(`reveal-spell-${word.word}`);
    } else {
      audio.play(audio.prompt(`spell-${word.word}`));
    }
  };

  // Cleanup on unmount: dispose letters / actors.
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

  const targets = word.word.split("").map((L, i) => ({ letter: L, found: i < foundCount }));

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <Scene onEngineReady={onEngineReady} />
      <HUD
        title={`Spell: ${word.word}`}
        prompt={completed ? "You did it!" : `Find the next letter: ${word.word[foundCount]}`}
        targets={targets}
        onReplayPrompt={onReplayPrompt}
      />
    </div>
  );
}
