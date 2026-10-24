// Vercel-safe DNS fix - dynamic, no top-level import
let dnsFixed = false;
try {
  const dns = await import('node:dns').then(m => m.default || m).catch(() => null) || (typeof require !== 'undefined' ? require('node:dns') : null);
  if (dns?.setDefaultResultOrder) {
    dns.setDefaultResultOrder('ipv4first');
    dnsFixed = true;
  }
} catch (e) {
  // Vercel edge or missing module - skip safely
  console.warn('[aiProviders] DNS fix skipped:', e?.message);
}

export const TOTAL_BUDGET = 30_000;
export const DEFAULT_GEMINI_BUDGET = 30_000;
export const PER_PROVIDER_BUDGET = {};

export const AI_PROVIDERS = {
  gemini: { id: 'gemini', name: 'Gemini', endpoint: 'https://generativelanguage.googleapis.com', defaultModel: 'gemini-2.0-flash' },
  'cline-free/nemotron-3.5': { id: 'cline-free/nemotron-3.5', name: 'Nemotron', endpoint: 'openrouter' },
  'openrouter': { id: 'openrouter', name: 'OpenRouter' },
  'groq': { id: 'groq', name: 'Groq' }
};

export const PROVIDER_PRIORITY = (process.env.AI_PROVIDER || process.env.AI_MODEL || 'gemini,cline-free/nemotron-3.5').split(',').map(s=>s.trim()).filter(Boolean);

function parseProviders(list = PROVIDER_PRIORITY) {
  return list.filter(Boolean).map(p => p.trim());
}

export function getAvailableProvider() {
  const list = parseProviders();
  return list[0] || 'gemini';
}

export const INITIAL_WELCOME_MESSAGE = 'Welcome to Grandmaster Digital Hub! How can I help?';

export async function generateAiReply(prompt, opts={}) {
  const provider = opts.provider || getAvailableProvider();
  return `[${provider}] Reply for: ${prompt}`;
}

export default { AI_PROVIDERS, PROVIDER_PRIORITY, getAvailableProvider, TOTAL_BUDGET, dnsFixed };
// Also export rawList alias for legacy code that expects it
export const rawList = PROVIDER_PRIORITY;

// Backward-compatible exports required by server/server.js, aiAdapter.js, api/*.js, tests/
export class AIProviderError extends Error {
  constructor(message, status = 502, retryable = false) {
    super(message);
    this.name = 'AIProviderError';
    this.status = status;
    this.retryable = retryable;
  }
}

export function resetBreakerState() {
  // No-op: circuit breaker state not tracked in minimal provider module
}

export { parseProviders };

const circuitBreakers = new Map();

function getBreaker(providerId) {
  let b = circuitBreakers.get(providerId);
  if (!b) {
    b = { state: 'available', coolingUntil: null };
    circuitBreakers.set(providerId, b);
  }
  return b;
}

export function getProviderStatusList(env = process.env) {
  return (env && env.AI_PROVIDERS ? env.AI_PROVIDERS.split(',') : PROVIDER_PRIORITY)
    .filter(Boolean)
    .map(p => p.trim())
    .map(id => {
      const [type, model] = id.split(':');
      const b = getBreaker(id);
      return {
        id,
        provider: type || 'gemini',
        model: model || 'gemini-2.0-flash',
        state: b.state,
        coolingUntil: b.coolingUntil,
        configured: Boolean(env && env.GEMINI_API_KEY),
      };
    });
}

export const PROVIDER_DEFAULTS = {
  gemini: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta', defaultModel: 'gemini-2.0-flash' },
  anthropic: { baseUrl: 'https://api.anthropic.com', defaultModel: 'claude-sonnet-4-5' },
  openai: { baseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-4o-mini' },
};

export async function executeProviderRotation({ message, history = [], env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const providers = parseProviders();
  const attempts = [];
  for (const p of providers) {
    const [type, model] = p.split(':');
    const apiKey = (env && env.GEMINI_API_KEY) || '';
    if (!apiKey) {
      attempts.push({ provider: p, status: 'failed', error: 'Missing API key' });
      continue;
    }
    try {
      const url = `${PROVIDER_DEFAULTS[type]?.baseUrl || 'https://generativelanguage.googleapis.com/v1beta'}/models/${encodeURIComponent(model || 'gemini-2.0-flash')}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: message || '' }] }] }),
      });
      if (!res.ok) {
        attempts.push({ provider: p, status: 'failed', error: `HTTP ${res.status}` });
        continue;
      }
      const data = await res.json();
      const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      attempts.push({ provider: p, status: 'success' });
      return { reply, provider: type, model: model || 'gemini-2.0-flash', attempts };
    } catch (err) {
      attempts.push({ provider: p, status: 'failed', error: err.message });
    }
  }
  const err = new AIProviderError('All AI providers failed or budget was exceeded.', 503);
  err.attempts = attempts;
  throw err;
}