const DEV_ORIGINS = [
  "http://localhost:5174",
  "http://127.0.0.1:5174",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];

function isProduction(env) {
  return (
    String(env?.NODE_ENV || "").toLowerCase() === "production" ||
    Boolean(env?.VERCEL)
  );
}

export function getAllowedOrigins(env = process.env) {
  // CORS_ALLOWED_ORIGINS is the documented name; ALLOWED_ORIGINS stays supported
  // for existing deployments. Wildcards and malformed entries are dropped.
  const raw = String(env?.CORS_ALLOWED_ORIGINS || env?.ALLOWED_ORIGINS || "").trim();
  const list = raw
    .split(",")
    .map((origin) => origin.trim().replace(/\/+$/, ""))
    .filter(
      (origin) =>
        origin &&
        origin !== "*" &&
        !origin.includes("*") &&
        /^https?:\/\/[^\s/]+$/i.test(origin),
    );
  if (list.length) return [...new Set(list)];
  // Dev defaults only; production without an explicit allow-list fails closed.
  return isProduction(env) ? [] : [...DEV_ORIGINS];
}

export function isOriginAllowed(origin, env = process.env) {
  if (!origin) return true;
  // Credentialed CORS requires an exact allow-list entry; wildcards are rejected.
  return getAllowedOrigins(env).includes(origin);
}

/**
 * Applies CORS headers and handles OPTIONS preflight.
 * Returns true when the request was already answered.
 */
export function applyCors(req, res, env = process.env) {
  const origin = req?.headers?.origin;
  const allowed = isOriginAllowed(origin, env);

  if (origin && allowed) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET,POST,PATCH,DELETE,OPTIONS",
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Grandmaster-Token, X-Request-Id",
  );
  res.setHeader("Access-Control-Max-Age", "600");

  if (req?.method === "OPTIONS") {
    if (!allowed) {
      res.status(403).json({ error: "Origin not allowed by CORS." });
      return true;
    }
    res.status(204).end();
    return true;
  }

  if (!allowed) {
    res.status(403).json({ error: "Origin not allowed by CORS." });
    return true;
  }
  return false;
}

export function corsMiddleware(req, res, env = process.env) {
  return applyCors(req, res, env);
}

export function withCors(handler, env = process.env) {
  return async (req, res) => {
    if (applyCors(req, res, env)) return;
    return handler(req, res);
  };
}

export default corsMiddleware;
