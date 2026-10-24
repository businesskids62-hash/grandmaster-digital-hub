// lib/cors.js
// Centralized CORS helper supporting ALLOWED_ORIGINS env variable

export function getAllowedOrigins(env = process.env) {
  const baseOrigins = [
    "http://localhost:5173",
    "http://localhost:5000",
    "https://grandmaster-digital-hub.vercel.app",
  ];
  const custom = (env.ALLOWED_ORIGINS || env.CORS_ORIGIN || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return Array.from(new Set([...baseOrigins, ...custom]));
}

export function applyCors(req, res, env = process.env) {
  const allowed = getAllowedOrigins(env);
  const origin = req.headers ? (req.headers.origin || req.headers.Origin) : null;

  if (origin && (allowed.includes(origin) || allowed.includes("*"))) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  } else if (!origin) {
    // Non-browser requests (e.g. curl)
    res.setHeader("Access-Control-Allow-Origin", "*");
  } else {
    // If origins are configured and request is from an unknown origin
    res.setHeader("Access-Control-Allow-Origin", allowed[0] || "*");
  }

  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-goog-api-key");
  res.setHeader("Access-Control-Allow-Credentials", "true");

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return true;
  }
  return false;
}
