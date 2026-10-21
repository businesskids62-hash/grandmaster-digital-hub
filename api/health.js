export default function handler(req, res) {
  res.status(200).json({
    ok: true,
    model: process.env.AI_MODEL || "gemini",
  });
}
