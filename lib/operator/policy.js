import crypto from "node:crypto";

export const ALLOWED_TOOLS = new Set(["navigate", "read", "click", "fill", "select", "press", "wait"]);
export const MUTATING_TOOLS = new Set(["click", "fill", "select", "press"]);
export const PROHIBITED_TOOLS = new Set([
  "submit",
  "purchase",
  "payment",
  "trade",
  "withdraw",
  "transfer",
  "upload",
  "download",
  "delete",
  "execute_script",
  "evaluate",
  "javascript",
  "solve_captcha",
  "desktop_control",
  "os_control",
]);
export const MAX_ACTIONS = 12;
export const MAX_VALUE_CHARS = 500;
export const MAX_PLAN_BYTES = 8 * 1024;
export const MAX_URL_CHARS = 2048;
export const APPROVAL_CONFIRMATION = "APPROVE";

const FINANCIAL_INTENT =
  /\b(withdraw|withdrawal|transfer\s+funds|send\s+money|make\s+(a\s+)?payment|payment\s+details|place\s+(an\s+)?order|buy\s+crypto|sell\s+crypto|bank\s+transfer|crypto\s+withdrawal|trading\s+order)\b/i;
const IRREVERSIBLE_INTENT = /\b(delete\s+account|cancel\s+subscription|drop\s+database|format\s+disk)\b/i;
const DOMAIN_PATTERN = /^(\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
const IPV4_PATTERN = /^\d{1,3}(\.\d{1,3}){3}$/;

function failure(status, code, message) {
  return { ok: false, status, code, message };
}

export function normalizeHost(host) {
  return String(host || "")
    .trim()
    .toLowerCase()
    .replace(/\.$/, "")
    .replace(/^\[|\]$/g, "");
}

export function parseAllowedHosts(env = process.env) {
  const raw = String(env?.GRANDMASTER_OPERATOR_ALLOWED_HOSTS || "").trim();
  if (!raw) return { configured: false, hosts: [] };
  const hosts = raw
    .split(",")
    .map(normalizeHost)
    .filter(Boolean);
  const valid = hosts.every(
    (host) =>
      host === "localhost" ||
      host === "::1" ||
      IPV4_PATTERN.test(host) ||
      DOMAIN_PATTERN.test(host),
  );
  if (!valid || hosts.length === 0) return { configured: false, hosts: [] };
  return { configured: true, hosts };
}

export function hostAllowed(host, allowedHosts) {
  const target = normalizeHost(host);
  return allowedHosts.some((entry) => {
    if (entry.startsWith("*.")) {
      const base = entry.slice(2);
      return target !== base && target.endsWith(`.${base}`);
    }
    return target === entry;
  });
}

function isLoopbackHost(host) {
  const target = normalizeHost(host);
  return target === "localhost" || target === "::1" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(target);
}

function isIpLiteral(host) {
  const target = normalizeHost(host);
  return IPV4_PATTERN.test(target) || target.includes(":");
}

export function loopbackAllowed(env = process.env) {
  return String(env?.GRANDMASTER_OPERATOR_ALLOW_LOOPBACK || "") === "1";
}

/**
 * Fail-closed navigation policy. Only HTTPS hosts on the configured allowlist
 * are accepted; loopback requires an explicit opt-in AND an allowlist entry.
 */
export function validateNavigationUrl(rawUrl, env = process.env) {
  if (typeof rawUrl !== "string" || !rawUrl.trim()) {
    return failure(400, "OPERATOR_INVALID_URL", "A navigation URL is required.");
  }
  const trimmed = rawUrl.trim();
  if (trimmed.length > MAX_URL_CHARS) {
    return failure(400, "OPERATOR_INVALID_URL", "The navigation URL is too long.");
  }

  let url;
  try {
    url = new URL(trimmed);
  } catch {
    return failure(400, "OPERATOR_INVALID_URL", "The navigation URL is not valid.");
  }

  if (url.username || url.password) {
    return failure(403, "OPERATOR_URL_CREDENTIALS_BLOCKED", "Credentials in URLs are blocked.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return failure(403, "OPERATOR_URL_SCHEME_BLOCKED", "Only HTTP(S) navigation is allowed.");
  }

  const host = normalizeHost(url.hostname);
  if (!host) {
    return failure(403, "OPERATOR_URL_HOST_NOT_ALLOWED", "The navigation host is not allowed.");
  }
  if (isLoopbackHost(host)) {
    if (!loopbackAllowed(env)) {
      return failure(
        403,
        "OPERATOR_URL_LOOPBACK_BLOCKED",
        "Loopback navigation requires GRANDMASTER_OPERATOR_ALLOW_LOOPBACK=1.",
      );
    }
    const allowed = parseAllowedHosts(env);
    if (!allowed.configured) {
      return failure(503, "OPERATOR_POLICY_NOT_CONFIGURED", "The operator host allowlist is not configured.");
    }
    if (!hostAllowed(host, allowed.hosts)) {
      return failure(403, "OPERATOR_URL_HOST_NOT_ALLOWED", "The navigation host is not allowed.");
    }
    return { ok: true, url: url.href, host, loopback: true };
  }

  if (url.protocol === "http:") {
    return failure(403, "OPERATOR_URL_HTTPS_REQUIRED", "HTTPS is required for non-loopback navigation.");
  }
  if (isIpLiteral(host)) {
    return failure(403, "OPERATOR_URL_IP_BLOCKED", "IP literal hosts are blocked.");
  }
  if (url.port && url.port !== "443") {
    return failure(403, "OPERATOR_URL_PORT_BLOCKED", "Only the default HTTPS port is allowed.");
  }

  const allowed = parseAllowedHosts(env);
  if (!allowed.configured) {
    return failure(503, "OPERATOR_POLICY_NOT_CONFIGURED", "The operator host allowlist is not configured.");
  }
  if (!hostAllowed(host, allowed.hosts)) {
    return failure(403, "OPERATOR_URL_HOST_NOT_ALLOWED", "The navigation host is not allowed.");
  }
  return { ok: true, url: url.href, host, loopback: false };
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const keys = Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function hashPlan(plan) {
  return crypto.createHash("sha256").update(canonicalJson(plan)).digest("hex");
}

function deepFreeze(value) {
  if (value && typeof value === "object") {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

const TARGET_REF = /^gmop-\d{1,3}$/;

export function validatePlan(rawPlan, env = process.env) {
  if (!rawPlan || typeof rawPlan !== "object" || Array.isArray(rawPlan)) {
    return failure(400, "OPERATOR_INVALID_PLAN", "A plan object with actions is required.");
  }
  if (rawPlan.version !== undefined && rawPlan.version !== 1) {
    return failure(400, "OPERATOR_INVALID_PLAN", "Unsupported plan version.");
  }
  const actions = rawPlan.actions;
  if (!Array.isArray(actions) || actions.length === 0) {
    return failure(400, "OPERATOR_INVALID_PLAN", "A plan must contain at least one action.");
  }
  if (actions.length > MAX_ACTIONS) {
    return failure(413, "OPERATOR_PLAN_TOO_LARGE", `A plan may contain at most ${MAX_ACTIONS} actions.`);
  }
  let serialized;
  try {
    serialized = JSON.stringify(rawPlan);
  } catch {
    return failure(400, "OPERATOR_INVALID_PLAN", "The plan is not serializable.");
  }
  if (serialized.length > MAX_PLAN_BYTES) {
    return failure(413, "OPERATOR_PLAN_TOO_LARGE", "The plan exceeds the size limit.");
  }

  const normalized = [];
  for (const raw of actions) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return failure(400, "OPERATOR_INVALID_ACTION", "Each action must be an object.");
    }
    const tool = String(raw.tool || "").trim().toLowerCase();
    if (PROHIBITED_TOOLS.has(tool)) {
      return failure(403, "OPERATOR_ACTION_PROHIBITED", `The tool "${tool}" is blocked by policy.`);
    }
    if (!ALLOWED_TOOLS.has(tool)) {
      return failure(403, "OPERATOR_UNKNOWN_TOOL", `The tool "${tool}" is not allowed.`);
    }

    const action = { tool };
    if (tool === "navigate") {
      const navigation = validateNavigationUrl(raw.url, env);
      if (!navigation.ok) return navigation;
      action.url = navigation.url;
    } else if (tool === "wait") {
      const ms = Number(raw.ms ?? raw.value ?? 500);
      if (!Number.isFinite(ms) || ms < 50 || ms > 5000) {
        return failure(400, "OPERATOR_INVALID_WAIT", "Wait durations must be between 50 and 5000 ms.");
      }
      action.ms = Math.round(ms);
    } else {
      const ref = String(raw.ref ?? raw.target ?? "");
      if (!TARGET_REF.test(ref)) {
        return failure(403, "OPERATOR_INVALID_TARGET", "Actions must target a snapshot element reference.");
      }
      action.ref = ref;
      if (tool === "fill" || tool === "select" || tool === "press") {
        if (typeof raw.value !== "string" || raw.value.length === 0) {
          return failure(400, "OPERATOR_INVALID_ACTION", `The tool "${tool}" requires a value.`);
        }
        if (raw.value.length > MAX_VALUE_CHARS) {
          return failure(413, "OPERATOR_VALUE_TOO_LARGE", "Action values are limited to 500 characters.");
        }
        action.value = raw.value;
      }
    }

    const scan = `${tool} ${action.value || ""}`;
    if (FINANCIAL_INTENT.test(scan)) {
      return failure(
        403,
        "OPERATOR_FINANCIAL_ACTION_BLOCKED",
        "Financial actions are LOCKED by policy.",
      );
    }
    if (IRREVERSIBLE_INTENT.test(scan)) {
      return failure(403, "OPERATOR_ACTION_PROHIBITED", "Irreversible actions are blocked by policy.");
    }
    normalized.push(action);
  }

  const plan = deepFreeze({ version: 1, actions: normalized });
  return { ok: true, plan, hash: hashPlan(plan) };
}

export function validateApproval({ providedHash, confirmation, planHash }) {
  if (confirmation !== APPROVAL_CONFIRMATION) {
    return failure(400, "OPERATOR_CONFIRMATION_REQUIRED", `Type ${APPROVAL_CONFIRMATION} to approve the plan.`);
  }
  if (typeof providedHash !== "string" || !/^[a-f0-9]{64}$/i.test(providedHash)) {
    return failure(400, "OPERATOR_PLAN_HASH_REQUIRED", "The exact plan hash is required.");
  }
  if (providedHash.toLowerCase() !== planHash) {
    return failure(409, "OPERATOR_PLAN_HASH_MISMATCH", "The plan hash does not match the frozen plan.");
  }
  return { ok: true };
}

export function planRequiresApproval() {
  // Every plan is an external browser action; none bypass approval.
  return true;
}
