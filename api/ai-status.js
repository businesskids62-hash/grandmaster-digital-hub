export default function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Check if GEMINI_API_KEY is configured
  const apiKey = process.env.GEMINI_API_KEY || process.env.AI_API_KEY || '';
  const model = process.env.GEMINI_MODEL || 'gemini-3.8-flash';

  if (!apiKey || apiKey === 'your_gemini_api_key_here') {
    res.status(503).json({
      ok: false,
      error: 'GEMINI_API_KEY not configured. Please set GEMINI_API_KEY in environment.',
      provider: 'gemini',
      model,
    });
    return;
  }

  res.status(200).json({
    ok: true,
    provider: 'gemini',
    model,
    backend: 'LIVE',
  });
}