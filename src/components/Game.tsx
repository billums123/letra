import { useEffect } from "react";
import { useGameStore } from "../state/store";
import { useInputBootstrap } from "../input/useInput";
import { VirtualJoystick } from "../input/VirtualJoystick";
import { MainMenu } from "../ui/MainMenu";
import { audio } from "../audio/Player";
import { music } from "../audio/music";
import { MENU_SONG, pickGameSong } from "../audio/songs";
import { SpellWordGame } from "../games/SpellWord";
import { FindAlphabetGame } from "../games/FindAlphabet";
import { SoundMatchGame } from "../games/SoundMatch";
import { LetterTest } from "../ui/LetterTest";
import { LetterEditor } from "../ui/LetterEditor";
import { isDev } from "../util/isDev";

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

  // If a non-dev visitor lands on a dev-only screen (e.g. via leftover
  // localStorage state or a stale link), bounce them back to the main menu.
  useEffect(() => {
    if (!dev && (screen === "letter-test" || screen === "letter-editor")) {
      goToMenu();
    }
  }, [dev, screen, goToMenu]);

  // Background music. Menu screen plays the dedicated theme; game screens
  // play whichever in-game song was rolled for this session. Dev tools
  // (letter-test, letter-editor) get silence so the synth doesn't fight
  // with whatever the dev is debugging.
  useEffect(() => {
    if (screen === "menu") {
      music.play(MENU_SONG, 0.14);
    } else if (screen === "letter-test" || screen === "letter-editor") {
      music.stop();
    } else {
      // In-game — pick (or recall) the per-session song.
      music.play(pickGameSong(), 0.12);
    }
  }, [screen]);

  // AudioContext starts in suspended state on every page load until the
  // user actually clicks/touches something. The screen-change effect
  // above runs at mount but the synth produces silence until a gesture
  // unblocks it. Re-fire the music start on the first pointerdown so
  // the menu theme actually plays as soon as the kid taps anywhere.
  useEffect(() => {
    let primed = false;
    const prime = () => {
      if (primed) return;
      primed = true;
      // Re-run the screen-driven choice so we end up with the right
      // song for the current screen at the moment of unblock.
      const s = useGameStore.getState().screen;
      if (s === "menu") music.play(MENU_SONG, 0.14);
      else if (s !== "letter-test" && s !== "letter-editor") music.play(pickGameSong(), 0.12);
    };
    window.addEventListener("pointerdown", prime, { once: true });
    window.addEventListener("touchstart", prime, { once: true });
    window.addEventListener("keydown", prime, { once: true });
    return () => {
      window.removeEventListener("pointerdown", prime);
      window.removeEventListener("touchstart", prime);
      window.removeEventListener("keydown", prime);
    };
  }, []);

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      {screen === "menu" && <MainMenu />}
      {screen === "spell-word" && <SpellWordGame />}
      {screen === "find-alphabet" && <FindAlphabetGame />}
      {screen === "sound-match" && <SoundMatchGame />}
      {dev && screen === "letter-test" && <LetterTest />}
      {dev && screen === "letter-editor" && <LetterEditor />}
      <VirtualJoystick visible={screen !== "menu"} />
    </div>
  );
}
