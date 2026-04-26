import { useEffect } from "react";
import { useGameStore } from "../state/store";
import { useInputBootstrap } from "../input/useInput";
import { VirtualJoystick } from "../input/VirtualJoystick";
import { MainMenu } from "../ui/MainMenu";
import { audio } from "../audio/Player";
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
