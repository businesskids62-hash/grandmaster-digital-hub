import { useState } from "react";

export default function GrandmasterChat() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState([
    {
      role: "ai",
      text: "Salam General! 👑 Main Grandmaster AI Brain hu. Step 2/100 Active. Backend gateway operational. All 10 tools functional. Puchiye kya kaam hai?",
    },
  ]);
  const [loading, setLoading] = useState(false);

  async function sendMessage() {
    if (!input.trim()) return;
    const userText = input;
    setMessages((m) => [...m, { role: "user", text: userText }]);
    setInput("");
    setLoading(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userText }),
      });
      const data = await res.json();
      setMessages((m) => [
        ...m,
        { role: "ai", text: data.reply || "No reply from Gemini" },
      ]);
    } catch (err) {
      setMessages((m) => [...m, { role: "ai", text: "Error: " + err.message }]);
    }
    setLoading(false);
  }

  return (
    <div
      style={{
        minHeight: "75vh",
        background: "linear-gradient(180deg,#05051a 0%, #0f0f3a 100%)",
        padding: "30px 15px",
      }}
    >
      <div style={{ maxWidth: "1000px", margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: "25px" }}>
          <h1 style={{ fontSize: "38px", fontWeight: "900", color: "white" }}>
            👑 Grandmaster AI Brain{" "}
            <span style={{ color: "#FFD700" }}>Interface Active</span>
          </h1>
          <p style={{ color: "#aaa", marginTop: "8px" }}>
            Step 2: Grandmaster AI Brain interface active. Backend gateway
            operational. All 10 tools functional.
          </p>
        </div>

        <div
          style={{
            background: "#0a0a0a",
            border: "2px solid #FFD700",
            borderRadius: "20px",
            height: "550px",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            boxShadow: "0 0 30px rgba(255,215,0,0.2)",
          }}
        >
          <div style={{ flex: 1, overflowY: "auto", padding: "20px" }}>
            {messages.map((m, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  justifyContent: m.role === "user" ? "flex-end" : "flex-start",
                  margin: "14px 0",
                }}
              >
                <div
                  style={{
                    background: m.role === "user" ? "#FFD700" : "#1a1a1a",
                    color: m.role === "user" ? "black" : "white",
                    padding: "12px 18px",
                    borderRadius:
                      m.role === "user"
                        ? "18px 18px 2px 18px"
                        : "18px 18px 18px 2px",
                    maxWidth: "80%",
                    border: m.role === "user" ? "none" : "1px solid #333",
                    lineHeight: "1.5",
                  }}
                >
                  {m.text}
                </div>
              </div>
            ))}
            {loading && (
              <div style={{ color: "#FFD700", padding: "10px" }}>
                ⚡ Grandmaster AI soch raha hai...
              </div>
            )}
          </div>

          <div
            style={{
              display: "flex",
              gap: "10px",
              padding: "15px",
              background: "#111",
              borderTop: "1px solid #333",
            }}
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendMessage()}
              placeholder="Yahan apna sawal likho..."
              style={{
                flex: 1,
                background: "#222",
                border: "1px solid #444",
                color: "white",
                padding: "14px 18px",
                borderRadius: "12px",
                outline: "none",
                fontSize: "15px",
              }}
            />
            <button
              onClick={sendMessage}
              style={{
                background: "#FFD700",
                color: "black",
                border: "none",
                padding: "14px 28px",
                borderRadius: "12px",
                fontWeight: "900",
                cursor: "pointer",
                fontSize: "15px",
              }}
            >
              SEND 🚀
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
