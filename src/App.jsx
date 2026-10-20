import { useState } from "react";
import GrandmasterChat from "./GrandmasterChat.jsx";

export default function App() {
  const [showChat, setShowChat] = useState(false);

  return (
    <div style={{ background: "#050515", minHeight: "100vh", color: "white" }}>
      {/* TOP BANNER */}
      <div
        style={{
          background: "#111",
          padding: "8px 15px",
          fontSize: "12px",
          borderBottom: "1px solid #222",
          display: "flex",
          gap: "10px",
        }}
      >
        <span style={{ color: "#FFD700", fontWeight: "900" }}>
          GRANDMASTER ARCHITECTURE • STEP 2/100
        </span>
        <span style={{ color: "#aaa" }}>
          Step 2: Grandmaster AI Brain interface active. Backend gateway
          operational.
        </span>
      </div>

      {/* HEADER */}
      <div
        style={{
          padding: "15px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div
            style={{
              background: "#FFD700",
              width: "45px",
              height: "45px",
              borderRadius: "12px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "24px",
            }}
          >
            👑
          </div>
          <div>
            <div
              style={{ fontWeight: "900", fontSize: "18px", lineHeight: "1.1" }}
            >
              Grandmaster
              <br />
              Digital Hub
            </div>
            <div
              style={{ color: "#FFD700", fontSize: "13px", fontWeight: "700" }}
            >
              Learn, Build, Earn
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          <div
            style={{
              background: "#1a1a3a",
              padding: "8px 12px",
              borderRadius: "20px",
              fontSize: "12px",
            }}
          >
            اردو
          </div>
          <div
            style={{
              background: "#1a1a3a",
              padding: "8px 12px",
              borderRadius: "20px",
            }}
          >
            ☀️
          </div>
        </div>
      </div>

      {/* HERO - Aapki 2nd photo wala */}
      <div style={{ textAlign: "center", padding: "40px 20px" }}>
        <h1 style={{ fontSize: "42px", fontWeight: "900", lineHeight: "1.1" }}>
          Grandmaster Digital Hub
          <br />
          <span style={{ color: "#FFD700" }}>Learn, Build, Earn</span>
        </h1>
        <p
          style={{
            color: "#aaa",
            marginTop: "20px",
            lineHeight: "1.6",
            maxWidth: "600px",
            margin: "20px auto",
          }}
        >
          Empowering minds from young coders to modern digital entrepreneurs.
          Access cutting-edge learning modules, essential productivity tools,
          and an evolving AI-driven architecture.
        </p>

        <div
          style={{
            marginTop: "35px",
            display: "flex",
            flexDirection: "column",
            gap: "14px",
            maxWidth: "400px",
            margin: "35px auto 0 auto",
          }}
        >
          <button
            onClick={() => setShowChat(true)}
            style={{
              background: "#FFD700",
              color: "black",
              padding: "18px",
              borderRadius: "40px",
              fontWeight: "900",
              border: "none",
              cursor: "pointer",
            }}
          >
            🤖 LAUNCH GRANDMASTER AI
          </button>
          <div
            style={{
              background: "#151530",
              padding: "16px",
              borderRadius: "40px",
              fontWeight: "700",
            }}
          >
            📚 EXPLORE KIDS ACADEMY
          </div>
          <div
            style={{
              background: "#151530",
              padding: "16px",
              borderRadius: "40px",
              fontWeight: "700",
            }}
          >
            🔧 BROWSE DIGITAL TOOLS
          </div>
        </div>

        <div style={{ marginTop: "25px", color: "#666", fontSize: "14px" }}>
          VIEW DEMO DASHBOARD →
        </div>
      </div>

      {/* FLOATING CHAT BUTTON - Hamesha dikhega */}
      <div
        style={{
          position: "fixed",
          bottom: "20px",
          right: "20px",
          zIndex: 9999,
        }}
      >
        {!showChat && (
          <button
            onClick={() => setShowChat(true)}
            style={{
              background: "#FFD700",
              color: "black",
              padding: "14px 22px",
              borderRadius: "30px",
              fontWeight: "900",
              border: "none",
              boxShadow: "0 0 20px #FFD70088",
              cursor: "pointer",
            }}
          >
            🤖 GRANDMASTER AI
          </button>
        )}
        {showChat && (
          <div
            style={{
              width: "95vw",
              maxWidth: "400px",
              height: "70vh",
              boxShadow: "0 0 30px #000",
            }}
          >
            <GrandmasterChat onClose={() => setShowChat(false)} />
          </div>
        )}
      </div>
    </div>
  );
}
