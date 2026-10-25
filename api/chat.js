export default async function handler(req, res) {
  // Updated with retry and fallback logic
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

    // Configurable model with fallback
    const model = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
    const fallbackModel = process.env.GEMINI_FALLBACK_MODEL || 'gemini-2.5-flash';
    const modelOrder = [model, fallbackModel];
    const apiKey = process.env.GEMINI_API_KEY || process.env.AI_API_KEY || '';

    if (!apiKey || apiKey === 'your_gemini_api_key_here') {
      return res.status(503).json({
        error: 'GEMINI_API_KEY not configured. Please set GEMINI_API_KEY in environment.',
        provider: 'gemini',
        model,
      });
    }

    // Build system prompt for the Mastermind role
    const systemPrompt = `You are Grandmaster AI, the Mastermind. Coordinate tasks and summarize progress. 
      Always provide helpful, concise responses. Never echo the user's prompt as your reply.
      Think step-by-step and provide actual insights.`;

    // Call Google Gemini API
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const payload = {
      systemInstruction: {
        role: "user",
        parts: [{ text: systemPrompt }],
      },
      contents: [{
        role: "user",
        parts: [{ text: message }],
      }],
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!response.ok) {
        const errText = await response.text().catch(() => "Unknown error");
        return res.status(response.status).json({
          error: `Gemini API error: ${response.status}`,
          provider: "gemini",
          model,
          rawError: errText.substring(0, 200),
        });
      }

      const data = await response.json();
      const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || "";

      return res.status(200).json({
        reply,
        provider: "gemini",
        model,
        attempts: [],
      });
    } catch (fetchError) {
      clearTimeout(timer);
      if (fetchError.name === "AbortError") {
        return res.status(504).json({
          error: "Request to Gemini timed out after 30s.",
          provider: "gemini",
          model,
        });
      }
      throw fetchError;
    }
  } catch (error) {
    return res.status(500).json({
      error: error.message || "AI provider processing failed.",
      provider: "gemini",
      attempts: [],
    });
  }
}
