import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Scene } from "../world/Scene";
import { HUD } from "../ui/HUD";
import { audio } from "../audio/Player";
import { playChime, playWoo } from "../audio/sfx";
import { Engine } from "../engine/Engine";
import { buildLetterCharacter, distanceXZ, loadFont, makeSharedLetterAssets } from "../engine/letters";
import { makeBurst } from "../engine/particles";
import { pickClearSpawn } from "../engine/world";
import { SPELL_WORDS } from "../audio/types";
import { useGameStore } from "../state/store";
import {
  getWordAsset,
  loadCreatureGeometry,
  type WordAssetHandles,
} from "../engine/wordAssets";

// "Spell-the-Word" adventure: pick a missing-pet word, scatter the letters
// around the world avoiding obstacles, and walk over them in order. On
// completion the screen pauses with a "Next Word!" button so the kid can
// savour the celebration before the next round.

const COLLECT_DIST = 1.7;
const HINT_AFTER_SECONDS = 35;
const SPAWN_INNER = 7;
const SPAWN_OUTER = 18;

type LetterEntry = {
  letter: string;
  index: number;
  character: ReturnType<typeof buildLetterCharacter>;
};

// Weighted pick: bias toward words the kid hasn't mastered yet. Weight is
// 1 / (1 + min(timesSpelled, CAP)), so a brand-new word (count 0) is ~7x
// likelier than a fully-mastered one — but every word keeps a non-zero
// weight (the CAP floors it at 1/7), so mastered words still resurface for
// spaced review and nothing ever drops out of rotation. counts come from
// the store's persisted spellWordCounts. The immediately-previous word is
// still excluded so the same word never repeats back-to-back.
const MASTERY_CAP = 6;
function pickWord(prevWord: string | undefined, counts: Record<string, number>) {
  const choices = SPELL_WORDS.filter((w) => w.word !== prevWord);
  const pool = choices.length ? choices : SPELL_WORDS;
  const weights = pool.map((w) => 1 / (1 + Math.min(counts[w.word] ?? 0, MASTERY_CAP)));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < pool.length; i++) {
    if ((r -= weights[i]) <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}

export function SpellWordGame() {
  const collect = useGameStore((s) => s.collect);
  const letterCase = useGameStore((s) => s.letterCase);
  // Use roundKey to force a remount when "Next Word!" is pressed.
  const [roundKey, setRoundKey] = useState(0);
  const [prevWord, setPrevWord] = useState<string | undefined>();
  // Track the case used on the previous word so "mixed" actually
  // alternates instead of randomly landing on the same case twice in
  // a row. Initialised null so the very first round rolls freely.
  const [prevLowercase, setPrevLowercase] = useState<boolean | null>(null);
  return (
    <SpellWordRound
      key={roundKey}
      prevWord={prevWord}
      prevLowercase={prevLowercase}
      letterCase={letterCase}
      onNext={(w, lc) => {
        setPrevWord(w);
        setPrevLowercase(lc);
        setRoundKey((n) => n + 1);
      }}
      collect={collect}
    />
  );
}

function SpellWordRound({
  prevWord,
  prevLowercase,
  letterCase,
  onNext,
  collect,
}: {
  prevWord?: string;
  prevLowercase: boolean | null;
  letterCase: "uppercase" | "lowercase" | "mixed";
  onNext: (justFinished: string, lowercase: boolean) => void;
  collect: (letter: string) => void;
}) {
  const word = useMemo(
    () => pickWord(prevWord, useGameStore.getState().spellWordCounts),
    [prevWord],
  );
  // Roll the case for THIS word. Uppercase / lowercase modes are pinned;
  // "mixed" flips deterministically from the previous round when one
  // exists, otherwise it rolls randomly. Computed once so a re-render
  // (e.g. progress update) doesn't re-roll mid-round.
  const lowercase = useMemo(() => {
    if (letterCase === "uppercase") return false;
    if (letterCase === "lowercase") return true;
    return prevLowercase === null ? Math.random() < 0.5 : !prevLowercase;
    // Re-rolls only when we move to a new round (new word picked).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [word]);
  const displayWord = lowercase ? word.word.toLowerCase() : word.word;
  const [foundCount, setFoundCount] = useState(0);
  const [completed, setCompleted] = useState(false);
  const engineRef = useRef<Engine | null>(null);
  const lettersRef = useRef<LetterEntry[]>([]);
  const lastProgressRef = useRef(performance.now());
  const currentIndex = useRef(0);
  const hintScheduledRef = useRef(false);
  // Position of the most recently collected letter. Until the player
  // physically walks out of its COLLECT_DIST radius we suppress further
  // pickups, so two duplicate letters that happen to spawn close
  // together (the TREE/BOOK problem) don't collapse into a single
  // stand-still chain-collect.
  const lastCollectPosRef = useRef<{ x: number; z: number } | null>(null);
  // Optional 3D payoff (cat / dog / etc.) spawned when the kid finishes
  // spelling the word. Held in a ref so the unmount cleanup can dispose
  // it even if the kid taps Next-Word mid-animation. Words without an
  // entry in WORD_ASSETS just keep the existing audio-only reveal.
  const payoffRef = useRef<WordAssetHandles | null>(null);
  const payoffActorRef = useRef<{ update: (dt: number, t: number) => void } | null>(null);

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
    // Letters that appear more than once in the word (e.g. the two Es
    // in TREE) need extra spacing — otherwise both can land within
    // COLLECT_DIST of the same spot and the kid picks them up in
    // back-to-back frames, looking like the game accepted T, R, E as
    // a complete spelling. The bumped keep-out radius (2.5 vs 1.0)
    // forces the next instance to spawn well beyond 2 * COLLECT_DIST
    // (1.7 m × 2 = 3.4 m) from the previous one.
    const letterCounts = word.word.split("").reduce<Record<string, number>>((acc, L) => {
      acc[L] = (acc[L] ?? 0) + 1;
      return acc;
    }, {});
    // Shared bag of fixed-look letter materials/geometries reused
    // across every letter in the word.
    const sharedLetterAssets = makeSharedLetterAssets();
    const letters: LetterEntry[] = word.word.split("").map((L, i) => {
      const spawn = pickClearSpawn(engine.obstacles, taken, { minRadius: SPAWN_INNER, maxRadius: SPAWN_OUTER }, 1.0, rng, engine.isWalkable);
      const baseY = engine.terrainHeight?.(spawn.x, spawn.z) ?? 0;
      const character = buildLetterCharacter(font, { letter: L, lowercase, baseY, shared: sharedLetterAssets });
      character.group.position.set(spawn.x, baseY, spawn.z);
      const keepoutRadius = (letterCounts[L] ?? 1) > 1 ? 2.5 : 1.0;
      taken.push({ x: spawn.x, z: spawn.z, radius: keepoutRadius });
      // Initial face-toward-camera so it's right on first paint.
      character.faceTowards(engine.camera.position.x, engine.camera.position.z);
      engine.scene.add(character.group);
      engine.addActor(character);
      return { letter: L, index: i, character };
    });
    lettersRef.current = letters;

    engine.tickHook = (_dt, _t, playerPos) => {
      // Keep every letter facing the camera every frame, and push the
      // current player distance in so each letter can react softly when
      // the kid approaches (subtle glow boost + one-shot greeting wave).
      for (const entry of lettersRef.current) {
        entry.character.faceTowards(engine.camera.position.x, engine.camera.position.z);
        const d = distanceXZ(playerPos, entry.character.positionXZ());
        entry.character.setPlayerProximity(d);
      }
      // After a pickup, gate the next collection on the player having
      // physically walked out of the previous letter's radius. Without
      // this guard, two same-letter spawns that landed close (worst
      // case: pickClearSpawn fallback ignored the taken list) would
      // both collect from a single stand-still position.
      if (lastCollectPosRef.current) {
        const dx = playerPos.x - lastCollectPosRef.current.x;
        const dz = playerPos.z - lastCollectPosRef.current.z;
        if (Math.hypot(dx, dz) < COLLECT_DIST + 0.4) {
          // Still inside the previous pickup's bubble — keep waiting.
        } else {
          lastCollectPosRef.current = null;
        }
      }
      // Any uncollected letter whose character matches the one we need
      // counts as a valid pickup. Words with duplicate letters (TREE,
      // BOOK, EGG …) would otherwise be blocked: the kid sees two
      // identical Es but only one of them — the one at the exact
      // current index — could be collected, and walking onto the
      // "wrong" identical letter looked like a silent broken game.
      const required = word.word[currentIndex.current];
      if (required === undefined) return;
      if (lastCollectPosRef.current) return; // gated above
      for (const candidate of lettersRef.current) {
        if (candidate.character.isCollected) continue;
        if (candidate.letter !== required) continue;
        if (distanceXZ(playerPos, candidate.character.positionXZ()) < COLLECT_DIST) {
          const pos = candidate.character.positionXZ();
          lastCollectPosRef.current = { x: pos.x, z: pos.z };
          collectLetter(engine, candidate, playerPos);
          break;
        }
      }
      const since = (performance.now() - lastProgressRef.current) / 1000;
      if (since > HINT_AFTER_SECONDS && !hintScheduledRef.current) {
        hintScheduledRef.current = true;
        audio.play(audio.randomHint()).then(() => {
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
      // Record the spelling — every Nth completion of the same word
      // awards that word's trophy (Cat Catcher fires after 5 CATs,
      // ×2 after 10, etc.). The store also auto-fires Word Wizard
      // when the kid crosses 25 total completions across any words.
      useGameStore.getState().recordSpellCompletion(word.word);
      // 3D payoff — words with a registered WordAsset (cat, dog, …)
      // spawn the creature in front of the kid and animate it in.
      // Words without an asset keep the existing audio-only reveal.
      spawnPayoff(engine, playerPos);
      // playSequence respects the audio Player's sequenceVersion guard,
      // so when the kid taps "Next word" mid-reveal the celebration
      // clip won't fire afterwards and clobber the next round's prompt.
      // A bare reveal.then(celebrate) chain was firing celebrate even
      // after stop() resolved the reveal — the .then() doesn't know
      // about the interrupt.
      setTimeout(() => {
        void audio.playSequence([
          `reveal-spell-${word.word}`,
          audio.randomCelebrate(),
        ]);
      }, 700);
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
      // Tear down the optional 3D payoff. The actor wrapper above just
      // forwards ticks; we drop both halves so HMR and Next-Word
      // remounts don't leave a creature standing in the world.
      if (payoffActorRef.current) {
        engine.removeActor(payoffActorRef.current);
        payoffActorRef.current = null;
      }
      if (payoffRef.current) {
        engine.scene.remove(payoffRef.current.group);
        payoffRef.current.dispose();
        payoffRef.current = null;
      }
      engine.tickHook = undefined;
    };
  }, []);

  // Build + mount the 3D payoff for this word, if one is registered.
  // Spawns at the player's current position, oriented so the creature
  // walks toward the camera (negative Z) on entry. No-op for words
  // without a WordAsset entry.
  const spawnPayoff = (engine: Engine, playerPos: THREE.Vector3) => {
    const asset = getWordAsset(word.word);
    if (!asset) return;
    const geometry = loadCreatureGeometry(word.word);
    const handles = asset.build(geometry);
    // Spawn point: a couple metres in front of the kid (world +Z is
    // toward the chase camera). Walker translates along its local +X
    // so the creature trots in from camera-left and lands centred on
    // this spot. We rotate slightly so the face angles toward the
    // camera once it stops, instead of staring sideways across the
    // frame.
    const endX = playerPos.x;
    const endZ = playerPos.z + 2;
    handles.group.position.set(endX, engine.terrainHeight?.(endX, endZ) ?? 0, endZ);
    handles.group.rotation.y = -Math.PI / 6;
    engine.scene.add(handles.group);
    payoffRef.current = handles;
    const actor = {
      update(dt: number, t: number) {
        handles.tick(dt, t);
      },
    };
    engine.addActor(actor);
    payoffActorRef.current = actor;
  };

  const targets = displayWord.split("").map((L, i) => ({ letter: L, found: i < foundCount }));

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <Scene onEngineReady={onEngineReady} />
      <HUD
        title={`Spell: ${displayWord}`}
        prompt={completed ? "🎉 You spelled it!" : `Find the next letter: ${displayWord[foundCount]}`}
        targets={targets}
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
            onClick={() => onNext(word.word, lowercase)}
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
