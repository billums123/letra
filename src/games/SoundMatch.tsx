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

function moveVerb(avatar: "kid" | "car" | "rocket"): string {
  if (avatar === "car") return "drive";
  if (avatar === "rocket") return "fly";
  return "walk";
}

// Sound-match: voice plays a letter sound, kid walks to the matching letter.
// Spawns a small set of choices (3 the first round, growing to 5) so a 3yo
// doesn't have to scan a wall of glyphs.

const COLLECT_DIST = 1.7;
const ROUNDS_PER_GAME = 5;

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

type LetterEntry = {
  letter: string;
  character: ReturnType<typeof buildLetterCharacter>;
};

export function SoundMatchGame() {
  const collect = useGameStore((s) => s.collect);
  const avatar = useGameStore((s) => s.avatar);
  const [round, setRound] = useState(0);
  const [completed, setCompleted] = useState(false);
  const [target, setTarget] = useState<string | null>(null);
  const engineRef = useRef<Engine | null>(null);
  const lettersRef = useRef<LetterEntry[]>([]);
  const targetRef = useRef<string | null>(null);
  const lockRef = useRef(false);

  // Build round letters: pick the target plus N-1 random distractors.
  const buildRound = (engine: Engine, font: Awaited<ReturnType<typeof loadFont>>, roundIndex: number) => {
    // Clear previous letters
    for (const entry of lettersRef.current) {
      engine.removeActor(entry.character);
      engine.scene.remove(entry.character.group);
      const dispose = entry.character.group.userData.dispose as (() => void) | undefined;
      dispose?.();
    }
    lettersRef.current = [];

    const choiceCount = Math.min(3 + Math.floor(roundIndex / 2), 5);
    const candidates = shuffle([...ALPHABET]).slice(0, choiceCount);
    const targetLetter = candidates[Math.floor(Math.random() * candidates.length)];
    targetRef.current = targetLetter;
    setTarget(targetLetter);

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
    candidates.forEach((L) => {
      const character = buildLetterCharacter(font, { letter: L });
      const spawn = pickClearSpawn(engine.obstacles, taken, { minRadius: minR, maxRadius: maxR }, 1.0, rng);
      character.group.position.set(spawn.x, 0, spawn.z);
      taken.push({ x: spawn.x, z: spawn.z, radius: 1.0 });
      character.faceTowards(engine.camera.position.x, engine.camera.position.z);
      engine.scene.add(character.group);
      engine.addActor(character);
      lettersRef.current.push({ letter: L, character });
    });

    // Voice: play the prompt the first round, then the target sound.
    setTimeout(() => {
      audio.stop();
      const playSound = () => audio.play(audio.letterSound(targetLetter), { interrupt: false });
      if (roundIndex === 0) {
        audio.play(audio.prompt("sound-match")).then(playSound);
      } else {
        playSound();
      }
    }, 400);
  };

  const onEngineReady = (engine: Engine) => {
    engineRef.current = engine;
    bootstrap(engine);
  };

  const bootstrap = async (engine: Engine) => {
    const font = await loadFont();
    buildRound(engine, font, 0);

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
          break;
        }
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
      const next = round + 1;
      setRound(next);
      if (next >= ROUNDS_PER_GAME) {
        setCompleted(true);
        playWoo();
        await audio.play(audio.randomCelebrate());
        lockRef.current = false;
        return;
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

  const onReplayPrompt = () => {
    audio.stop();
    if (target) audio.play(audio.letterSound(target));
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
      <HUD
        title={completed ? "Great work!" : `Round ${round + 1} of ${ROUNDS_PER_GAME}`}
        prompt={completed ? "You matched them all!" : `Listen, then ${moveVerb(avatar)} to the matching letter.`}
        onReplayPrompt={onReplayPrompt}
      />
    </div>
  );
}
