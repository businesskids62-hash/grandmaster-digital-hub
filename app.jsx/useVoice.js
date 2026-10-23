import { useCallback, useEffect, useRef, useState } from "react";

const Recognition =
  typeof window !== "undefined"
    ? window.SpeechRecognition || window.webkitSpeechRecognition
    : null;

const ttsSupported =
  typeof window !== "undefined" && "speechSynthesis" in window;

function cleanForSpeech(text) {
  return String(text || "")
    .replace(/```[\s\S]*?```/g, " code block ")
    .replace(/[*_`#>~|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function useVoice({ listenLang = "en-US", speakLang = "en-US" } = {}) {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [speaking, setSpeaking] = useState(false);
  const [autoSpeak, setAutoSpeak] = useState(false);
  const recRef = useRef(null);

  const stopListening = useCallback(() => {
    try {
      recRef.current?.stop();
    } catch {
      /* already stopped */
    }
  }, []);

  const startListening = useCallback(
    (onFinal) => {
      if (!Recognition || recRef.current) return;
      const rec = new Recognition();
      rec.lang = listenLang;
      rec.interimResults = true;
      rec.continuous = false;

      rec.onresult = (event) => {
        let interimText = "";
        let finalText = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const chunk = event.results[i][0].transcript;
          if (event.results[i].isFinal) finalText += chunk;
          else interimText += chunk;
        }
        setInterim(interimText);
        if (finalText.trim()) onFinal?.(finalText.trim());
      };
      rec.onerror = () => {
        setListening(false);
        setInterim("");
        recRef.current = null;
      };
      rec.onend = () => {
        setListening(false);
        setInterim("");
        recRef.current = null;
      };

      recRef.current = rec;
      setListening(true);
      try {
        rec.start();
      } catch {
        recRef.current = null;
        setListening(false);
      }
    },
    [listenLang],
  );

  const stopSpeaking = useCallback(() => {
    if (!ttsSupported) return;
    window.speechSynthesis.cancel();
    setSpeaking(false);
  }, []);

  const speak = useCallback(
    (text) => {
      if (!ttsSupported) return;
      const clean = cleanForSpeech(text);
      if (!clean) return;
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(clean);
      utterance.lang = speakLang;
      utterance.onstart = () => setSpeaking(true);
      utterance.onend = () => setSpeaking(false);
      utterance.onerror = () => setSpeaking(false);
      window.speechSynthesis.speak(utterance);
    },
    [speakLang],
  );

  useEffect(
    () => () => {
      try {
        recRef.current?.abort();
      } catch {
        /* ignore */
      }
      if (ttsSupported) window.speechSynthesis.cancel();
    },
    [],
  );

  return {
    listening,
    interim,
    speaking,
    autoSpeak,
    setAutoSpeak,
    startListening,
    stopListening,
    speak,
    stopSpeaking,
    sttSupported: Boolean(Recognition),
    ttsSupported,
  };
}

export default useVoice;
