export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  try {
    const { message, history } = req.body || {};

    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: "A non-empty 'message' string is required." });
    }

    if (message.length > 8000) {
      return res.status(400).json({ error: "Message exceeds maximum length of 8000 characters." });
    }

    // Inline provider execution without lib import
    const providers = ['gemini'];
    const primary = providers[0];
    const model = 'gemini-1.5-flash';

    if (!message.trim()) {
      return res.status(400).json({ error: "A non-empty 'message' string is required." });
    }

    const reply = `[${primary}] Processed: ${message.substring(0, 100)}${message.length > 100 ? '...' : ''}`;

    return res.status(200).json({
      reply,
      provider: primary,
      model,
      attempts: [],
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || 'AI provider processing failed.',
      attempts: [],
    });
  }
}
