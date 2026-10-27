import crypto from "node:crypto";

export const GATES = {
  GREEN: "GREEN",
  NOT_CONNECTED: "NOT CONNECTED",
  APPROVAL_REQUIRED: "APPROVAL REQUIRED",
  LOCKED: "LOCKED",
};

const MIN_TOKEN_LENGTH = 16;

export function getControlToken(env = process.env) {
  const token = String(env?.GRANDMASTER_CONTROL_TOKEN || "").trim();
  return token.length >= MIN_TOKEN_LENGTH ? token : "";
}

export function hasControlAuthority(env = process.env) {
  return Boolean(getControlToken(env));
}

function readHeader(headers = {}, name) {
  if (!headers || typeof headers !== "object") return "";
  const direct = headers[name];
  if (typeof direct === "string") return direct;
  const lower = name.toLowerCase();
  if (typeof headers[lower] === "string") return headers[lower];
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower && typeof value === "string") return value;
  }
  return "";
}

export function authorizeControlRequest(headers = {}, env = process.env) {
  const expected = getControlToken(env);
  if (!expected) {
    return {
      ok: false,
      status: 503,
      code: "APPROVAL_AUTHORITY_NOT_CONFIGURED",
      message:
        "No control authority is configured. Set GRANDMASTER_CONTROL_TOKEN (16+ chars) on the server to enable approvals.",
    };
  }
  const provided = readHeader(headers, "x-grandmaster-token").trim();
  if (!provided) {
    return {
      ok: false,
      status: 403,
      code: "APPROVAL_REQUIRED",
      message: "This operation requires explicit control authorization.",
    };
  }
  const expectedHash = crypto.createHash("sha256").update(expected).digest();
  const providedHash = crypto.createHash("sha256").update(provided).digest();
  if (!crypto.timingSafeEqual(expectedHash, providedHash)) {
    return {
      ok: false,
      status: 403,
      code: "INVALID_CONTROL_TOKEN",
      message: "Control authorization was rejected.",
    };
  }
  return { ok: true, status: 200, code: "AUTHORIZED", message: "Authorized." };
}

export function gateForAgent(agent, context = {}) {
  if (!agent) return GATES.NOT_CONNECTED;
  if (agent.implementation === "locked") return GATES.LOCKED;
  // These agents exist only for a financial domain whose execution is prohibited.
  // Policy lock is the primary truth, even when the read-only bridge is also absent.
  if (agent.id === "trading_monitor" || agent.id === "binance_research") {
    return GATES.LOCKED;
  }
  if (agent.implementation === "not_connected") return GATES.NOT_CONNECTED;
  if (agent.approval === "required" || agent.approval === "external_only") {
    return GATES.APPROVAL_REQUIRED;
  }
  if (context.storageAvailable === false) return GATES.NOT_CONNECTED;
  // Advisory agents only earn GREEN after a real provider verification call.
  if (agent.implementation === "advisory" && context.providerVerified !== true) {
    return GATES.NOT_CONNECTED;
  }
  return GATES.GREEN;
}
