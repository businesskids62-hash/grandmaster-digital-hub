export default function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  const apiKey = process.env.GEMINI_API_KEY || process.env.AI_API_KEY || '';
  const model = process.env.GEMINI_MODEL || process.env.AI_MODEL || 'gemini-3.8-flash';
  const aiProvider = process.env.AI_PROVIDER || 'gemini';

  // Never expose the actual key - only indicate if configured
  const keyConfigured = !!(apiKey && apiKey !== 'your_gemini_api_key_here');

  if (!keyConfigured) {
    res.status(503).json({
      status: 'failed',
      reason: 'GEMINI_API_KEY not configured. Please set GEMINI_API_KEY in environment.',
      provider: aiProvider,
      model,
    });
    return;
  }

  res.status(200).json({
    status: 'verified',
    reason: '',
    provider: aiProvider,
    model,
  });
}