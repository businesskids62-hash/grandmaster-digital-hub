// useVoice.js - Grandmaster voice: user bolta hai (mic) + agent bolta hai (speaker).
// Browser ke built-in APIs use hote hain, koi extra package ya cost nahi.
// Mic (SpeechRecognition) Chrome/Edge par chalta hai, aur localhost ya https chahiye.

import { useCallback, useEffect, useRef, useState } from "react";

const SR =
  typeof window !== "undefined"
    ? window.SpeechRecognition || window.webkitSpeechRecognition
    : null;

// Markdown, code aur links hata do taake agent saaf bole.
function cleanForSpeech(text) {
  return String(text || "")
    .replace(/```[\s\S]*?```/g, " code block. ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "link")
    .replace(/[*_#>~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Chrome lambi utterance beech mein rok deta hai, isliye chhote tukde.
function splitChunks(text, max = 180) {
  const sentences = text.match(/[^.!?\u06D4\n]+[.!?\u06D4]?/g) || [];
  const chunks = [];
  let current = "";
  for (const sentence of sentences) {
    if ((current + sentence).length > max && current) {
      chunks.push(current.trim());
      current = "";
    }
    current += sentence + " ";
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

function pickVoice(voices, lang) {
  const base = lang.split("-")[0].toLowerCase();
  return (
    voices.find((v) => v.lang.toLowerCase() === lang.toLowerCase()) ||
    voices.find((v) => v.lang.toLowerCase().startsWith(base)) ||
    null
  );
}

export function useVoice({ listenLang = "ur-PK", speakLang = "en-IN" } = {}) {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [speaking, setSpeaking] = useState(false);
  const [autoSpeak, setAutoSpeak] = useState(false);
  const [voices, setVoices] = useState([]);
  const recRef = useRef(null);

  const sttSupported = Boolean(SR);
  const ttsSupported =
    typeof window !== "undefined" && "speechSynthesis" in window;

  useEffect(() => {
    if (!ttsSupported) return undefined;
    const synth = window.speechSynthesis;
    const load = () => setVoices(synth.getVoices());
    load();
    synth.addEventListener("voiceschanged", load);
    return () => {
      synth.removeEventListener("voiceschanged", load);
      synth.cancel();
      recRef.current?.abort();
    };
  }, [ttsSupported]);

  // USER ki awaaz: bolne ke baad onText(finalText) call hota hai.
  const startListening = useCallback(
    (onText) => {
      if (!SR) return;
      if (ttsSupported) window.speechSynthesis.cancel(); // agent chup, mic na sune
      setSpeaking(false);

      const rec = new SR();
      rec.lang = listenLang;
      rec.interimResults = true;
      rec.continuous = false;
      let finalText = "";

      rec.onresult = (event) => {
        let interimText = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const piece = event.results[i][0].transcript;
          if (event.results[i].isFinal) finalText += piece;
          else interimText += piece;
        }
        setInterim(interimText || finalText);
      };
      rec.onerror = () => setListening(false);
      rec.onend = () => {
        setListening(false);
        setInterim("");
        if (finalText.trim()) onText?.(finalText.trim());
      };

      recRef.current = rec;
      rec.start();
      setListening(true);
    },
    [listenLang, ttsSupported],
  );

  const stopListening = useCallback(() => {
    recRef.current?.stop();
  }, []);

  // AGENT ki awaaz: reply text bolta hai.
  const speak = useCallback(
    (text) => {
      if (!ttsSupported) return;
      const synth = window.speechSynthesis;
      synth.cancel();

      const chunks = splitChunks(cleanForSpeech(text));
      if (!chunks.length) return;

      const voice = pickVoice(voices, speakLang);
      chunks.forEach((chunk, index) => {
        const utterance = new SpeechSynthesisUtterance(chunk);
        utterance.lang = voice?.lang || speakLang;
        if (voice) utterance.voice = voice;
        utterance.rate = 1;
        if (index === 0) utterance.onstart = () => setSpeaking(true);
        if (index === chunks.length - 1)
          utterance.onend = () => setSpeaking(false);
        utterance.onerror = () => setSpeaking(false);
        synth.speak(utterance);
      });
    },
    [speakLang, voices, ttsSupported],
  );

  const stopSpeaking = useCallback(() => {
    if (ttsSupported) window.speechSynthesis.cancel();
    setSpeaking(false);
  }, [ttsSupported]);

  return {
    sttSupported,
    ttsSupported,
    listening,
    interim,
    speaking,
    autoSpeak,
    setAutoSpeak,
    startListening,
    stopListening,
    speak,
    stopSpeaking,
  };
}
