/* ==========================================================================
   WAKE WORD — "Mere Sher"
   Uses webkitSpeechRecognition. Listens continuously for "Mere Sher".
   On trigger: ROAR (speech) + activate both brains (DoubleBrain).
   ========================================================================== */

import { doubleBrain } from "../agents/doubleBrain.js";

const WAKE_PHRASE = "mere sher";

/* Speak "ROAR" via Web Speech API */
export function speakRoar() {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) {
    return;
  }
  try {
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance("ROAR");
    utter.lang = "en-US";
    utter.rate = 1.3;
    utter.pitch = 1.1;
    window.speechSynthesis.speak(utter);
  } catch {
    /* tts unavailable */
  }
}

/* Start continuous wake-word listening.
   onTrigger fires when "Mere Sher" is heard.
   Returns { stop } to end listening.
*/
export function startWakeWord({ onTrigger, lang = "ur-PK" } = {}) {
  if (typeof window === "undefined") {
    return { stop: () => {} };
  }

  const SR =
    window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    console.error("[WakeWord] SpeechRecognition not supported in this browser.");
    return { stop: () => {} };
  }

  let transcript = "";
  let restartTimer = null;

  const rec = new SR();
  rec.lang = lang;
  rec.continuous = true;
  rec.interimResults = true;
  rec.maxAlternatives = 1;

  rec.onstart = () => {
    console.log("[WakeWord] Listening for 'Mere Sher'...");
  };

  rec.onresult = (event) => {
    let finalText = "";
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      if (event.results[i].isFinal) {
        finalText += event.results[i][0].transcript;
      }
    }
    if (!finalText) return;

    transcript += finalText;
    const lower = transcript.toLowerCase();

    if (lower.includes(WAKE_PHRASE)) {
      transcript = ""; // reset after trigger
      try {
        rec.stop();
      } catch {}
      console.log("[MERE SHER] Triggered");
      speakRoar();
      const state = doubleBrain.activate();
      console.log(
        "[MERE SHER] Triggered -> [Hamzad] Zinda -> [Dimagh] Zinda",
      );
      if (typeof onTrigger === "function") {
        onTrigger(state);
      }
      // Restart listening after a short pause
      restartTimer = setTimeout(() => {
        try { startListening(); } catch {}
      }, 1500);
    }
  };

  rec.onerror = (event) => {
    if (event.error === "aborted") return;
    if (event.error === "not-allowed") {
      console.error("[WakeWord] Mic permission blocked.");
      return;
    }
    // Auto-restart on transient errors
    if (event.error !== "aborted") {
      restartTimer = setTimeout(() => {
        try { startListening(); } catch {}
      }, 1000);
    }
  };

  rec.onend = () => {
    // Keep mic always ON: auto-restart unless we explicitly stopped
    if (!rec._stopped) {
      restartTimer = setTimeout(() => {
        try { startListening(); } catch {}
      }, 500);
    }
  };

  function startListening() {
    rec._stopped = false;
    try {
      rec.start();
    } catch {
      restartTimer = setTimeout(startListening, 1000);
    }
  }

  startListening();

  const stop = () => {
    rec._stopped = true;
    clearTimeout(restartTimer);
    try {
      rec.stop();
    } catch {}
    try {
      rec.abort();
    } catch {}
  };

  return { stop, recognition: rec };
}

/* One-shot listen (non-continuous) — used for manual mic button */
export function listenOnce({ onResult, lang = "ur-PK" } = {}) {
  if (typeof window === "undefined") return;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return;
  const rec = new SR();
  rec.lang = lang;
  rec.interimResults = true;
  rec.continuous = false;
  rec.onresult = (event) => {
    let text = "";
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      if (event.results[i].isFinal) text += event.results[i][0].transcript;
    }
    if (typeof onResult === "function") onResult(text.trim());
  };
  rec.onerror = () => {};
  try {
    rec.start();
  } catch {}
  return { stop: () => { try { rec.abort(); } catch {} } };
}
