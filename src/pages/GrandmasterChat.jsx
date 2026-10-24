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
} from "lucide-react";

const STORAGE_KEY = "grandmaster_chat_v1";
const API_URL = "/api/chat"; // apna endpoint yahan badlein agar alag hai

const WELCOME = {
  role: "assistant",
  content:
    "As-salamu Alaikum! Main Grandmaster AI Brain hoon. Aap English ya Roman Urdu mein sawal pooch sakte hain.",
};

const promptSuggestions = [
  "What is the vision of the 100-step Grandmaster ecosystem?",
  "Mujhay Python sikhne ka roadmap batayein",
  "Kids ko coding kaise sikhayein?",
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
  const endRef = useRef(null);
  const textareaRef = useRef(null);

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

    const next = [...messages, { role: "user", content }];
    setMessages(next);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next, message: content }),
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

      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: String(reply) },
      ]);
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
        <div className="flex-shrink-0 flex items-center justify-between gap-3 px-4 py-3 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-yellow-400 to-amber-600 flex items-center justify-center">
              <Crown className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="font-bold text-base text-white leading-tight">
                Grandmaster AI Brain
              </h1>
              <p className="text-xs text-emerald-400">
                {loading ? "Soch raha hai..." : "Online"}
              </p>
            </div>
          </div>
          <button
            onClick={clearChat}
            title="Chat saaf karein"
            className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg text-slate-300 hover:bg-white/10"
          >
            <Trash2 className="w-4 h-4" />
            <span className="hidden sm:inline">Clear</span>
          </button>
        </div>

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
                        ? "bg-amber-500 text-slate-900 rounded-br-md"
                        : m.error
                          ? "bg-red-500/10 text-red-300 border border-red-500/30 rounded-bl-md"
                          : "bg-white/10 text-slate-100 rounded-bl-md"
                    }`}
                  >
                    {m.content}
                  </div>
                  {!isUser && !m.error && i > 0 && (
                    <button
                      onClick={() => copyMessage(m.content, i)}
                      className="mt-1 flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-200"
                    >
                      {copiedIdx === i ? (
                        <Check className="w-3 h-3" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                      {copiedIdx === i ? "Copy ho gaya" : "Copy"}
                    </button>
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

          {messages.length <= 1 && !loading && (
            <div className="flex flex-wrap gap-2 pt-2">
              {promptSuggestions.map((p, idx) => (
                <button
                  key={idx}
                  onClick={() => send(p)}
                  className="text-xs px-3 py-2 rounded-full border border-amber-500/40 text-amber-300 hover:bg-amber-500/10 text-left"
                >
                  {p}
                </button>
              ))}
            </div>
          )}
          <div ref={endRef} />
        </div>

        {/* Input */}
        <div className="flex-shrink-0 border-t border-white/10 p-3">
          <div className="flex items-end gap-2 rounded-2xl bg-white/10 p-2">
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
              placeholder="Apna sawal likhein..."
              rows={1}
              className="flex-1 bg-transparent resize-none outline-none text-sm text-white placeholder-slate-400 px-2 py-2 max-h-32"
            />
            <button
              onClick={() => send()}
              disabled={!input.trim() || loading}
              aria-label="Send"
              className="w-10 h-10 rounded-xl bg-amber-500 text-slate-900 flex items-center justify-center flex-shrink-0 disabled:opacity-40"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
