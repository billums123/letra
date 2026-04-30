import { useEffect } from "react";
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
import { LetterTest } from "../ui/LetterTest";
import { LetterEditor } from "../ui/LetterEditor";
import { AlienEditor } from "../ui/AlienEditor";
import { QTailEditor } from "../ui/QTailEditor";
import { TrophyLab } from "../ui/TrophyLab";
import { EarnedTrophyModal } from "../ui/EarnedTrophyModal";
import { isDev } from "../util/isDev";

// Virtual URLs we sync the current screen to for analytics. Each game
// mode gets its own path so Cloudflare Web Analytics treats it as a
// distinct pageview. Dev screens are kept under /dev so they never
// show up alongside real player traffic in the dashboard.
const SCREEN_PATHS: Record<Screen, string> = {
  "menu": "/",
  "spell-word": "/play/spell-word",
  "find-alphabet": "/play/find-alphabet",
  "sound-match": "/play/sound-match",
  "letter-test": "/dev/letter-test",
  "letter-editor": "/dev/letter-editor",
  "alien-editor": "/dev/alien-editor",
  "q-tail-editor": "/dev/q-tail-editor",
  "trophy-lab": "/dev/trophy-lab",
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
        screen === "trophy-lab")
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
      screen === "trophy-lab"
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
      {dev && screen === "letter-test" && <LetterTest />}
      {dev && screen === "letter-editor" && <LetterEditor />}
      {dev && screen === "alien-editor" && <AlienEditor />}
      {dev && screen === "q-tail-editor" && <QTailEditor />}
      {dev && screen === "trophy-lab" && <TrophyLab />}
      <VirtualJoystick visible={screen !== "menu" && screen !== "trophy-lab"} />
      {/* Mounted at the app root so trophy-earn celebrations fire over
          any screen — gameplay, menu, or the trophy lab itself. */}
      <EarnedTrophyModal />
    </div>
  );
}
