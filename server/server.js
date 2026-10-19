import express from "express";
import path from "path";
import dotenv from "dotenv";
import { fileURLToPath } from "url";

// --- Setup for ES Module ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const app = express();
const PORT = 5000;

// --- Middleware ---
// Manual CORS - no library needed, layer.js error khatam!
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept",
  );
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

app.use(express.json());

// --- Direct Gemini AI - No Adapter Needed ---
async function generateResponse(userMessage) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY .env me nahi hai");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${apiKey}`;

  const body = {
    contents: [
      {
        role: "user",
        parts: [{ text: userMessage }],
      },
    ],
    systemInstruction: {
      parts: [
        {
          text: "You are Grandmaster Meta AI, brain of GRANDMASTER ROBOT. Call user General. Speak in Roman Urdu + English mix, friendly, with emojis 🔥. You are expert in MERN Stack, Trading, AI.",
        },
      ],
    },
  };

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await response.json();

  if (!response.ok) {
    console.error("Gemini API Error:", data);
    throw new Error(data.error?.message || "Gemini API Failed");
  }

  return (
    data.candidates?.[0]?.content?.parts?.[0]?.text ||
    "Ji General! 🔥 Main hazir hun!"
  );
}

// --- Routes ---
app.get("/api/health", (req, res) => {
  res.json({ status: "READY", key: !!process.env.GEMINI_API_KEY });
});

app.post("/api/chat", async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: "Message empty" });

    const reply = await generateResponse(message);
    res.json({ reply, status: "COMPLETE" });
  } catch (e) {
    console.error(e.message);
    res.status(500).json({ error: e.message });
  }
});

// --- Start ---
app.listen(PORT, () => {
  console.log(`✅ GRANDMASTER ROBOT RUNNING on http://localhost:${PORT}`);
});
