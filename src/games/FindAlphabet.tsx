import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Scene } from "../world/Scene";
import { HUD } from "../ui/HUD";
import { audio } from "../audio/Player";
import { music } from "../audio/music";
import { CELEBRATION_TRACK, CELEBRATION_BPM, pickGameTrack } from "../audio/songs";
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
  type Spot,
} from "../engine/letterField";
import { FLAT_SURFACE, type Surface } from "../engine/surface";
import { makeBurst, makeFirework } from "../engine/particles";
import { ALPHABET } from "../audio/types";
import { useGameStore, type AvatarKind } from "../state/store";
import { isDev } from "../util/isDev";
import { openCue, openWay, openWayClip, shutWay } from "./travelGate";
import { legSlice } from "./alphabetLegs";

// Find the alphabet from A to Z — spread across the worlds.
//
// It used to be all twenty-six at once, in one ring, on one map. That is
// a long way for a four-year-old to walk without anything happening, and
// once the ocean grew a sun and two gas giants to stand on, it was also
// twenty-six letters' worth of reason never to visit any of them.
//
// So the alphabet is dealt out a handful at a time. Clear the letters on
// the world you are on and the way onward opens — the volcano wakes, or
// the pools home light up — and wherever you land next is handed the next
// run of letters. The travel is the pacing: six letters, then a ride into
// space, then five more.
//
// Five legs, deliberately odd. The only way off a planet is home, so legs
// strictly alternate sea, planet, sea, planet, sea — which means the last
// one always falls in the ocean, and the dance-party finale always has a
// whole sea to spread twenty-six letters across.
//
// Once all 26 are collected the game shifts into that finale: every letter
// teleports into a ring around the player, the celebration music kicks in,
// and each letter dances on the beat. Bumping a letter during the party
// launches a firework instead of speaking the name.

const COLLECT_DIST = 1.6;
const RING_INNER = 6;
const RING_OUTER = 30;
// How far letters scatter on a sphere, measured along the surface from
// wherever the kid touched down. The far side of a star is a very long
// drive for a letter you cannot see.
const PLANET_INNER = 7;
const PLANET_OUTER = 24;
const HINT_AFTER_SECONDS = 40;

// Dance-party tuning. Letters arrange in a ring around the player at
// finale time and pick a randomized dance style apiece.
const DANCE_RING_RADIUS = 5.8;
const DANCE_STYLES = ["bounce", "sway", "spin", "pulse", "hop"] as const;
type DanceStyle = (typeof DANCE_STYLES)[number];

type Font = Awaited<ReturnType<typeof loadFont>>;

type LetterEntry = {
  letter: string;
  index: number;
  field: FieldLetter;
  // Filled in once the dance party starts. Coordinates are in the
  // letter's own frame — world space on the sea, tangent-plane metres
  // on a sphere — so one set of choreography drives both.
  dance?: {
    style: DanceStyle;
    phaseOffset: number; // 0..1 in beats, so different letters peak at different moments
    homeX: number;
    homeZ: number;
    homeY: number;
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
  const biomeId = useGameStore((s) => s.biomeId);
  // Decide each letter's display case once at mount so the HUD can
  // render the right glyphs on the very first frame (before the first
  // leg has been dealt). The dealer reads the same array so on-screen
  // letters and HUD always agree.
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
  const [banner, setBanner] = useState<string | null>(null);
  const engineRef = useRef<Engine | null>(null);
  const fontRef = useRef<Font | null>(null);
  // Only the letters on the world the kid is standing on. Earlier legs
  // have been collected; later ones have not been dealt.
  const lettersRef = useRef<LetterEntry[]>([]);
  const surfaceRef = useRef<Surface>(FLAT_SURFACE);
  // Which leg we are on, and how far through the alphabet the dealer
  // has got. currentIndex is the global A-to-Z position of the target.
  const legRef = useRef(0);
  const dealtRef = useRef(0);
  const currentIndex = useRef(0);
  // True once this world's letters are all collected and the way out
  // is open — which is also when there is nothing left here to find,
  // so the stall hint has to say something different.
  const legDoneRef = useRef(false);
  const hintScheduledRef = useRef(false);
  const lastProgressRef = useRef(performance.now());
  // Letters the kid was already overlapping last frame — used to fire
  // the "wrong letter" nudge only on the rising edge of contact, not
  // every frame they sit on top of an already-bumped letter.
  const prevWrongOverlapRef = useRef<Set<string>>(new Set());
  // Per-letter cooldown so re-driving onto a recently-bumped wrong
  // letter doesn't re-trigger the audio.
  const wrongLetterCooldownRef = useRef<Map<string, number>>(new Map());
  // Suppress overlapping nudges — if one is mid-flight we don't want
  // a second one stomping on it.
  const wrongNudgeBusyRef = useRef(false);
  // Dance-party state. Held in refs so the engine tickHook (a long-
  // lived closure) can read them without restarting on every state
  // change.
  const danceModeRef = useRef(false);
  const danceStartRef = useRef(0);
  // Pending trophy award — held in a timer so it fires *after* the
  // dance-party finale has had time to land. If the kid navigates away
  // before the timer fires, we award the trophy synchronously on
  // unmount so they don't lose their celebration.
  const trophyTimerRef = useRef<number | null>(null);
  const pendingTrophyIdRef = useRef<
    "alphabet-upper" | "alphabet-lower" | "alphabet-mixed" | null
  >(null);

  // ── Dealing a leg ─────────────────────────────────────────────────
  // Hand this world its share of the alphabet and scatter it about.
  const dealLeg = (engine: Engine, font: Font) => {
    for (const e of lettersRef.current) e.field.remove();
    lettersRef.current = [];

    const { from, to } = legSlice(legRef.current, dealtRef.current, ALPHABET.length);
    if (from >= to) return;
    dealtRef.current = to;
    legDoneRef.current = false;
    lastProgressRef.current = performance.now();
    hintScheduledRef.current = false;
    prevWrongOverlapRef.current = new Set();

    const surface = engine.surface;
    surfaceRef.current = surface;
    const rng = makeRng(from * 7919 + legRef.current);
    // One shared bag of fixed-look letter materials/geometries reused
    // across every letter on this leg.
    const shared = makeSharedLetterAssets();
    const taken: { x: number; z: number; radius: number }[] = [];
    const planetTaken: KeepOut[] = [];
    const keepOut = surface.kind === "planet" ? (surface.spec.noBuild ?? []) : [];
    const around = engine.player.position().clone();
    const inner = surface.kind === "flat" ? RING_INNER : PLANET_INNER;
    const outer = surface.kind === "flat" ? RING_OUTER : PLANET_OUTER;

    for (let i = from; i < to; i++) {
      const L = ALPHABET[i];
      // Spiral outward through the leg, so the first letter of a leg is
      // near where the kid is standing and the last is a proper hunt.
      const t = (i - from) / Math.max(1, to - from - 1);
      const minRange = inner + t * (outer - inner) * 0.5;
      const maxRange = Math.min(outer, minRange + (outer - inner) * 0.45 + 6);
      const spot = pickSpot(engine, surface, {
        taken,
        planetTaken,
        keepOut,
        around,
        minRange,
        maxRange,
        rng,
      });
      const field = plantLetter(engine, font, surface, spot, {
        letter: L,
        lowercase: displayLetters[i] !== L,
        shared,
      });
      field.faceCamera(engine.camera.position);
      lettersRef.current.push({ letter: L, index: i, field });
    }
  };

  const onEngineReady = (engine: Engine) => {
    engineRef.current = engine;
    void bootstrap(engine);
  };

  const bootstrap = async (engine: Engine) => {
    const font = await loadFont();
    fontRef.current = font;
    // Shut from the first frame: the sea is a world like any other and
    // its letters have to be found before it lets anyone leave.
    shutWay(engine);
    dealLeg(engine, font);

    // Landing somewhere new is the start of the next leg.
    engine.onSurfaceChange = () => {
      if (danceModeRef.current) return;
      shutWay(engine);
      setBanner(null);
      legRef.current += 1;
      dealLeg(engine, font);
    };

    // Same world, different floor — down the whirlpool and back up.
    // Not a new leg: going under is not leaving, so this leg's
    // remaining letters simply come down with the kid rather than
    // staying on the surface forty-six units over their head.
    engine.onGroundChange = () => {
      if (danceModeRef.current) return;
      replantLetters(
        engine,
        engine.surface,
        lettersRef.current.map((e) => e.field),
        {
          around: engine.player.position().clone(),
          minRange: RING_INNER,
          maxRange: RING_OUTER,
          rng: makeRng(legRef.current * 31 + 5),
        },
      );
    };

    engine.tickHook = (_dt, _t, playerPos) => {
      const cam = engine.camera.position;
      for (const entry of lettersRef.current) {
        entry.field.faceCamera(cam);
        // Proximity push drives the soft greeting wave + glow boost when
        // the kid wanders close. Skip during the dance-party finale so
        // every letter doesn't bob mid-choreography.
        if (!danceModeRef.current) {
          entry.field.character.setPlayerProximity(entry.field.distanceTo(playerPos));
        }
      }
      if (danceModeRef.current) {
        runDanceTick(engine, playerPos);
        return;
      }
      // Mid-launch the avatar sweeps over half the map at altitude;
      // collection is a ground measurement, so without this guard a
      // flyover would hoover up letters.
      if (engine.inFlight) return;

      // This world is finished and the way out is open. Nothing left to
      // collect here, so the only useful nudge is where to go next.
      if (legDoneRef.current) {
        const idle = (performance.now() - lastProgressRef.current) / 1000;
        if (idle > HINT_AFTER_SECONDS && !hintScheduledRef.current) {
          hintScheduledRef.current = true;
          void audio.play(openWayClip(surfaceRef.current), { interrupt: false }).then(() => {
            lastProgressRef.current = performance.now();
            hintScheduledRef.current = false;
          });
        }
        return;
      }

      const next = lettersRef.current.find((e) => e.index === currentIndex.current);
      if (!next) return;
      if (next.field.distanceTo(playerPos) < COLLECT_DIST && !next.field.character.isCollected) {
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
        // Skip letters the kid has already passed in alphabet order.
        // isCollected flips later, after the 1.6s celebrate animation,
        // so without this check the just-collected letter triggers a
        // wrong-letter nudge while the kid is still standing on it.
        if (entry.index < currentIndex.current) continue;
        if (entry.field.character.isCollected) continue;
        if (entry.letter === targetLetter) continue;
        if (entry.field.distanceTo(playerPos) < COLLECT_DIST) currentOverlap.add(entry.letter);
      }
      if (!wrongNudgeBusyRef.current) {
        const now = performance.now();
        for (const L of currentOverlap) {
          if (prevWrongOverlapRef.current.has(L)) continue; // already bumped
          const lastNudgedAt = wrongLetterCooldownRef.current.get(L) ?? 0;
          if (now - lastNudgedAt < 4000) continue; // cooldown
          // Fire the nudge: bumped letter's name, then a random
          // "whoops, not quite" line. No celebrate animation — the
          // wrong letter shouldn't look like it earned a victory dance.
          wrongLetterCooldownRef.current.set(L, now);
          wrongNudgeBusyRef.current = true;
          audio.stop();
          audio
            .play(audio.letterName(L))
            .then(() => audio.play(audio.randomWrongNudge(), { interrupt: false }))
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
        void audio.play(audio.randomHint()).then(() => {
          void audio.play(audio.letterName(next.letter), { interrupt: false });
          lastProgressRef.current = performance.now();
          hintScheduledRef.current = false;
        });
      }
    };

    setTimeout(() => void audio.play(alphabetPromptId(avatar)), 250);
  };

  const collectLetter = (engine: Engine, entry: LetterEntry, playerPos: THREE.Vector3) => {
    entry.field.character.celebrate();
    const burst = makeBurst(playerPos.clone());
    // Confetti flies "up" in its own frame; on a star that has to mean
    // out of the ground.
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
    // Queue the letter name. Multiple rapid pickups (the kid speed-walks
    // through close-together letters) will play in order rather than
    // each cancelling the last and leaving the user in silence.
    audio.enqueue(audio.letterName(entry.letter));
    collect(entry.letter);
    setFoundCount((n) => n + 1);
    currentIndex.current += 1;
    lastProgressRef.current = performance.now();

    if (currentIndex.current >= ALPHABET.length) {
      finish(engine);
      return;
    }
    // Leg cleared, but there is more alphabet elsewhere. Open the way.
    if (currentIndex.current >= dealtRef.current) {
      legDoneRef.current = true;
      const surface = surfaceRef.current;
      const opened = openWay(engine);
      if (opened) setBanner(openCue(surface).banner);
      hintScheduledRef.current = true;
      void audio
        .playSequence([openWayClip(surface)])
        .finally(() => {
          hintScheduledRef.current = false;
          lastProgressRef.current = performance.now();
        });
    }
  };

  // The whole alphabet, done. By construction this happens in the sea:
  // legs alternate and there is an odd number of them.
  const finish = (engine: Engine) => {
    setCompleted(true);
    setBanner(null);
    playWoo();
    // Hold the trophy id in a ref and award it AFTER the dance party
    // has had time to play. If the kid leaves before the delay fires,
    // the unmount cleanup forces the award so they never lose progress.
    pendingTrophyIdRef.current =
      letterCase === "lowercase"
        ? "alphabet-lower"
        : letterCase === "mixed"
          ? "alphabet-mixed"
          : "alphabet-upper";
    // 700ms (dance kickoff) + ~8s of dance = trophy lands ~9s after
    // the final letter. Long enough to enjoy the celebration; short
    // enough that a kid bouncing in their seat hasn't moved on yet.
    trophyTimerRef.current = window.setTimeout(() => {
      if (pendingTrophyIdRef.current) {
        useGameStore.getState().awardTrophy(pendingTrophyIdRef.current);
        pendingTrophyIdRef.current = null;
      }
      trophyTimerRef.current = null;
    }, 9000);
    // Brief pause so the player hears the final letter name + woo
    // before the dance music takes over.
    setTimeout(() => startDanceParty(engine), 700);
  };

  // ── Dance party finale ────────────────────────────────────────────
  // Teleport every letter into a ring around the player, hand each a
  // randomized dance style + beat-phase offset, swap the music to the
  // celebration track, and flip into dance-mode tickHook.
  //
  // Only the letters of the final leg are still standing — the rest were
  // collected on other worlds and are long gone — so the ring is the
  // handful that finished the alphabet rather than all twenty-six.
  const startDanceParty = (engine: Engine) => {
    const surface = surfaceRef.current;
    const player = engine.player.position();
    // Biomes with a designated dance floor (e.g. sky islands' central
    // island) override where the celebration anchors. We teleport the
    // player there too so they're at the centre of the ring, not
    // wherever they happened to bump the last letter.
    const anchor = surface.kind === "flat" ? engine.celebrationCenter : null;
    const cx = anchor ? anchor.x : player.x;
    const cz = anchor ? anchor.z : player.z;
    const ringR = anchor?.ringRadius ?? DANCE_RING_RADIUS;
    if (anchor) {
      const anchorY = engine.terrainHeight?.(anchor.x, anchor.z) ?? 0;
      engine.player.group.position.set(anchor.x, anchorY, anchor.z);
    }
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
    // On a sphere the ring is drawn around the kid's own patch of the
    // surface, at the same radius measured along the ground.
    const centreDir =
      surface.kind === "planet"
        ? engine.player.position().clone().sub(surface.spec.center).normalize()
        : null;
    for (let i = 0; i < letters.length; i++) {
      const entry = letters[i];
      // Even angular spacing around the player.
      const angle = (i / letters.length) * Math.PI * 2;
      let spot: Spot;
      if (surface.kind === "planet" && centreDir) {
        spot = {
          kind: "planet",
          dir: ringDir(centreDir, ringR / surface.spec.radius, angle),
        };
      } else {
        spot = { kind: "flat", x: cx + Math.cos(angle) * ringR, z: cz + Math.sin(angle) * ringR };
      }
      entry.field.moveTo(spot);
      // Reset any rotation/scale from earlier celebrate() calls so the
      // dance starts from a clean baseline.
      entry.field.character.group.rotation.set(0, 0, 0);
      entry.field.character.group.scale.setScalar(1);
      const home = entry.field.home;
      entry.dance = {
        style: DANCE_STYLES[i % DANCE_STYLES.length],
        // Stagger phases so letters don't peak in unison.
        phaseOffset: (i % 4) / 4,
        homeX: home.x,
        homeZ: home.z,
        homeY: home.y,
      };
    }
    // Kick off a firework round one for the moment of victory. Read the
    // player position FRESH (not the pre-teleport snapshot) so it
    // launches from wherever the dance floor ended up.
    const at = engine.player.position().clone();
    const fw = makeFirework(at, 60);
    orientToSurface(fw.group, surface, at);
    engine.scene.add(fw.group);
    engine.addActor({
      update(dt, t) {
        if (fw.update(dt, t)) return;
        engine.scene.remove(fw.group);
        engine.removeActor(this);
      },
    });
  };

  // Per-frame dance update. Drives every letter's transform from the
  // current beat phase and also detects the player bumping into one
  // (which triggers a firework rather than speaking the name).
  //
  // Everything below is in the letter's own frame: on the sea that is
  // world space, on a sphere it is the tangent plane standing on the
  // surface. Which is why the same five styles work in both places.
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
      const g = entry.field.character.group;
      // Reset to home each frame so the previous frame's offsets don't
      // accumulate.
      g.position.set(d.homeX, d.homeY, d.homeZ);
      g.rotation.set(0, 0, 0);
      g.scale.setScalar(1);
      // Apply the chosen dance style. Each peaks at phase=0.5 (the
      // off-beat — between kicks) so the visual feels like the letter
      // is lifting and dropping with the music.
      switch (d.style) {
        case "bounce": {
          // Sharp pop up on each beat.
          g.position.y = d.homeY + Math.abs(Math.sin(phase * Math.PI)) * 0.9;
          break;
        }
        case "sway": {
          g.rotation.z = Math.sin(phase * Math.PI * 2) * 0.35;
          g.position.y = d.homeY + 0.05 + (Math.cos(phase * Math.PI * 2) * 0.5 + 0.5) * 0.1;
          break;
        }
        case "spin": {
          // One full rotation every two beats.
          g.rotation.y = elapsed * beatsPerSec * Math.PI + d.phaseOffset * Math.PI * 2;
          g.position.y = d.homeY + 0.15 + Math.sin(phase * Math.PI) * 0.18;
          break;
        }
        case "pulse": {
          const s = 1 + Math.sin(phase * Math.PI) * 0.18;
          g.scale.setScalar(s);
          g.position.y = d.homeY + 0.05;
          break;
        }
        case "hop": {
          // Hop toward the player on the down-beat, away on the up.
          const local = entry.field.localOf(playerPos);
          const dirX = local.x - d.homeX;
          const dirZ = local.z - d.homeZ;
          const len = Math.hypot(dirX, dirZ) || 1;
          const inOut = Math.sin(phase * Math.PI * 2) * 0.4;
          g.position.x = d.homeX + (dirX / len) * inOut;
          g.position.z = d.homeZ + (dirZ / len) * inOut;
          g.position.y = d.homeY + Math.abs(Math.sin(phase * Math.PI * 2)) * 0.55;
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
      if (entry.field.distanceTo(playerPos) >= COLLECT_DIST + 0.4) continue;
      const now = performance.now();
      const group = entry.field.character.group;
      const lastFW = (group.userData.lastFireworkAt as number | undefined) ?? 0;
      if (now - lastFW < 900) continue;
      group.userData.lastFireworkAt = now;
      const at = group.getWorldPosition(new THREE.Vector3());
      const fw = makeFirework(at, 28);
      orientToSurface(fw.group, surfaceRef.current, at);
      engine.scene.add(fw.group);
      engine.addActor({
        update(dt, t) {
          if (fw.update(dt, t)) return;
          engine.scene.remove(fw.group);
          engine.removeActor(this);
        },
      });
      // No chime — makeFirework handles its own launch + burst SFX.
    }
  };

  // ── Dev-only fast-forward ─────────────────────────────────────────
  // Pressing F on a localhost build collects every letter on this world
  // but the last, and parks the player a few steps from it — so one
  // more nudge either opens the way onward or, on the final leg, kicks
  // off the dance party. Hidden in production via isDev().
  useEffect(() => {
    if (!isDev()) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "f" && e.key !== "F") return;
      const engine = engineRef.current;
      if (!engine || danceModeRef.current || legDoneRef.current) return;
      const letters = lettersRef.current;
      if (letters.length < 2) return;
      const last = letters[letters.length - 1];
      for (const entry of letters) {
        if (entry === last) continue;
        if (entry.index < currentIndex.current) continue;
        entry.field.character.celebrate();
        collect(entry.letter);
      }
      currentIndex.current = last.index;
      setFoundCount(last.index);
      lastProgressRef.current = performance.now();
      // Park the player a few steps from the remaining letter. On flat
      // ground the offset has to land somewhere walkable (the sky
      // islands' void is right there); on a sphere every direction is.
      const surface = surfaceRef.current;
      const target = last.field.worldPos();
      if (surface.kind === "planet") {
        const dir = target.clone().sub(surface.spec.center).normalize();
        const step = ringDir(dir, 3 / surface.spec.radius, 0);
        engine.player.group.position
          .copy(surface.spec.center)
          .addScaledVector(step, surface.spec.radius + (surface.spec.hover ?? 0));
        return;
      }
      const offset = 3;
      const candidates: Array<[number, number]> = [
        [target.x + offset, target.z],
        [target.x - offset, target.z],
        [target.x, target.z + offset],
        [target.x, target.z - offset],
        [target.x + offset * 0.7, target.z + offset * 0.7],
        [target.x - offset * 0.7, target.z + offset * 0.7],
        [target.x + offset * 0.7, target.z - offset * 0.7],
        [target.x - offset * 0.7, target.z - offset * 0.7],
      ];
      let chosen: [number, number] = [target.x, target.z];
      for (const [cx, cz] of candidates) {
        if (!engine.isWalkable || engine.isWalkable(cx, cz)) {
          chosen = [cx, cz];
          break;
        }
      }
      const [px, pz] = chosen;
      engine.player.group.position.set(px, engine.terrainHeight?.(px, pz) ?? 0, pz);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [collect]);

  useEffect(() => {
    return () => {
      // Pending trophy: fire it now if the kid bailed during the
      // dance party before the delay-timer landed. Modal will pop on
      // whichever screen they navigate to next (usually the menu).
      if (trophyTimerRef.current !== null) {
        clearTimeout(trophyTimerRef.current);
        trophyTimerRef.current = null;
      }
      if (pendingTrophyIdRef.current) {
        useGameStore.getState().awardTrophy(pendingTrophyIdRef.current);
        pendingTrophyIdRef.current = null;
      }
      const engine = engineRef.current;
      // Restore in-game music if we were in dance mode when the kid bailed.
      if (danceModeRef.current) {
        void music.play(pickGameTrack(biomeId), 0.16);
      }
      if (!engine) return;
      for (const entry of lettersRef.current) entry.field.remove();
      lettersRef.current = [];
      engine.tickHook = undefined;
      engine.onSurfaceChange = undefined;
      engine.onGroundChange = undefined;
      engine.travelOpen = true;
    };
  }, []);

  // HUD: show a window of letters around the current target so the bar
  // doesn't get unreadably long. displayLetters is the source of truth
  // for case — same array the dealer reads when building characters.
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
        banner={completed ? undefined : (banner ?? undefined)}
        prompt={
          completed ? undefined : banner ? undefined : `${moveVerb(avatar)} to the next letter!`
        }
        targets={completed ? undefined : targets}
      />
    </div>
  );
}

// A direction `arc` radians away from `centre`, at the given bearing
// around it. The dance ring on a sphere, and the dev fast-forward's
// step to one side of a letter.
function ringDir(centre: THREE.Vector3, arc: number, bearing: number): THREE.Vector3 {
  const east = new THREE.Vector3(0, 1, 0).cross(centre);
  if (east.lengthSq() < 1e-6) east.set(1, 0, 0).cross(centre);
  east.normalize();
  const north = centre.clone().cross(east).normalize();
  return new THREE.Vector3()
    .addScaledVector(centre, Math.cos(arc))
    .addScaledVector(east, Math.sin(arc) * Math.cos(bearing))
    .addScaledVector(north, Math.sin(arc) * Math.sin(bearing))
    .normalize();
}

// Small deterministic-within-a-leg PRNG, seeded fresh each time so the
// alphabet lands in a different layout every session.
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
