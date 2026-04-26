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
  const dev = isDev();

  // One-shot audio init at app boot.
  useEffect(() => {
    let cancelled = false;
    audio.init().then(() => {
      if (!cancelled) setAudioMode(audio.mode);
    });
    return () => {
      cancelled = true;
      audio.stop();
    };
  }, [setAudioMode]);

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
