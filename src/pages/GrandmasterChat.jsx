import React, { useState, useRef, useEffect } from "react";
import {
  Crown,
  Send,
  Bot,
  User,
  Trash2,
  Copy,
  Check,
  Loader2,
  Volume2,
  VolumeX,
  Mic,
  MicOff,
  Sparkles,
  AlertCircle,
} from "lucide-react";
import { useVoice } from "../hooks/useVoice.js";

const STORAGE_KEY = "grandmaster_chat_v1";
const API_URL = "/api/chat";

const WELCOME = {
  role: "assistant",
  content:
    "Assalam-o-Alaikum! Main Grandmaster AI Brain hoon. Dost Mode ON karke aap mere saath bilkul dostana andaz mein baat kar sakte hain. Har jawab ke sath [ 🔊 SUNO ] dabayein!",
};

const promptSuggestions = [
  "What is the vision of the 100-step Grandmaster ecosystem?",
  "Dost, mujhay Python sikhne ka asaan tareeqa batao",
  "Hub me trading kyu banned hai aur token rules kya hain?",
];

function loadMessages() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (Array.isArray(saved) && saved.length) return saved;
  } catch (e) {}
  return [WELCOME];
}

export default function GrandmasterChat() {
  const [messages, setMessages] = useState(loadMessages);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [copiedIdx, setCopiedIdx] = useState(null);
  const [dostMode, setDostMode] = useState(true);
  const endRef = useRef(null);
  const textareaRef = useRef(null);

  const voice = useVoice({
    listenLang: "ur-PK",
    speakLang: "ur-PK",
  });

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    } catch (e) {}
  }, [messages, loading]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 128) + "px";
  }, [input]);

  const send = async (text) => {
    const content = (text ?? input).trim();
    if (!content || loading) return;

    voice.stopListening();
    const next = [...messages, { role: "user", content }];
    setMessages(next);
    setInput("");
    setLoading(true);

    try {
      const systemPrompt = dostMode
        ? "You are Grandmaster Dost. Speak in friendly, respectful, highly encouraging Urdu/Roman Urdu with warmth and clarity like an elder brother and mentor. Emphasize learning and discipline: real trading is strictly BANNED in the hub, and max daily allocation is 10 tokens."
        : "You are Grandmaster AI Brain. Provide precise and structured technical answers.";

      const res = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: next,
          message: content,
          system: systemPrompt,
          agent: dostMode ? "DOST" : "MASTER",
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok)
        throw new Error(data.error || `Server error (${res.status})`);

      const reply =
        data.reply ||
        data.text ||
        data.message ||
        data.content ||
        data.response;
      if (!reply) throw new Error("Server ne khali jawab diya.");

      const newMsg = { role: "assistant", content: String(reply) };
      setMessages((prev) => [...prev, newMsg]);

      if (voice.autoSpeak) {
        voice.speak(reply);
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          error: true,
          content: `Jawab nahi aa saka: ${err.message}. Dobara koshish karein.`,
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const clearChat = () => {
    voice.stopSpeaking();
    setMessages([WELCOME]);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) {}
  };

  const copyMessage = async (text, idx) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx(null), 1500);
    } catch (e) {}
  };

  return (
    <div className="max-w-5xl mx-auto w-full px-3 sm:px-6 py-4">
      <div className="flex flex-col h-[calc(100dvh-9rem)] min-h-[480px] rounded-2xl border border-white/10 bg-slate-900/80 backdrop-blur overflow-hidden shadow-xl">
        {/* Header */}
        <div className="flex-shrink-0 flex items-center justify-between gap-3 px-4 py-3 border-b border-white/10 bg-slate-950/40">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-yellow-400 to-amber-600 flex items-center justify-center shadow-lg">
              <Crown className="w-5 h-5 text-slate-950" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-bold text-base text-white leading-tight">
                  {dostMode ? "Grandmaster Dost" : "Grandmaster AI Brain"}
                </h1>
                <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                  {dostMode ? "DOST MODE" : "PRO"}
                </span>
              </div>
              <p className="text-xs text-emerald-400">
                {loading ? "Soch raha hai..." : "Online · Male Deep Voice Ready"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setDostMode(!dostMode)}
              className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl border transition ${
                dostMode
                  ? "bg-amber-500/20 text-amber-300 border-amber-500/40 font-bold"
                  : "bg-white/5 text-slate-300 border-white/10"
              }`}
              title="Dost Mode Toggle"
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              <span className="hidden sm:inline">Dost Mode:</span>
              <span>{dostMode ? "ON" : "OFF"}</span>
            </button>

            <button
              onClick={() => voice.setAutoSpeak(!voice.autoSpeak)}
              className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl border transition ${
                voice.autoSpeak
                  ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40 font-bold"
                  : "bg-white/5 text-slate-300 border-white/10"
              }`}
              title="Auto Speech on Reply"
            >
              {voice.autoSpeak ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
              <span className="hidden sm:inline">Auto Suno</span>
            </button>

            {voice.speaking && (
              <button
                onClick={voice.stopSpeaking}
                className="text-xs px-2.5 py-1.5 rounded-xl bg-red-500/20 text-red-300 border border-red-500/40 font-bold animate-pulse"
              >
                Roko
              </button>
            )}

            <button
              onClick={clearChat}
              title="Chat saaf karein"
              className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-xl text-slate-400 hover:text-slate-200 hover:bg-white/10"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Voice Error Display Banner */}
        {voice.voiceError && (
          <div className="px-4 py-2 bg-red-500/15 border-b border-red-500/30 text-red-200 text-xs flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
              <span>Awaz Error: {voice.voiceError}</span>
            </div>
            <button
              onClick={() => voice.setVoiceError("")}
              className="text-xs px-2 py-0.5 rounded bg-red-500/20 hover:bg-red-500/30 font-bold"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-4">
          {messages.map((m, i) => {
            const isUser = m.role === "user";
            return (
              <div
                key={i}
                className={`flex gap-2.5 ${isUser ? "justify-end" : "justify-start"}`}
              >
                {!isUser && (
                  <div className="w-8 h-8 rounded-lg bg-amber-500/20 text-amber-400 flex items-center justify-center flex-shrink-0">
                    <Bot className="w-4 h-4" />
                  </div>
                )}
                <div className="max-w-[82%] group">
                  <div
                    className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words ${
                      isUser
                        ? "bg-amber-500 text-slate-900 rounded-br-md font-medium"
                        : m.error
                          ? "bg-red-500/10 text-red-300 border border-red-500/30 rounded-bl-md"
                          : "bg-white/10 text-slate-100 rounded-bl-md"
                    }`}
                  >
                    {m.content}
                  </div>

                  {!isUser && !m.error && (
                    <div className="mt-1 flex items-center gap-3">
                      <button
                        onClick={() => voice.speak(m.content)}
                        className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 transition font-bold"
                        title="Is message ko awaz mein suno"
                      >
                        <Volume2 className="w-3.5 h-3.5 text-amber-400" />
                        <span>[ 🔊 SUNO ]</span>
                      </button>

                      {i > 0 && (
                        <button
                          onClick={() => copyMessage(m.content, i)}
                          className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-200"
                        >
                          {copiedIdx === i ? (
                            <Check className="w-3 h-3 text-emerald-400" />
                          ) : (
                            <Copy className="w-3 h-3" />
                          )}
                          <span>{copiedIdx === i ? "Copy ho gaya" : "Copy"}</span>
                        </button>
                      )}
                    </div>
                  )}
                </div>
                {isUser && (
                  <div className="w-8 h-8 rounded-lg bg-white/10 text-slate-200 flex items-center justify-center flex-shrink-0">
                    <User className="w-4 h-4" />
                  </div>
                )}
              </div>
            );
          })}

          {loading && (
            <div className="flex gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-amber-500/20 text-amber-400 flex items-center justify-center">
                <Loader2 className="w-4 h-4 animate-spin" />
              </div>
              <div className="rounded-2xl rounded-bl-md bg-white/10 px-4 py-3 flex gap-1.5 items-center">
                <span className="w-1.5 h-1.5 rounded-full bg-slate-300 animate-bounce" />
                <span className="w-1.5 h-1.5 rounded-full bg-slate-300 animate-bounce [animation-delay:150ms]" />
                <span className="w-1.5 h-1.5 rounded-full bg-slate-300 animate-bounce [animation-delay:300ms]" />
              </div>
            </div>
          )}

          {voice.listening && (
            <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs flex items-center gap-2 animate-pulse">
              <Mic className="w-4 h-4 text-amber-400" />
              <span>{voice.interim || "Sun raha hoon... Boliye!"}</span>
            </div>
          )}

          {messages.length <= 1 && !loading && (
            <div className="flex flex-wrap gap-2 pt-2">
              {promptSuggestions.map((p, idx) => (
                <button
                  key={idx}
                  onClick={() => send(p)}
                  className="text-xs px-3 py-2 rounded-full border border-amber-500/40 text-amber-300 hover:bg-amber-500/10 text-left transition"
                >
                  {p}
                </button>
              ))}
            </div>
          )}
          <div ref={endRef} />
        </div>

        {/* Input */}
        <div className="flex-shrink-0 border-t border-white/10 p-3 bg-slate-950/30">
          <div className="flex items-end gap-2 rounded-2xl bg-white/10 p-2">
            <button
              type="button"
              onClick={() => {
                if (voice.listening) {
                  voice.stopListening();
                } else {
                  voice.startListening((heard) => {
                    setInput((prev) => (prev ? `${prev} ` : "") + heard);
                  });
                }
              }}
              disabled={!voice.sttSupported || loading}
              className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 transition ${
                voice.listening
                  ? "bg-red-500 text-white animate-pulse"
                  : "bg-white/10 hover:bg-white/20 text-slate-200"
              }`}
              title={voice.listening ? "Mic roko" : "Bol kar sawal poochein"}
            >
              {voice.listening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </button>

            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder={dostMode ? "Dost se baat karein ya sawal poochein..." : "Apna sawal likhein..."}
              rows={1}
              className="flex-1 bg-transparent resize-none outline-none text-sm text-white placeholder-slate-400 px-2 py-2 max-h-32"
            />

            <button
              onClick={() => send()}
              disabled={!input.trim() || loading}
              aria-label="Send"
              className="w-10 h-10 rounded-xl bg-gradient-to-r from-amber-400 to-amber-500 text-slate-950 flex items-center justify-center flex-shrink-0 disabled:opacity-40 hover:from-amber-300 hover:to-amber-400 transition"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
