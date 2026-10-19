import { useState, useRef, useEffect } from "react";

export default function GrandmasterChat() {
  const [messages, setMessages] = useState([
    {
      role: "assistant",
      content:
        "Salam General! Main Grandmaster AI Brain Online hun - 200 OK! 👑",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = async () => {
    if (!input.trim()) return;
    const userMsg = { role: "user", content: input };
    setMessages((p) => [...p, userMsg]);
    setInput("");
    setLoading(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userMsg.content }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error");
      setMessages((p) => [...p, { role: "assistant", content: data.reply }]);
    } catch (err) {
      setMessages((p) => [
        ...p,
        { role: "assistant", content: `❌ ${err.message}` },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-[70vh] bg-[#111722] rounded-xl border border-[#252e3d] overflow-hidden">
      <div className="p-4 bg-[#0c1019] border-b border-[#252e3d] font-bold text-[#e8bd67]">
        👑 Grandmaster AI Brain | Online - 200 OK
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.map((m, i) => (
          <div
            key={i}
            className={`p-3 rounded-lg text-sm max-w-[80%] ${m.role === "user" ? "ml-auto bg-[#e8bd67] text-black font-semibold" : "bg-[#0c1019] border border-[#252e3d] text-[#f4f5f7]"}`}
          >
            {m.content}
          </div>
        ))}
        {loading && (
          <div className="text-[#9ba7b8] text-xs animate-pulse">
            Grandmaster soch raha hai...
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      <div className="p-3 border-t border-[#252e3d] flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && sendMessage()}
          placeholder="Sawal likho..."
          className="flex-1 bg-[#0c1019] border border-[#252e3d] rounded-lg px-3 py-2.5 text-sm outline-none focus:border-[#e8bd67] text-white"
        />
        <button
          onClick={sendMessage}
          className="bg-[#e8bd67] text-black px-6 py-2.5 rounded-lg text-sm font-bold hover:bg-[#d4a85c]"
        >
          Send
        </button>
      </div>
    </div>
  );
}
