export default async function handler(req, res) {
  // Updated with retry and fallback logic
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
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

    const primaryModel = "gemini-3.6-flash";
    const fallbackModel = "gemini-3.5-flash";
    const apiKey = process.env.GEMINI_API_KEY || '';

    if (!apiKey || apiKey === 'your_gemini_api_key_here') {
      return res.status(503).json({
        error: 'GEMINI_API_KEY not configured. Please set GEMINI_API_KEY in environment.',
        provider: 'gemini',
        model: primaryModel,
      });
    }

    // Build system prompt for the Mastermind role
    const systemPrompt = `You are Grandmaster AI, the Mastermind. Coordinate tasks and summarize progress. 
      Always provide helpful, concise responses. Never echo the user's prompt as your reply.
      Think step-by-step and provide actual insights.`;

    async function callGemini(modelName, prompt) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
      const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }) });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        const err = new Error(data.error?.message || 'Gemini error');
        err.status = resp.status;
        throw err;
      }
      return data.candidates?.[0]?.content?.parts?.[0]?.text || "No response";
    }

    async function tryWithRetry(model, prompt, tries = 3) {
      let lastError;
      for (let i = 0; i < tries; i++) {
        try {
          return await callGemini(model, prompt);
        } catch (err) {
          lastError = err;
          const status = err.status;
          // Non-retryable errors: 400, 401, 403, 404
          if (status === 400 || status === 401 || status === 403 || status === 404) {
            throw err;
          }
          // Retryable errors: 429, 500, 503
          if (status === 429 || status === 500 || status === 503) {
            if (i < tries - 1) {
              const delay = Math.pow(2, i) * 1000; // 1s, 2s
              await new Promise(resolve => setTimeout(resolve, delay));
              continue;
            }
          }
          throw err;
        }
      }
      throw lastError;
    }

    let answer;
    try {
      answer = await tryWithRetry(primaryModel, message);
    } catch (e) {
      // Non-retryable errors: return clear JSON error
      if (e.status === 400 || e.status === 401 || e.status === 403 || e.status === 404) {
        console.error(`[api/chat] Non-retryable error (status ${e.status}): ${e.message}`);
        return res.status(e.status).json({ error: e.message || 'Request failed.', provider: 'gemini', model: primaryModel });
      }
      // Retryable error: try fallback model
      console.log("Primary failed, fallback:", e.message);
      try {
        answer = await tryWithRetry(fallbackModel, message);
      } catch (fallbackErr) {
        if (fallbackErr.status === 400 || fallbackErr.status === 401 || fallbackErr.status === 403 || fallbackErr.status === 404) {
          console.error(`[api/chat] Non-retryable error (status ${fallbackErr.status}): ${fallbackErr.message}`);
          return res.status(fallbackErr.status).json({ error: fallbackErr.message || 'Request failed.', provider: 'gemini', model: fallbackModel });
        }
        // Both models failed with retryable errors
        console.error(`[api/chat] Both models failed. Primary: ${e.message}, Fallback: ${fallbackErr.message}`);
        return res.status(503).json({ error: "AI abhi busy hai, thori der baad dobara try karein.", retryable: true });
      }
    }

    return res.status(200).json({
      reply: answer,
      provider: 'gemini',
    });
  } catch (error) {
    console.error("[api/chat] Unexpected error:", error);
    return res.status(500).json({
      error: "Internal server error.",
      provider: "gemini",
      attempts: [],
    });
  }
}
