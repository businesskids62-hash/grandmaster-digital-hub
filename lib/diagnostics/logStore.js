import crypto from "node:crypto";

// Process-local ring buffer for the debug pack. Serverless instances are
// isolated, so this is honest about its scope and never persisted to disk.

export const MAX_LOG_ENTRIES = 500;
const MAX_TEXT = 400;

const entries = [];
let sequence = 0;

const MASK_RULES = [
  // Provider API keys
  [/AIza[0-9A-Za-z_-]{20,}/g, "[MASKED_API_KEY]"],
  [/sk-[0-9A-Za-z_-]{20,}/g, "[MASKED_API_KEY]"],
  // Authorization headers
  [/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[MASKED]"],
  // key=value / key: value pairs for credential-like names
  [
    /((?:api[_-]?key|access[_-]?token|token|secret|password|passwd|authorization|cookie|session[_-]?secret)\s*[=:]\s*)([^\s,;]+)/gi,
    "$1[MASKED]",
  ],
  // JWTs and long hex digests (session HMACs, hashes)
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, "[MASKED_JWT]"],
  [/\b[0-9a-f]{64}\b/gi, "[MASKED_HEX]"],
];

export function maskSecrets(value) {
  let text = String(value ?? "");
  for (const [pattern, replacement] of MASK_RULES) {
    text = text.replace(pattern, replacement);
  }
  return text;
}

function clip(value) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}…` : text;
}

function numberOrNull(value) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function uniqueCode() {
  sequence += 1;
  const stamp = Date.now().toString(36).toUpperCase();
  const suffix = crypto.randomBytes(2).toString("hex").toUpperCase();
  return `GM-${stamp}-${sequence.toString(36).toUpperCase()}${suffix}`;
}

export function recordLog(input = {}) {
  const level = ["info", "warn", "error"].includes(input.level)
    ? input.level
    : "info";
  const entry = {
    code: input.code ? clip(input.code) : uniqueCode(),
    ts: input.ts ? new Date(input.ts).toISOString() : new Date().toISOString(),
    level,
    event: clip(input.event || "event"),
    message: clip(maskSecrets(input.message || "")),
    rootCause: clip(maskSecrets(input.rootCause || "")),
    requestId: clip(input.requestId || ""),
    status: numberOrNull(input.status),
    durationMs: numberOrNull(input.durationMs),
    errorCode: clip(input.errorCode || ""),
    errorCategory: clip(input.errorCategory || ""),
    retryCount: numberOrNull(input.retryCount),
    taskId: clip(input.taskId || ""),
    agentId: clip(input.agentId || ""),
    provider: clip(input.provider || ""),
    model: clip(input.model || ""),
    cached: typeof input.cached === "boolean" ? input.cached : null,
  };
  entries.push(entry);
  if (entries.length > MAX_LOG_ENTRIES) {
    entries.splice(0, entries.length - MAX_LOG_ENTRIES);
  }
  return { ...entry };
}

function clampLimit(limit, fallback) {
  const value = Number(limit);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(MAX_LOG_ENTRIES, Math.floor(value)));
}

// Oldest first, like a terminal tail.
export function getRecentLogs(limit = 50) {
  const size = clampLimit(limit, 50);
  if (size === 0) return [];
  return entries.slice(-size).map((entry) => ({ ...entry }));
}

// Newest first, only warnings and errors.
export function getActiveErrors(limit = 20) {
  const size = clampLimit(limit, 20);
  if (size === 0) return [];
  return entries
    .filter((entry) => entry.level === "warn" || entry.level === "error")
    .slice(-size)
    .reverse()
    .map((entry) => ({ ...entry }));
}

export function getLogBufferInfo() {
  return { size: entries.length, max: MAX_LOG_ENTRIES, scope: "process" };
}

export function resetLogStore() {
  entries.length = 0;
  sequence = 0;
}
