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

export function Game() {
  useInputBootstrap();
  const screen = useGameStore((s) => s.screen);
  const setAudioMode = useGameStore((s) => s.setAudioMode);

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

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      {screen === "menu" && <MainMenu />}
      {screen === "spell-word" && <SpellWordGame />}
      {screen === "find-alphabet" && <FindAlphabetGame />}
      {screen === "sound-match" && <SoundMatchGame />}
      {screen === "letter-test" && <LetterTest />}
      {screen === "letter-editor" && <LetterEditor />}
      <VirtualJoystick visible={screen !== "menu"} />
    </div>
  );
}
