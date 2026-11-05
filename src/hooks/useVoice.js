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
    .replace(/\[(.*?)\]\(.*?\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Enhanced voice hook supporting:
 * - Male Deep Voice selection with lower pitch (0.85) and steady rate (0.95)
 * - Safari iOS/macOS audio context resume & speech synthesis unlock fix
 * - Error detection and display state (surfaced if speech synthesis or mic fails)
 */
export function useVoice({
  listenLang = "ur-PK",
  speakLang = "ur-PK",
} = {}) {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [speaking, setSpeaking] = useState(false);
  const [autoSpeak, setAutoSpeak] = useState(false);
  const [voiceError, setVoiceError] = useState("");
  const [voices, setVoices] = useState([]);
  const recRef = useRef(null);

  // Safari fix: load voices and ensure speech synthesis is warmed up
  useEffect(() => {
    if (!ttsSupported) return;
    const updateVoices = () => {
      try {
        const available = window.speechSynthesis.getVoices() || [];
        setVoices(available);
      } catch (err) {
        setVoiceError("Voices load nahi ho saki: " + err.message);
      }
    };

    updateVoices();
    if (window.speechSynthesis.onvoiceschanged !== undefined) {
      window.speechSynthesis.onvoiceschanged = updateVoices;
    }
  }, []);

  const selectMaleDeepVoice = useCallback(
    (lang) => {
      if (!ttsSupported || voices.length === 0) return null;
      const langMatches = voices.filter(
        (v) =>
          v.lang?.toLowerCase().startsWith(lang.slice(0, 2).toLowerCase()) ||
          v.lang?.toLowerCase().includes("in") ||
          v.lang?.toLowerCase().includes("pk") ||
          v.lang?.toLowerCase().startsWith("en"),
      );

      const maleVoice =
        langMatches.find((v) =>
          /male|david|george|mark|rishi|gurdeep|tarik/i.test(v.name),
        ) ||
        voices.find((v) =>
          /male|david|george|mark|rishi|gurdeep/i.test(v.name),
        ) ||
        langMatches[0] ||
        voices[0];

      return maleVoice || null;
    },
    [voices],
  );

  const stopListening = useCallback(() => {
    try {
      recRef.current?.stop();
    } catch {}
  }, []);

  const startListening = useCallback(
    (onFinal) => {
      setVoiceError("");
      if (!Recognition) {
        setVoiceError("Mic support nahi hai is browser mein (Chrome/Edge use karein).");
        return;
      }
      try {
        recRef.current?.abort();
      } catch {}

      const rec = new Recognition();
      rec.lang = listenLang;
      rec.interimResults = true;
      rec.continuous = false;
      let finalText = "";

      rec.onstart = () => {
        setListening(true);
      };

      rec.onresult = (event) => {
        let interimText = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const chunk = event.results[i][0].transcript;
          if (event.results[i].isFinal) finalText += chunk;
          else interimText += chunk;
        }
        setInterim(interimText);
      };

      rec.onerror = (event) => {
        setListening(false);
        setInterim("");
        recRef.current = null;
        if (event.error !== "aborted") {
          const map = {
            "not-allowed": "Mic permission block hai. Settings mein allow karein.",
            "audio-capture": "Mic hardware nahi mila.",
            "no-speech": "Awaaz sunai nahi di. Dobara try karein.",
            network: "Voice network error.",
          };
          setVoiceError(map[event.error] || `Mic error: ${event.error}`);
        }
      };

      rec.onend = () => {
        setListening(false);
        setInterim("");
        recRef.current = null;
        if (finalText.trim()) onFinal?.(finalText.trim());
      };

      recRef.current = rec;
      try {
        rec.start();
      } catch (err) {
        recRef.current = null;
        setListening(false);
        setVoiceError("Mic start karne mein masla hua: " + err.message);
      }
    },
    [listenLang],
  );

  const stopSpeaking = useCallback(() => {
    if (!ttsSupported) return;
    try {
      window.speechSynthesis.cancel();
    } catch {}
    setSpeaking(false);
  }, []);

  const speak = useCallback(
    (text, overrideLang) => {
      setVoiceError("");
      if (!ttsSupported) {
        setVoiceError("Speech synthesis is browser mein available nahi hai.");
        return;
      }

      const clean = cleanForSpeech(text);
      if (!clean) return;

      try {
        if (window.speechSynthesis.paused) {
          window.speechSynthesis.resume();
        }
        window.speechSynthesis.cancel();

        const utterance = new SpeechSynthesisUtterance(clean);
        const targetLang = overrideLang || speakLang;
        utterance.lang = targetLang;

        const bestVoice = selectMaleDeepVoice(targetLang);
        if (bestVoice) {
          utterance.voice = bestVoice;
        }

        // Deep male profile: pitch ~0.85, rate ~0.95
        utterance.pitch = 0.85;
        utterance.rate = 0.95;

        utterance.onstart = () => {
          setSpeaking(true);
        };
        utterance.onend = () => {
          setSpeaking(false);
        };
        utterance.onerror = (e) => {
          setSpeaking(false);
          if (e.error !== "canceled" && e.error !== "interrupted") {
            setVoiceError(`Awaz chalane mein error: ${e.error || "playback_failed"}`);
          }
        };

        window.speechSynthesis.speak(utterance);
      } catch (err) {
        setSpeaking(false);
        setVoiceError("Audio error: " + err.message);
      }
    },
    [speakLang, selectMaleDeepVoice],
  );

  useEffect(
    () => () => {
      try {
        recRef.current?.abort();
      } catch {}
      if (ttsSupported) {
        try {
          window.speechSynthesis.cancel();
        } catch {}
      }
    },
    [],
  );

  return {
    listening,
    interim,
    speaking,
    autoSpeak,
    setAutoSpeak,
    voiceError,
    setVoiceError,
    startListening,
    stopListening,
    speak,
    stopSpeaking,
    sttSupported: Boolean(Recognition),
    ttsSupported,
  };
}

export default useVoice;
