export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  try {
    const { message } = req.body;
    const apiKey = process.env.GEMINI_API_KEY;
    const model = process.env.AI_MODEL || "gemini-2.0-flash";
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: message }] }] })
    });
    const data = await r.json();
    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || "No reply";
    return res.status(200).json({ reply });
  } catch (e) {
    return res.status(500).json({ reply: e.message });
  }
}
