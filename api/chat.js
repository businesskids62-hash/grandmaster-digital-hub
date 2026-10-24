import { executeProviderRotation } from "../lib/aiProviders.js";
import { applyCors } from "../lib/cors.js";

export const config = {
  maxDuration: 30,
};

export default async function handler(req, res) {
  if (applyCors(req, res)) return;

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed. Use POST." });
  }

  try {
    const { message, history } = req.body || {};

    if (!message || typeof message !== "string" || !message.trim()) {
      return res.status(400).json({ error: "A non-empty 'message' string is required." });
    }

    if (message.length > 8000) {
      return res.status(400).json({ error: "Message exceeds maximum length of 8000 characters." });
    }

    const result = await executeProviderRotation({
      message: message.trim(),
      history: Array.isArray(history) ? history : [],
      env: process.env,
    });

    return res.status(200).json({
      reply: result.reply,
      provider: result.provider,
      model: result.model,
      attempts: result.attempts,
    });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({
      error: error.message || "AI provider processing failed.",
      attempts: error.attempts || [],
    });
  }
}
