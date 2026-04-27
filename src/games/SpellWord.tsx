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
import { SPELL_WORDS } from "../audio/types";
import { useGameStore } from "../state/store";

// "Spell-the-Word" adventure: pick a missing-pet word, scatter the letters
// around the world avoiding obstacles, and walk over them in order. On
// completion the screen pauses with a "Next Word!" button so the kid can
// savour the celebration before the next round.

const COLLECT_DIST = 1.7;
const HINT_AFTER_SECONDS = 18;
const SPAWN_INNER = 7;
const SPAWN_OUTER = 18;

type LetterEntry = {
  letter: string;
  index: number;
  character: ReturnType<typeof buildLetterCharacter>;
};

function pickWord(prevWord?: string) {
  const choices = SPELL_WORDS.filter((w) => w.word !== prevWord);
  return choices[Math.floor(Math.random() * choices.length)] ?? SPELL_WORDS[0];
}

export function SpellWordGame() {
  const collect = useGameStore((s) => s.collect);
  // Use roundKey to force a remount when "Next Word!" is pressed.
  const [roundKey, setRoundKey] = useState(0);
  const [prevWord, setPrevWord] = useState<string | undefined>();
  return <SpellWordRound key={roundKey} prevWord={prevWord} onNext={(w) => { setPrevWord(w); setRoundKey((n) => n + 1); }} collect={collect} />;
}

function SpellWordRound({
  prevWord,
  onNext,
  collect,
}: {
  prevWord?: string;
  onNext: (justFinished: string) => void;
  collect: (letter: string) => void;
}) {
  const word = useMemo(() => pickWord(prevWord), [prevWord]);
  const [foundCount, setFoundCount] = useState(0);
  const [completed, setCompleted] = useState(false);
  const engineRef = useRef<Engine | null>(null);
  const lettersRef = useRef<LetterEntry[]>([]);
  const lastProgressRef = useRef(performance.now());
  const currentIndex = useRef(0);
  const hintScheduledRef = useRef(false);

  const onEngineReady = (engine: Engine) => {
    engineRef.current = engine;
    bootstrap(engine);
  };

  const bootstrap = async (engine: Engine) => {
    const font = await loadFont();
    const taken: { x: number; z: number; radius: number }[] = [];
    const rng = (() => {
      // Mix the word into a fresh per-mount random seed so the same
      // word can land in different layouts across plays.
      let s = ((word.word.charCodeAt(0) * 31 + word.word.length) ^ ((Math.random() * 0xffffffff) | 0)) | 0;
      return () => {
        s = (s + 0x9e3779b9) | 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    })();
    const letters: LetterEntry[] = word.word.split("").map((L, i) => {
      const character = buildLetterCharacter(font, { letter: L });
      const spawn = pickClearSpawn(engine.obstacles, taken, { minRadius: SPAWN_INNER, maxRadius: SPAWN_OUTER }, 1.0, rng);
      character.group.position.set(spawn.x, 0, spawn.z);
      taken.push({ x: spawn.x, z: spawn.z, radius: 1.0 });
      // Initial face-toward-camera so it's right on first paint.
      character.faceTowards(engine.camera.position.x, engine.camera.position.z);
      engine.scene.add(character.group);
      engine.addActor(character);
      return { letter: L, index: i, character };
    });
    lettersRef.current = letters;

    engine.tickHook = (_dt, _t, playerPos) => {
      // Keep every letter facing the camera every frame.
      for (const entry of lettersRef.current) {
        entry.character.faceTowards(engine.camera.position.x, engine.camera.position.z);
      }
      const next = lettersRef.current.find((l) => !l.character.isCollected && l.index === currentIndex.current);
      if (!next) return;
      const d = distanceXZ(playerPos, next.character.positionXZ());
      if (d < COLLECT_DIST) {
        collectLetter(engine, next, playerPos);
      }
      const since = (performance.now() - lastProgressRef.current) / 1000;
      if (since > HINT_AFTER_SECONDS && !hintScheduledRef.current) {
        hintScheduledRef.current = true;
        audio.play(audio.hint("lookAround")).then(() => {
          lastProgressRef.current = performance.now();
          hintScheduledRef.current = false;
        });
      }
    };

    setTimeout(() => audio.play(audio.prompt(`spell-${word.word}`)), 250);
  };

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
    playChime();
    // playSequence cancels itself if anything else interrupts (e.g. the
    // next letter is collected before the chain finishes), so we never
    // hear letter-A's phonetic sound after the player has moved on to B.
    void audio.playSequence([audio.letterName(entry.letter), audio.letterSound(entry.letter)]);
    collect(entry.letter);
    setFoundCount((n) => n + 1);
    currentIndex.current += 1;
    lastProgressRef.current = performance.now();

    if (currentIndex.current >= word.word.length) {
      setCompleted(true);
      playWoo();
      setTimeout(() => {
        audio.play(`reveal-spell-${word.word}`).then(() => audio.play(audio.randomCelebrate()));
      }, 700);
    }
  };

  const onReplayPrompt = () => {
    if (completed) audio.play(`reveal-spell-${word.word}`);
    else audio.play(audio.prompt(`spell-${word.word}`));
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

  const targets = word.word.split("").map((L, i) => ({ letter: L, found: i < foundCount }));

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <Scene onEngineReady={onEngineReady} />
      <HUD
        title={`Spell: ${word.word}`}
        prompt={completed ? "🎉 You spelled it!" : `Find the next letter: ${word.word[foundCount]}`}
        targets={targets}
        onReplayPrompt={onReplayPrompt}
      />
      {completed && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "grid",
            placeItems: "center",
            zIndex: 30,
            pointerEvents: "none",
          }}
        >
          <button
            type="button"
            onClick={() => onNext(word.word)}
            style={{
              pointerEvents: "auto",
              appearance: "none",
              border: "8px solid white",
              background: "#9bdc4a",
              color: "white",
              borderRadius: 32,
              padding: "26px 44px",
              fontSize: 38,
              fontWeight: 900,
              cursor: "pointer",
              boxShadow: "0 12px 0 rgba(0,0,0,0.18), 0 18px 30px rgba(0,0,0,0.25)",
              animation: "letra-bounce 0.8s ease-in-out infinite",
            }}
            aria-label="Next word"
          >
            Next Word! ▶
          </button>
          <style>{`
            @keyframes letra-bounce {
              0%, 100% { transform: translateY(0); }
              50% { transform: translateY(-10px); }
            }
          `}</style>
        </div>
      )}
    </div>
  );
}
