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

    const primaryModel = "gemini-3.8-flash-exp";
    const fallbackModel = "gemini-3.8-flash";
    const apiKey = process.env.GEMINI_API_KEY || process.env.AI_API_KEY || '';

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

    async function callGemini(modelName, prompt){
      const url = `https://generativelanguage.googleapis.com/v1/models/${modelName}:generateContent?key=${process.env.GEMINI_API_KEY}`
      const resp = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({contents:[{parts:[{text:prompt}]}]}) })
      const data = await resp.json()
      if(!resp.ok) throw new Error(data.error?.message || 'Gemini error')
      return data.candidates?.[0]?.content?.parts?.[0]?.text || "No response"
    }

    let answer
    try {
      answer = await callGemini(primaryModel, message)
    } catch(e){
      console.log("Primary failed, fallback:", e.message)
      answer = await callGemini(fallbackModel, message)
    }

    return res.status(200).json({
      reply: answer,
      provider: 'gemini',
    })
  } catch (error) {
    return res.status(500).json({
      error: error.message || "AI provider processing failed.",
      provider: "gemini",
      attempts: [],
    });
  }
}
