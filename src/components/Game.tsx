import { useEffect } from "react";
import { useGameStore } from "../state/store";
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
    if (
      !dev &&
      (screen === "letter-test" ||
        screen === "letter-editor" ||
        screen === "alien-editor")
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
    } else if (screen === "letter-test" || screen === "letter-editor" || screen === "alien-editor") {
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
      <VirtualJoystick visible={screen !== "menu"} />
    </div>
  );
}
