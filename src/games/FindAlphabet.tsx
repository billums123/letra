import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Scene } from "../world/Scene";
import { HUD } from "../ui/HUD";
import { audio } from "../audio/Player";
import { music } from "../audio/music";
import { CELEBRATION_TRACK, CELEBRATION_BPM, pickGameTrack } from "../audio/songs";
import { playChime, playWoo } from "../audio/sfx";
import { Engine } from "../engine/Engine";
import { buildLetterCharacter, distanceXZ, loadFont } from "../engine/letters";
import { makeBurst, makeFirework } from "../engine/particles";
import { pickClearSpawn } from "../engine/world";
import { ALPHABET } from "../audio/types";
import { useGameStore, type AvatarKind } from "../state/store";
import { isDev } from "../util/isDev";

// Find the alphabet from A to Z. Letters scattered in a wide ring; the kid
// walks to each in order. The current target pulses on the HUD and the world.
//
// Once all 26 are collected the game shifts into a dance-party finale:
// every letter teleports into a ring around the player, the celebration
// music kicks in, and each letter dances on the beat. Bumping a letter
// during the party launches a firework instead of speaking the name.

const COLLECT_DIST = 1.6;
const RING_INNER = 6;
const RING_OUTER = 30;
const HINT_AFTER_SECONDS = 40;

// Dance-party tuning. Letters arrange in a ring around the player at
// finale time and pick a randomized dance style apiece.
const DANCE_RING_RADIUS = 5.8;
const DANCE_STYLES = ["bounce", "sway", "spin", "pulse", "hop"] as const;
type DanceStyle = (typeof DANCE_STYLES)[number];

type LetterEntry = {
  letter: string;
  index: number;
  character: ReturnType<typeof buildLetterCharacter>;
  // Filled in once the dance party starts.
  dance?: {
    style: DanceStyle;
    phaseOffset: number; // 0..1 in beats, so different letters peak at different moments
    homeX: number;
    homeZ: number;
  };
};

// Avatar-aware prompt id and verb. Walking is the default; if the kid is
// driving the car we swap to the "drive" wording so the audio matches what
// they're actually doing on screen.
function alphabetPromptId(avatar: AvatarKind): string {
  if (avatar === "car") return "prompt-find-alphabet-drive";
  if (avatar === "rocket") return "prompt-find-alphabet-fly";
  return "prompt-find-alphabet";
}
function moveVerb(avatar: AvatarKind): string {
  if (avatar === "car") return "Drive";
  if (avatar === "rocket") return "Fly";
  return "Walk";
}

export function FindAlphabetGame() {
  const collect = useGameStore((s) => s.collect);
  const avatar = useGameStore((s) => s.avatar);
  const letterCase = useGameStore((s) => s.letterCase);
  // Decide each letter's display case once at mount so the HUD can
  // render the right glyphs on the very first frame (before bootstrap
  // has finished building characters). The bootstrap reads the same
  // array so on-screen letters and HUD always agree.
  const displayLetters = useMemo<string[]>(() => {
    return ALPHABET.map((L) => {
      if (letterCase === "lowercase") return L.toLowerCase();
      if (letterCase === "mixed" && Math.random() < 0.5) return L.toLowerCase();
      return L;
    });
    // letterCase is read once per mount — ignore later changes so a
    // store flip doesn't reshuffle in the middle of a round.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [foundCount, setFoundCount] = useState(0);
  const [completed, setCompleted] = useState(false);
  const engineRef = useRef<Engine | null>(null);
  const lettersRef = useRef<LetterEntry[]>([]);
  const currentIndex = useRef(0);
  const hintScheduledRef = useRef(false);
  const lastProgressRef = useRef(performance.now());
  // Letters the kid was already overlapping last frame — used to fire
  // the "wrong letter" nudge only on the rising edge of contact, not
  // every frame they sit on top of an already-bumped letter.
  const prevWrongOverlapRef = useRef<Set<string>>(new Set());
  // Per-letter cooldown so re-driving onto a recently-bumped wrong
  // letter doesn't re-trigger the audio. Stored as a wall-clock
  // timestamp keyed by glyph; a fresh nudge requires the cooldown
  // window to have elapsed since the last nudge for that letter.
  const wrongLetterCooldownRef = useRef<Map<string, number>>(new Map());
  // Suppress overlapping nudges — if one is mid-flight we don't want
  // a second one stomping on it.
  const wrongNudgeBusyRef = useRef(false);
  // Dance-party state. Held in refs so the engine tickHook (a long-
  // lived closure) can read them without restarting on every state
  // change.
  const danceModeRef = useRef(false);
  const danceStartRef = useRef(0);
  const fontRef = useRef<Awaited<ReturnType<typeof loadFont>> | null>(null);

  // We can't pre-compute spawn positions without the engine's obstacle list,
  // so they're chosen during bootstrap. The spiral is then used as a *seed*
  // for retry attempts that respect the obstacle layout.
  const onEngineReady = (engine: Engine) => {
    engineRef.current = engine;
    bootstrap(engine);
  };

  const bootstrap = async (engine: Engine) => {
    const font = await loadFont();
    fontRef.current = font;
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
      // displayLetters was decided at mount time so the HUD and the
      // characters rendered into the world stay in lockstep. Audio and
      // the collected sticker still key on the uppercase glyph.
      const lowercase = displayLetters[i] !== L;
      // Try a spiral position first; if obstructed, pickClearSpawn retries.
      const t = i / ALPHABET.length;
      const minR = Math.max(RING_INNER, RING_INNER + t * 4);
      const maxR = Math.min(RING_OUTER, RING_INNER + t * (RING_OUTER - RING_INNER) + 6);
      const spawn = pickClearSpawn(engine.obstacles, taken, { minRadius: minR, maxRadius: maxR }, 1.0, rng);
      const baseY = engine.terrainHeight?.(spawn.x, spawn.z) ?? 0;
      const character = buildLetterCharacter(font, { letter: L, lowercase, baseY });
      character.group.position.set(spawn.x, baseY, spawn.z);
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
      if (danceModeRef.current) {
        runDanceTick(engine, playerPos);
        return;
      }
      const next = lettersRef.current[currentIndex.current];
      if (!next) return;
      const d = distanceXZ(playerPos, next.character.positionXZ());
      if (d < COLLECT_DIST && !next.character.isCollected) {
        collectLetter(engine, next, playerPos);
      }

      // Wrong-letter nudges: the kid drove onto a letter that isn't
      // the current target. Each wrong contact (rising edge only) plays
      // the bumped letter's name and reminds them of the target. We
      // throttle per-letter so a kid pressed against a wrong letter
      // hears the nudge once, not every frame.
      const targetLetter = next.letter;
      const currentOverlap = new Set<string>();
      for (const entry of lettersRef.current) {
        if (entry.character.isCollected) continue;
        if (entry.letter === targetLetter) continue;
        const dist = distanceXZ(playerPos, entry.character.positionXZ());
        if (dist < COLLECT_DIST) currentOverlap.add(entry.letter);
      }
      if (!wrongNudgeBusyRef.current) {
        const now = performance.now();
        for (const L of currentOverlap) {
          if (prevWrongOverlapRef.current.has(L)) continue; // already bumped
          const lastNudgedAt = wrongLetterCooldownRef.current.get(L) ?? 0;
          if (now - lastNudgedAt < 4000) continue;          // cooldown
          // Fire the nudge: bumped letter's name, then the target's.
          wrongLetterCooldownRef.current.set(L, now);
          wrongNudgeBusyRef.current = true;
          // No celebrate animation — the wrong letter shouldn't look
          // like it earned a victory dance. Audio: bumped letter's
          // name, then a random "whoops, not quite" nudge clip.
          audio.stop();
          audio
            .play(audio.letterName(L))
            .then(() =>
              audio.play(audio.randomWrongNudge(), { interrupt: false }),
            )
            .finally(() => {
              wrongNudgeBusyRef.current = false;
            });
          break; // only one nudge per frame
        }
      }
      prevWrongOverlapRef.current = currentOverlap;

      const since = (performance.now() - lastProgressRef.current) / 1000;
      if (since > HINT_AFTER_SECONDS && !hintScheduledRef.current) {
        hintScheduledRef.current = true;
        audio.play(audio.randomHint()).then(() => {
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
      // Award the case-specific alphabet trophy. The earned-modal will
      // pop over the dance party, which is fine — the kid taps "Yay!"
      // and is dropped right back into the celebration.
      const trophyId =
        letterCase === "lowercase"
          ? "alphabet-lower"
          : letterCase === "mixed"
            ? "alphabet-mixed"
            : "alphabet-upper";
      useGameStore.getState().awardTrophy(trophyId);
      // Brief pause so the player hears the final letter name + woo
      // before the dance music takes over.
      setTimeout(() => startDanceParty(engine), 700);
    }
  };

  // ── Dance party finale ────────────────────────────────────────────
  // Teleport every letter into a ring around the player, hand each a
  // randomized dance style + beat-phase offset, swap the music to the
  // celebration track, and flip into dance-mode tickHook.
  const startDanceParty = (engine: Engine) => {
    const player = engine.player.position();
    const cx = player.x;
    const cz = player.z;
    // Stop any in-flight letter-name speech so the music takes the foreground.
    audio.flushQueue();
    audio.stop();
    void audio.play(audio.randomCelebrate());
    void music.play(CELEBRATION_TRACK, 0.22);
    // Mark the dance start the moment we kick off — beat phase is
    // computed from wall clock against this anchor. Music starts a
    // tick or two later but the offset is imperceptible.
    danceStartRef.current = performance.now();
    danceModeRef.current = true;
    const letters = lettersRef.current;
    for (let i = 0; i < letters.length; i++) {
      const entry = letters[i];
      // Even angular spacing around the player.
      const angle = (i / letters.length) * Math.PI * 2;
      const homeX = cx + Math.cos(angle) * DANCE_RING_RADIUS;
      const homeZ = cz + Math.sin(angle) * DANCE_RING_RADIUS;
      const homeY = engine.terrainHeight?.(homeX, homeZ) ?? 0;
      entry.character.setBaseY(homeY);
      entry.character.group.position.set(homeX, homeY, homeZ);
      // Reset any rotation/scale from earlier celebrate() calls so the
      // dance starts from a clean baseline.
      entry.character.group.rotation.set(0, 0, 0);
      entry.character.group.scale.setScalar(1);
      entry.dance = {
        style: DANCE_STYLES[i % DANCE_STYLES.length],
        // Stagger phases so all 26 don't peak in unison — every other
        // letter offsets by half a beat.
        phaseOffset: (i % 4) / 4,
        homeX,
        homeZ,
      };
    }
    // Kick off a firework round one for the moment of victory.
    const fw = makeFirework(player.clone(), 60);
    engine.scene.add(fw.group);
    engine.addActor({
      update(dt, t) {
        const alive = fw.update(dt, t);
        if (!alive) {
          engine.scene.remove(fw.group);
          engine.removeActor(this);
        }
      },
    });
  };

  // Per-frame dance update. Drives every letter's transform from the
  // current beat phase and also detects the player bumping into one
  // (which triggers a firework rather than speaking the name).
  const runDanceTick = (engine: Engine, playerPos: THREE.Vector3) => {
    const elapsed = (performance.now() - danceStartRef.current) / 1000;
    // Beat phase: 0..1 within a single beat at CELEBRATION_BPM. Every
    // letter reads from this same clock, so the choreography stays in
    // sync as long as the music itself holds tempo.
    const beatsPerSec = CELEBRATION_BPM / 60;
    for (const entry of lettersRef.current) {
      if (!entry.dance) continue;
      const d = entry.dance;
      const phase = (elapsed * beatsPerSec + d.phaseOffset) % 1;
      const g = entry.character.group;
      // Reset to home each frame so the previous frame's offsets don't
      // accumulate.
      g.position.x = d.homeX;
      g.position.z = d.homeZ;
      g.position.y = 0;
      g.rotation.set(0, 0, 0);
      g.scale.setScalar(1);
      // Apply the chosen dance style. Each peaks at phase=0.5 (the
      // off-beat — between kicks) so the visual feels like the letter
      // is lifting and dropping with the music.
      switch (d.style) {
        case "bounce": {
          // Sharp pop up on each beat.
          g.position.y = Math.abs(Math.sin(phase * Math.PI)) * 0.9;
          break;
        }
        case "sway": {
          g.rotation.z = Math.sin(phase * Math.PI * 2) * 0.35;
          g.position.y = 0.05 + (Math.cos(phase * Math.PI * 2) * 0.5 + 0.5) * 0.1;
          break;
        }
        case "spin": {
          // One full rotation every two beats.
          g.rotation.y = (elapsed * beatsPerSec * Math.PI) + d.phaseOffset * Math.PI * 2;
          g.position.y = 0.15 + Math.sin(phase * Math.PI) * 0.18;
          break;
        }
        case "pulse": {
          const s = 1 + Math.sin(phase * Math.PI) * 0.18;
          g.scale.setScalar(s);
          g.position.y = 0.05;
          break;
        }
        case "hop": {
          // Hop forward and back — translates inward toward the player
          // on the down-beat, outward on the up-beat.
          const inOut = Math.sin(phase * Math.PI * 2) * 0.4;
          const dirX = playerPos.x - d.homeX;
          const dirZ = playerPos.z - d.homeZ;
          const len = Math.hypot(dirX, dirZ) || 1;
          g.position.x = d.homeX + (dirX / len) * inOut;
          g.position.z = d.homeZ + (dirZ / len) * inOut;
          g.position.y = Math.abs(Math.sin(phase * Math.PI * 2)) * 0.55;
          break;
        }
      }
    }
    // Bump-to-firework: while dancing, contact spawns a firework on
    // the bumped letter rather than speaking its name. Each letter
    // can fire once per second so a kid pressing into one doesn't
    // spawn a stack of effects every frame.
    for (const entry of lettersRef.current) {
      if (!entry.dance) continue;
      const lp = entry.character.positionXZ();
      const d = distanceXZ(playerPos, lp);
      if (d < COLLECT_DIST + 0.4) {
        const now = performance.now();
        const lastFW = (entry.character.group.userData.lastFireworkAt as number | undefined) ?? 0;
        if (now - lastFW < 900) continue;
        entry.character.group.userData.lastFireworkAt = now;
        const pos = new THREE.Vector3(lp.x, 0, lp.z);
        const fw = makeFirework(pos, 28);
        engine.scene.add(fw.group);
        engine.addActor({
          update(dt, t) {
            const alive = fw.update(dt, t);
            if (!alive) {
              engine.scene.remove(fw.group);
              engine.removeActor(this);
            }
          },
        });
        // No chime — makeFirework handles its own launch + burst SFX.
      }
    }
  };

  // ── Dev-only fast-forward ─────────────────────────────────────────
  // Pressing F on a localhost build marks letters A-Y collected and
  // moves the player a few steps from Z so the next pickup triggers
  // the dance-party finale. Hidden in production via isDev().
  useEffect(() => {
    if (!isDev()) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "f" && e.key !== "F") return;
      const engine = engineRef.current;
      if (!engine || danceModeRef.current) return;
      if (currentIndex.current >= ALPHABET.length - 1) return;
      // Mark every letter up to (but not including) the current target's
      // last sibling — i.e. fast-forward to needing only Z.
      const letters = lettersRef.current;
      for (let i = currentIndex.current; i < letters.length - 1; i++) {
        const entry = letters[i];
        if (!entry.character.isCollected) {
          entry.character.celebrate();
          collect(entry.letter);
        }
      }
      currentIndex.current = ALPHABET.length - 1;
      setFoundCount(ALPHABET.length - 1);
      lastProgressRef.current = performance.now();
      // Park the player ~3 units from Z so a single nudge collects it.
      const z = letters[ALPHABET.length - 1];
      if (z) {
        const zp = z.character.positionXZ();
        engine.player.group.position.set(zp.x + 3, 0, zp.z);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [collect]);

  useEffect(() => {
    return () => {
      const engine = engineRef.current;
      // Restore in-game music if we were in dance mode when the kid bailed.
      if (danceModeRef.current) {
        void music.play(pickGameTrack(), 0.16);
      }
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
  // doesn't get unreadably long. displayLetters is the source of truth
  // for case — same array the bootstrap reads when building characters.
  const windowSize = 10;
  const windowStart = Math.max(0, Math.min(foundCount - 2, ALPHABET.length - windowSize));
  const targets = displayLetters.slice(windowStart, windowStart + windowSize).map((L, i) => ({
    letter: L,
    found: windowStart + i < foundCount,
  }));
  const titleLetter = displayLetters[foundCount];

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <Scene onEngineReady={onEngineReady} />
      <HUD
        title={completed ? undefined : `Find: ${titleLetter ?? "🎉"}`}
        prompt={completed ? undefined : `${moveVerb(avatar)} to the next letter!`}
        targets={completed ? undefined : targets}
      />
    </div>
  );
}
