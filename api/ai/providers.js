export default function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  const providers = [
    {
      id: 'gemini',
      name: 'Gemini',
      endpoint: 'https://generativelanguage.googleapis.com',
      defaultModel: process.env.GEMINI_MODEL || 'gemini-3.8-flash',
      configured: !!(process.env.GEMINI_API_KEY || process.env.AI_API_KEY),
    },
    {
      id: 'cline-free/nemotron-3.5',
      name: 'Nemotron',
      endpoint: 'openrouter',
      configured: false,
    },
  ];

  res.status(200).json({ providers });
}