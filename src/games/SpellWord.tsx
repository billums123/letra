import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { Scene } from "../world/Scene";
import { HUD } from "../ui/HUD";
import { audio } from "../audio/Player";
import { playChime } from "../audio/sfx";
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
import { SPELL_WORDS } from "../audio/types";
import { useGameStore } from "../state/store";
import { openCue, openWay, openWayClip, shutWay } from "./travelGate";
import {
  getWordAsset,
  loadCreatureGeometry,
  type WordAssetHandles,
} from "../engine/wordAssets";

// "Spell-the-Word" adventure: pick a missing-pet word, scatter the letters
// around whatever world the kid is standing on, and walk over them in order.
//
// Spelling the word is also what opens the way onward. Finish one in the
// ocean and the volcano wakes up; ride it to a planet and the pools home
// stay dark until you have spelled another one up there. So a round is
// never just a round — it is the toll for the next place. See
// ./travelGate.ts for the rule and src/engine/biomes/ocean.ts for the
// rides it governs.
//
// The scene is built once and kept. Rounds tear their own letters down and
// plant fresh ones, because remounting it would rebuild the world — and
// rebuilding the world would drop a kid standing on the sun back into the
// sea, which is precisely the trip they were about to earn.

const COLLECT_DIST = 1.7;
const HINT_AFTER_SECONDS = 35;
// Where letters land. On the flat sea this is distance from the middle
// of the world; on a sphere it is how far the kid has to drive along
// the surface to reach one. See pickSpot.
const SPAWN_INNER = 7;
const SPAWN_OUTER = 18;

type Font = Awaited<ReturnType<typeof loadFont>>;

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

  const [displayWord, setDisplayWord] = useState("");
  const [foundCount, setFoundCount] = useState(0);
  const [completed, setCompleted] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);

  const engineRef = useRef<Engine | null>(null);
  const fontRef = useRef<Font | null>(null);
  const lettersRef = useRef<FieldLetter[]>([]);
  // The round, held in refs because the engine tick hook is a single
  // long-lived closure installed at bootstrap.
  const wordRef = useRef<(typeof SPELL_WORDS)[number] | null>(null);
  const surfaceRef = useRef<Surface>(FLAT_SURFACE);
  const currentIndex = useRef(0);
  const completedRef = useRef(false);
  const prevWordRef = useRef<string | undefined>(undefined);
  // Case used on the previous word, so "mixed" alternates instead of
  // randomly landing on the same case twice running, and the case of
  // the word currently up, so carrying it to another world doesn't
  // change it out from under the kid.
  const prevLowercaseRef = useRef<boolean | null>(null);
  const lowercaseRef = useRef(false);
  const lastProgressRef = useRef(performance.now());
  const hintScheduledRef = useRef(false);
  // Position of the most recently collected letter. Until the kid
  // physically leaves its radius we suppress further pickups, so two
  // duplicate letters that happened to spawn close together (the
  // TREE / BOOK problem) don't collapse into one stand-still chain.
  const lastCollectRef = useRef<THREE.Vector3 | null>(null);
  // Optional 3D payoff (cat / dog / …) spawned on completion.
  const payoffRef = useRef<WordAssetHandles | null>(null);
  const payoffActorRef = useRef<{ update: (dt: number, t: number) => void } | null>(null);

  const clearLetters = () => {
    for (const l of lettersRef.current) l.remove();
    lettersRef.current = [];
  };

  const clearPayoff = (engine: Engine) => {
    if (payoffActorRef.current) {
      engine.removeActor(payoffActorRef.current);
      payoffActorRef.current = null;
    }
    if (payoffRef.current) {
      const g = payoffRef.current.group;
      g.parent?.remove(g);
      payoffRef.current.dispose();
      payoffRef.current = null;
    }
  };

  // Lay a word out wherever the avatar is standing. Called on
  // bootstrap, from the Next-Word button, and every time the kid lands
  // on a new world.
  //
  // `carry` keeps the word that is already up. Arriving somewhere new
  // in the middle of hunting for PIG and being told to find BUS
  // instead is the game changing its mind, and a four-year-old who was
  // just told what to look for has no way to read that as anything but
  // their own mistake. The pig went to the sun; we are still after the
  // pig. A word that has already been spelled is finished, though, so
  // that one does roll over to a new one.
  const startRound = (engine: Engine, font: Font, carry = false) => {
    clearLetters();
    clearPayoff(engine);
    audio.stop();

    const held = carry && wordRef.current && !completedRef.current ? wordRef.current : null;
    const word = held ?? pickWord(prevWordRef.current, useGameStore.getState().spellWordCounts);
    const lowercase = held
      ? lowercaseRef.current
      : letterCase === "uppercase"
        ? false
        : letterCase === "lowercase"
          ? true
          : prevLowercaseRef.current === null
            ? Math.random() < 0.5
            : !prevLowercaseRef.current;
    prevWordRef.current = word.word;
    if (!held) prevLowercaseRef.current = lowercase;
    lowercaseRef.current = lowercase;
    wordRef.current = word;
    currentIndex.current = 0;
    completedRef.current = false;
    lastCollectRef.current = null;
    lastProgressRef.current = performance.now();
    hintScheduledRef.current = false;
    setFoundCount(0);
    setCompleted(false);
    setDisplayWord(lowercase ? word.word.toLowerCase() : word.word);

    const surface = engine.surface;
    surfaceRef.current = surface;
    const rng = makeRng(word.word.charCodeAt(0) * 31 + word.word.length);
    // Letters appearing more than once in a word (the two Es in TREE)
    // need extra spacing — otherwise both can land within COLLECT_DIST
    // of one spot and the kid picks them up in back-to-back frames,
    // which looks like the game accepted T, R, E as a whole spelling.
    const counts = word.word.split("").reduce<Record<string, number>>((acc, L) => {
      acc[L] = (acc[L] ?? 0) + 1;
      return acc;
    }, {});
    const shared = makeSharedLetterAssets();
    const taken: { x: number; z: number; radius: number }[] = [];
    const planetTaken: KeepOut[] = [];
    const keepOut = surface.kind === "planet" ? (surface.spec.noBuild ?? []) : [];
    const around = engine.player.position().clone();

    for (const L of word.word.split("")) {
      const spot = pickSpot(engine, surface, {
        taken,
        planetTaken,
        keepOut,
        around,
        minRange: SPAWN_INNER,
        maxRange: SPAWN_OUTER,
        takenRadius: (counts[L] ?? 1) > 1 ? 2.5 : 1,
        rng,
      });
      const letter = plantLetter(engine, font, surface, spot, { letter: L, lowercase, shared });
      letter.faceCamera(engine.camera.position);
      lettersRef.current.push(letter);
    }

    setTimeout(() => void audio.play(audio.prompt(`spell-${word.word}`)), 250);
  };

  const onEngineReady = (engine: Engine) => {
    engineRef.current = engine;
    void bootstrap(engine);
  };

  const bootstrap = async (engine: Engine) => {
    const font = await loadFont();
    fontRef.current = font;
    // The gate starts shut: the ocean has to be earned like anywhere
    // else, or the very first ride is free.
    shutWay(engine);
    startRound(engine, font);

    // Landing somewhere new. The gate shuts behind the kid, and the
    // word they were on comes with them — that is the whole loop:
    // spell, ride, spell.
    engine.onSurfaceChange = () => {
      shutWay(engine);
      setBanner(null);
      startRound(engine, font, true);
    };

    // Same world, different floor: down the whirlpool and back. The
    // round carries on exactly as it was, on the ground the kid is
    // actually standing on.
    engine.onGroundChange = () => {
      replantLetters(engine, engine.surface, lettersRef.current, {
        around: engine.player.position().clone(),
        minRange: SPAWN_INNER,
        maxRange: SPAWN_OUTER,
        rng: makeRng(7),
      });
    };

    engine.tickHook = (_dt, _t, playerPos) => {
      const cam = engine.camera.position;
      for (const l of lettersRef.current) {
        l.faceCamera(cam);
        l.character.setPlayerProximity(l.distanceTo(playerPos));
      }
      const word = wordRef.current;
      if (!word) return;
      // After a pickup, gate the next one on the kid having physically
      // left the previous letter's radius.
      if (lastCollectRef.current) {
        if (lastCollectRef.current.distanceTo(playerPos) < COLLECT_DIST + 0.4) return;
        lastCollectRef.current = null;
      }
      const required = word.word[currentIndex.current];
      if (required === undefined) return;
      // No collecting while a launch is flying the avatar over the map.
      if (engine.inFlight) return;
      // Any uncollected letter matching the one we need counts. Words
      // with duplicate letters would otherwise be blocked: the kid
      // sees two identical Es but only the one at the exact current
      // index could be taken, and walking onto the "wrong" identical
      // letter looked like a silently broken game.
      for (const candidate of lettersRef.current) {
        if (candidate.character.isCollected) continue;
        if (candidate.letter !== required) continue;
        if (candidate.distanceTo(playerPos) < COLLECT_DIST) {
          lastCollectRef.current = candidate.worldPos();
          collectLetter(engine, candidate, playerPos);
          break;
        }
      }
      const since = (performance.now() - lastProgressRef.current) / 1000;
      if (since > HINT_AFTER_SECONDS && !hintScheduledRef.current && !completedRef.current) {
        hintScheduledRef.current = true;
        void audio.play(audio.randomHint()).then(() => {
          lastProgressRef.current = performance.now();
          hintScheduledRef.current = false;
        });
      }
    };
  };

  const collectLetter = (engine: Engine, entry: FieldLetter, playerPos: THREE.Vector3) => {
    if (entry.character.isCollected) return;
    entry.character.celebrate();
    const burst = makeBurst(playerPos.clone());
    // Confetti flies "up" in its own frame, so on a star its frame has
    // to know which way that is.
    orientToSurface(burst.group, surfaceRef.current, playerPos);
    engine.scene.add(burst.group);
    engine.addActor({
      update(dt) {
        if (burst.update(dt, 0)) return;
        engine.scene.remove(burst.group);
        engine.removeActor(this);
      },
    });
    playChime();
    // playSequence cancels itself if anything interrupts, so we never
    // hear letter A's phonetic sound after the kid has moved on to B.
    void audio.playSequence([audio.letterName(entry.letter), audio.letterSound(entry.letter)]);
    collect(entry.letter);
    setFoundCount((n) => n + 1);
    currentIndex.current += 1;
    lastProgressRef.current = performance.now();

    const word = wordRef.current;
    if (!word || currentIndex.current < word.word.length) return;
    completedRef.current = true;
    setCompleted(true);
    // Record the spelling — every Nth completion of the same word
    // awards that word's trophy, and the store auto-fires Word Wizard
    // once the kid crosses the total threshold.
    useGameStore.getState().recordSpellCompletion(word.word);
    spawnPayoff(engine, playerPos);
    // The way opens now, not when the audio finishes: a kid who taps
    // straight past the celebration has still earned the ride.
    const surface = surfaceRef.current;
    const opened = openWay(engine);
    if (opened) setBanner(openCue(surface).banner);
    // The word's own reveal, then either the way onward or an ordinary
    // cheer. The line about the volcano waking up IS the celebration
    // when it fires, so nothing generic goes in front of it.
    setTimeout(() => {
      void audio.playSequence([
        `reveal-spell-${word.word}`,
        opened ? openWayClip(surface) : audio.randomCelebrate(),
      ]);
    }, 700);
  };

  // Build the optional 3D payoff for this word. Spawns just in front of
  // the kid, standing on whatever they are standing on.
  const spawnPayoff = (engine: Engine, playerPos: THREE.Vector3) => {
    const word = wordRef.current;
    if (!word) return;
    const asset = getWordAsset(word.word);
    if (!asset) return;
    const handles = asset.build(loadCreatureGeometry(word.word));
    const surface = surfaceRef.current;
    if (surface.kind === "flat") {
      const endX = playerPos.x;
      const endZ = playerPos.z + 2;
      handles.group.position.set(endX, engine.terrainHeight?.(endX, endZ) ?? 0, endZ);
      handles.group.rotation.y = -Math.PI / 6;
      engine.scene.add(handles.group);
    } else {
      // On a sphere the creature goes inside a mount standing on the
      // surface under the kid, so it walks along the ground rather
      // than off into the sky.
      const mount = new THREE.Group();
      mount.position.copy(playerPos);
      orientToSurface(mount, surface, playerPos);
      handles.group.position.set(0, 0, 2);
      handles.group.rotation.y = -Math.PI / 6;
      mount.add(handles.group);
      engine.scene.add(mount);
    }
    payoffRef.current = handles;
    const actor = {
      update(dt: number, t: number) {
        handles.tick(dt, t);
      },
    };
    engine.addActor(actor);
    payoffActorRef.current = actor;
  };

  useEffect(() => {
    return () => {
      const engine = engineRef.current;
      if (!engine) return;
      clearLetters();
      clearPayoff(engine);
      engine.tickHook = undefined;
      engine.onSurfaceChange = undefined;
      engine.onGroundChange = undefined;
      engine.travelOpen = true;
    };
  }, []);

  const targets = displayWord.split("").map((L, i) => ({ letter: L, found: i < foundCount }));

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <Scene onEngineReady={onEngineReady} />
      <HUD
        title={displayWord ? `Spell: ${displayWord}` : undefined}
        banner={banner ?? undefined}
        prompt={
          completed
            ? "🎉 You spelled it!"
            : displayWord
              ? `Find the next letter: ${displayWord[foundCount]}`
              : undefined
        }
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
            onClick={() => {
              const engine = engineRef.current;
              const font = fontRef.current;
              if (!engine || !font) return;
              setBanner(null);
              startRound(engine, font);
            }}
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

// Small deterministic-within-a-round PRNG, seeded fresh per call so the
// same word lands in a different layout each time it comes up.
function makeRng(salt: number): () => number {
  let s = (salt ^ ((Math.random() * 0xffffffff) | 0)) | 0;
  return () => {
    s = (s + 0x9e3779b9) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
