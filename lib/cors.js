const DEV_ORIGINS = [
  "http://localhost:5174",
  "http://127.0.0.1:5174",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
];

// Vercel names every deployment of this project
// `<project>-<hash>-<team>.vercel.app` (ground truth: `vercel ls`, e.g.
// grandmaster-digital-etmmzfm8r-businesskids62-4987.vercel.app). Both halves are
// pinned here on purpose: `endsWith(".vercel.app")` would extend credentialed
// trust to every deployment on the platform, including other tenants'.
const VERCEL_PROJECT_PREFIX = "grandmaster-digital";
const VERCEL_TEAM_SLUG = "businesskids62-4987";

// Every header the SPA really sends. A missing entry fails the preflight and the
// request never reaches its handler, so this list is a contract, not a hint.
const ALLOWED_REQUEST_HEADERS =
  "Content-Type, Authorization, X-CSRF-Token, X-Grandmaster-Token, " +
  "X-Grandmaster-Operator-Token, X-Gm-Surface, X-Request-Id";

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

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A parsed, bare origin: no path, query, fragment, credentials or port. Anything
 * else is rejected because a browser never sends it and every spoof in the wild
 * (`x.vercel.app.evil.test`, embedded `@`, trailing `/`) carries one of them.
 */
function originUrl(origin) {
  if (typeof origin !== "string" || !origin) return null;
  let url;
  try {
    url = new URL(origin);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password || url.search || url.hash) return null;
  if (url.pathname !== "/" && url.pathname !== "") return null;
  return url;
}

/**
 * True for this project's own Vercel deployments, whose hostnames are generated
 * per deployment and can therefore never be listed in CORS_ALLOWED_ORIGINS.
 * Anchored on both the project prefix and the team slug, so another Vercel
 * tenant's `grandmaster-digital…-<their-slug>.vercel.app` stays denied.
 * `VERCEL_URL` is the platform's own name for the current deployment; it is
 * process env, never a request header, so matching it adds no client trust.
 */
export function isVercelDeploymentOrigin(origin, env = process.env) {
  const url = originUrl(origin);
  if (!url || url.protocol !== "https:" || url.port) return false;
  const host = url.hostname.toLowerCase();
  if (!/\.vercel\.app$/.test(host)) return false;

  const prefix = String(env?.VERCEL_PROJECT_PREFIX || VERCEL_PROJECT_PREFIX).toLowerCase();
  const team = String(env?.VERCEL_TEAM_SLUG || VERCEL_TEAM_SLUG).toLowerCase();
  if (/^[a-z0-9][a-z0-9-]*$/.test(prefix) && /^[a-z0-9][a-z0-9-]*$/.test(team)) {
    if (new RegExp(`^${escapeRegExp(prefix)}[a-z0-9-]*-${escapeRegExp(team)}\\.vercel\\.app$`).test(host)) {
      return true;
    }
  }

  const own = String(env?.VERCEL_URL || "")
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
  return Boolean(own) && own === host;
}

/**
 * The page and the API are the same deployment whenever the browser's Origin
 * equals the host answering the request. This is the case that actually broke
 * preview logins: browsers send `Origin` on same-origin POSTs too, and a preview
 * has no CORS_ALLOWED_ORIGINS, so the exact-only list answered its own page 403.
 * Only `host` is consulted — `x-forwarded-host` is not trusted as platform-set.
 */
export function isSameOriginRequest(req, origin) {
  const host = String(req?.headers?.host || "").toLowerCase();
  const url = originUrl(origin);
  if (!host || !url) return false;
  return url.host.toLowerCase() === host;
}

export function isOriginAllowed(origin, env = process.env) {
  if (!origin) return true;
  // Credentialed CORS needs an exact allow-list entry; wildcards are rejected.
  // The deployment matcher is the only pattern, and it is pinned to this project.
  if (getAllowedOrigins(env).includes(origin)) return true;
  return isVercelDeploymentOrigin(origin, env);
}

/**
 * Applies CORS headers and handles OPTIONS preflight.
 * Returns true when the request was already answered.
 */
export function applyCors(req, res, env = process.env) {
  const origin = req?.headers?.origin;
  const allowed = isOriginAllowed(origin, env) || isSameOriginRequest(req, origin);

  // Vary always, so a cached denial can never be served to an allowed origin.
  res.setHeader("Vary", "Origin");
  if (origin && allowed) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  );
  res.setHeader("Access-Control-Allow-Headers", ALLOWED_REQUEST_HEADERS);
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
