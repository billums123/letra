import { lazy, Suspense, useEffect } from "react";
import { useGameStore, type Screen } from "../state/store";
import { useInputBootstrap } from "../input/useInput";
import { VirtualJoystick } from "../input/VirtualJoystick";
import { MainMenu } from "../ui/MainMenu";
import { audio } from "../audio/Player";
import { music } from "../audio/music";
import { MENU_TRACK, pickGameTrack } from "../audio/songs";
import { SpellWordGame } from "../games/SpellWord";
import { FindAlphabetGame } from "../games/FindAlphabet";
import { SoundMatchGame } from "../games/SoundMatch";
import { EarnedTrophyModal } from "../ui/EarnedTrophyModal";
import { isDev } from "../util/isDev";

// Dev-only screens are code-split: their bundles only fetch when an
// authoring screen actually mounts (i.e. on a localhost / preview
// build, after a dev clicks the corresponding menu button). In a
// production build, isDev() returns false at runtime so these chunks
// never load for kids — and crucially, the dynamic import() also keeps
// them out of the eager prod bundle, where they used to add ~150-300 KB
// of code that never executed.
const LetterTest = lazy(() => import("../ui/LetterTest").then((m) => ({ default: m.LetterTest })));
const LetterEditor = lazy(() => import("../ui/LetterEditor").then((m) => ({ default: m.LetterEditor })));
const AlienEditor = lazy(() => import("../ui/AlienEditor").then((m) => ({ default: m.AlienEditor })));
const QTailEditor = lazy(() => import("../ui/QTailEditor").then((m) => ({ default: m.QTailEditor })));
const TrophyLab = lazy(() => import("../ui/TrophyLab").then((m) => ({ default: m.TrophyLab })));
const AudioTester = lazy(() => import("../ui/AudioTester").then((m) => ({ default: m.AudioTester })));
const SpellWordBuilder = lazy(() =>
  import("../ui/SpellWordBuilder").then((m) => ({ default: m.SpellWordBuilder })),
);
const WordAssetEditor = lazy(() =>
  import("../ui/WordAssetEditor").then((m) => ({ default: m.WordAssetEditor })),
);

// Minimal full-screen fallback while a dev editor's chunk loads. On
// localhost the chunk is ready in <50 ms; this just prevents a blank
// flash while it streams.
function DevLoading() {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "grid",
        placeItems: "center",
        background: "#1a1f2c",
        color: "#9aa3b8",
        fontSize: 14,
        fontFamily: "ui-monospace, Menlo, monospace",
      }}
    >
      Loading editor…
    </div>
  );
}

// Virtual URLs we sync the current screen to for analytics. Each game
// mode gets its own path so Cloudflare Web Analytics treats it as a
// distinct pageview. Dev screens are kept under /dev so they never
// show up alongside real player traffic in the dashboard. The menu
// lives at /play (the parent-facing landing owns / instead) so PWA
// installs and shared /play links land in the game directly without a
// landing-page bounce.
const SCREEN_PATHS: Record<Screen, string> = {
  "menu": "/play",
  "spell-word": "/play/spell-word",
  "find-alphabet": "/play/find-alphabet",
  "sound-match": "/play/sound-match",
  "letter-test": "/dev/letter-test",
  "letter-editor": "/dev/letter-editor",
  "alien-editor": "/dev/alien-editor",
  "q-tail-editor": "/dev/q-tail-editor",
  "trophy-lab": "/dev/trophy-lab",
  "audio-tester": "/dev/audio-tester",
  "word-builder": "/dev/word-builder",
  "word-asset-editor": "/dev/word-asset-editor",
};

export function Game() {
  useInputBootstrap();
  const screen = useGameStore((s) => s.screen);
  const setAudioMode = useGameStore((s) => s.setAudioMode);
  const goToMenu = useGameStore((s) => s.goToMenu);
  const voiceSlug = useGameStore((s) => s.voiceSlug);
  const dev = isDev();

  // One-shot audio init at app boot. The store-resolved voice slug (if
  // any) is fed in before init so the player picks the correct voice
  // from the registry on first load.
  useEffect(() => {
    let cancelled = false;
    audio.setPreferredVoice(voiceSlug);
    audio.init().then(() => {
      if (!cancelled) setAudioMode(audio.mode);
    });
    return () => {
      cancelled = true;
      audio.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setAudioMode]);

  // When the user picks a different voice from the menu, swap manifests
  // and clip URLs without a full app reload.
  useEffect(() => {
    if (!voiceSlug) return;
    audio.setVoice(voiceSlug).then(() => setAudioMode(audio.mode));
  }, [voiceSlug, setAudioMode]);

  // Mirror the current screen into the URL so Cloudflare Web Analytics'
  // SPA mode logs each game-start as its own pageview. Letra has no real
  // routing — every screen lives at "/" — so without this hook every
  // session looks like a single page-view to CF and we can't tell who
  // bounced on the menu vs. who actually played a round.
  // pushState (rather than replaceState) ensures the analytics beacon
  // fires reliably; the popstate handler below catches the browser back
  // button and just routes back to the menu so the URL/state mismatch
  // never confuses the kid.
  useEffect(() => {
    const path = SCREEN_PATHS[screen];
    if (window.location.pathname !== path) {
      window.history.pushState({ screen }, "", path);
    }
  }, [screen]);
  useEffect(() => {
    const onPop = () => goToMenu();
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [goToMenu]);

  // If a non-dev visitor lands on a dev-only screen (e.g. via leftover
  // localStorage state or a stale link), bounce them back to the main menu.
  useEffect(() => {
    if (
      !dev &&
      (screen === "letter-test" ||
        screen === "letter-editor" ||
        screen === "alien-editor" ||
        screen === "q-tail-editor" ||
        screen === "trophy-lab" ||
        screen === "audio-tester" ||
        screen === "word-builder" ||
        screen === "word-asset-editor")
    ) {
      goToMenu();
    }
  }, [dev, screen, goToMenu]);

  // Background music. Menu screen plays the dedicated theme; game
  // screens randomly cycle through the game pool — pickGameTrack rolls
  // a fresh track each time we enter an activity (avoiding repeats).
  // Dev tools (letter-test, letter-editor) get silence so music doesn't
  // fight with whatever the dev is debugging. Browsers auto-resume any
  // suspended AudioContext on the user's first gesture, so the source
  // we schedule here will start playing as soon as they tap anywhere
  // — no separate "prime" listener needed.
  useEffect(() => {
    if (screen === "menu") {
      void music.play(MENU_TRACK, 0.18);
    } else if (
      screen === "letter-test" ||
      screen === "letter-editor" ||
      screen === "alien-editor" ||
      screen === "q-tail-editor" ||
      screen === "trophy-lab" ||
      screen === "audio-tester" ||
      screen === "word-builder" ||
      screen === "word-asset-editor"
    ) {
      music.stop();
    } else {
      void music.play(pickGameTrack(), 0.16);
    }
  }, [screen]);

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      {screen === "menu" && <MainMenu />}
      {screen === "spell-word" && <SpellWordGame />}
      {screen === "find-alphabet" && <FindAlphabetGame />}
      {screen === "sound-match" && <SoundMatchGame />}
      {dev &&
        (screen === "letter-test" ||
          screen === "letter-editor" ||
          screen === "alien-editor" ||
          screen === "q-tail-editor" ||
          screen === "trophy-lab" ||
          screen === "audio-tester" ||
          screen === "word-builder" ||
          screen === "word-asset-editor") && (
          <Suspense fallback={<DevLoading />}>
            {screen === "letter-test" && <LetterTest />}
            {screen === "letter-editor" && <LetterEditor />}
            {screen === "alien-editor" && <AlienEditor />}
            {screen === "q-tail-editor" && <QTailEditor />}
            {screen === "trophy-lab" && <TrophyLab />}
            {screen === "audio-tester" && <AudioTester />}
            {screen === "word-builder" && <SpellWordBuilder />}
            {screen === "word-asset-editor" && <WordAssetEditor />}
          </Suspense>
        )}
      <VirtualJoystick visible={screen !== "menu" && screen !== "trophy-lab"} />
      {/* Mounted at the app root so trophy-earn celebrations fire over
          any screen — gameplay, menu, or the trophy lab itself. */}
      <EarnedTrophyModal />
    </div>
  );
}
