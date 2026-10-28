/* Browser-side debug pack builder.
   Mirrors the server masking rules so UI logs can never leak credentials.
   The server pack is still the authority for backend logs. */

const MASK_RULES = [
  [/AIza[0-9A-Za-z_-]{20,}/g, "[MASKED_API_KEY]"],
  [/sk-[0-9A-Za-z_-]{20,}/g, "[MASKED_API_KEY]"],
  [/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[MASKED]"],
  [
    /((?:api[_-]?key|access[_-]?token|token|secret|password|passwd|authorization|cookie|session[_-]?secret)\s*[=:]\s*)([^\s,;]+)/gi,
    "$1[MASKED]",
  ],
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

let uiSequence = 0;

export function createUiLogCode(prefix = "GMUI") {
  uiSequence += 1;
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${uiSequence
    .toString(36)
    .toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

function line(value, fallback = "—") {
  const text = maskSecrets(value ?? "").replace(/\s+/g, " ").trim();
  return text || fallback;
}

function statusText(entry) {
  if (!entry) return "not checked";
  return [
    line(entry.status || entry.label || "unknown"),
    entry.health ? `health ${line(entry.health)}` : null,
    entry.ok === false ? "ok=false" : null,
    entry.durable ? "durable" : entry.ephemeral ? "ephemeral" : null,
    entry.writable === false ? "read-only" : null,
    entry.readOnly ? "read-only" : null,
    entry.tradingLocked ? "trading LOCKED" : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function logLine(entry) {
  const head = `[${line(entry.code)}] ${line(entry.ts)} ${line(entry.level)} ${line(entry.event)}`;
  const details = [
    entry.errorCode ? `error=${line(entry.errorCode)}` : null,
    entry.status != null ? `status=${entry.status}` : null,
    entry.durationMs != null ? `duration=${entry.durationMs}ms` : null,
    entry.retryCount != null ? `attempts=${entry.retryCount}` : null,
    entry.provider ? `provider=${line(entry.provider)}` : null,
    entry.model ? `model=${line(entry.model)}` : null,
    entry.cached != null ? `cached=${entry.cached}` : null,
    entry.requestId ? `request=${line(entry.requestId)}` : null,
  ]
    .filter(Boolean)
    .join(" ");
  const message = entry.message ? `\n    message: ${line(entry.message)}` : "";
  const cause = entry.rootCause ? `\n    root cause: ${line(entry.rootCause)}` : "";
  return `${head}${details ? ` ${details}` : ""}${message}${cause}`;
}

function uiLogLine(entry) {
  const head = `[${line(entry.code)}] ${line(entry.ts || entry.time)} ${line(
    entry.level,
  )} ${line(entry.message)}`;
  const request = entry.requestId ? ` request=${line(entry.requestId)}` : "";
  const cause = entry.rootCause ? `\n    root cause: ${line(entry.rootCause)}` : "";
  return `${head}${request}${cause}`;
}

export function buildDebugPack({ diagnostics = null, serverError = "", client = {} } = {}) {
  const generatedAt = new Date().toISOString();
  const services = diagnostics?.services || {};
  const backend = services.backend || {};
  const ai = services.ai || {};
  const mt5 = services.mt5 || {};
  const storage = services.storage || {};
  const doctor = services.doctor || {};
  const stack = diagnostics?.stack || {};
  const serverErrors = Array.isArray(diagnostics?.errors) ? diagnostics.errors : [];
  const serverLogs = Array.isArray(diagnostics?.logs) ? diagnostics.logs : [];
  const uiLogs = Array.isArray(client.uiLogs) ? client.uiLogs : [];
  const uiErrors = uiLogs.filter(
    (entry) => entry.level === "warn" || entry.level === "error",
  );

  const parts = [];
  parts.push("=".repeat(72));
  parts.push("GRANDMASTER DIGITAL HUB — DEBUG PACK");
  parts.push("=".repeat(72));
  parts.push(`Generated: ${generatedAt}`);
  parts.push(
    `Build: ${line(client.build?.commitSha)} · ${line(client.build?.buildTime)}`,
  );
  parts.push(`Server request: ${line(diagnostics?.requestId)}`);
  parts.push(
    "Privacy: API keys, tokens and cookies are masked before anything is written here.",
  );
  parts.push("");

  parts.push("--- SERVICE STATUSES ---");
  parts.push(
    `Backend API: ${client.backend || "UNKNOWN"}${backend.health ? ` · health ${backend.health}` : ""}${
      backend.degraded ? " · degraded" : ""
    }${backend.reasonCodes?.length ? ` · reasons ${backend.reasonCodes.join(", ")}` : ""}`,
  );
  parts.push(
    `AI Provider: ${client.aiStatus || ai.health || "UNKNOWN"} · ${line(
      client.aiDetail?.model || ai.model,
      "model unknown",
    )}${ai.checkedAt ? ` · checked ${ai.checkedAt}` : ""}${
      ai.cached ? " · cached snapshot" : ""
    }${client.aiReason ? ` · note: ${line(client.aiReason)}` : ""}`,
  );
  parts.push(
    `Storage: ${client.storage ? statusText(client.storage) : statusText(storage)}`,
  );
  parts.push(
    `MT5 Bridge: ${line(client.mt5?.status || mt5.status)} · read-only · trading ${
      mt5.tradingLocked === false ? "UNLOCKED" : "LOCKED"
    }${client.mt5Checked ? ` · checked ${client.mt5Checked}` : ""}`,
  );
  parts.push("Trading Safety: LOCKED · no orders or money movement from this UI");
  parts.push(
    `Microphone: ${line(client.mic?.permission, "unknown permission")} · ${
      client.mic?.deviceCount ?? "?"
    } input(s) · speech recognition ${client.mic?.speechSupported ? "yes" : "no"} · ${
      client.isListening ? "listening" : "not listening"
    }${client.mic?.secureContext === false ? " · NOT A SECURE CONTEXT" : ""}`,
  );
  parts.push(
    `Doctor: SIMULATED (browser only) · ${
      client.doctor?.lastScan?.status ? line(client.doctor.lastScan.status) : "not run"
    } · ${client.doctor?.threats?.length ?? 0} simulated threat(s)`,
  );
  parts.push("");

  parts.push("--- BACKEND STACK ---");
  if (stack.runtime) {
    parts.push(
      `Runtime: node ${line(stack.runtime.node)} · ${line(stack.runtime.platform)} ${line(
        stack.runtime.arch,
      )} · serverless=${Boolean(stack.runtime.serverless)}`,
    );
  } else {
    parts.push("Runtime: unavailable (server diagnostics not loaded)");
  }
  parts.push(`Framework: ${line(stack.framework, "unknown")}`);
  const packages = stack.packages || {};
  const packageText = Object.entries(packages)
    .filter(([, version]) => version)
    .map(([name, version]) => `${name} ${version}`)
    .join(", ");
  parts.push(`Packages: ${packageText || "unavailable"}`);
  if (diagnostics?.environment) {
    parts.push(
      `Environment: NODE_ENV=${line(diagnostics.environment.nodeEnv)} · uptime ${
        diagnostics.environment.uptimeSeconds
      }s · serverless=${Boolean(diagnostics.environment.serverless)}`,
    );
  }
  parts.push(
    `Log buffer: ${diagnostics?.logsInfo?.size ?? 0}/${
      diagnostics?.logsInfo?.max ?? 0
    } entries · scope ${line(diagnostics?.logsInfo?.scope, "unknown")}`,
  );
  parts.push("");

  parts.push(
    `--- ACTIVE ERRORS (server ${serverErrors.length}, ui ${uiErrors.length}) ---`,
  );
  if (serverErrors.length === 0 && uiErrors.length === 0) {
    parts.push("No active warnings or errors recorded.");
  } else {
    if (serverErrors.length) {
      parts.push("Server:");
      serverErrors.forEach((entry) => parts.push(logLine(entry)));
    }
    if (uiErrors.length) {
      parts.push("Browser:");
      uiErrors.forEach((entry) => parts.push(uiLogLine(entry)));
    }
  }
  parts.push("");

  parts.push(`--- LAST ${serverLogs.length} SERVER LOG LINES ---`);
  if (serverError) {
    parts.push(`Server diagnostics unavailable: ${line(serverError)}`);
  } else if (serverLogs.length === 0) {
    parts.push("No server log entries in the process ring buffer.");
  } else {
    serverLogs.forEach((entry) => parts.push(logLine(entry)));
  }
  parts.push("");

  parts.push("--- CLIENT SNAPSHOT ---");
  parts.push(`Page: ${line(client.page)}`);
  parts.push(`Backend: ${client.backend || "UNKNOWN"}`);
  parts.push(`Health error: ${line(client.healthError, "none")}`);
  parts.push(
    `Last health check: ${line(client.lastChecked, "never")} · AI checked ${line(
      client.aiCheckedAt,
      "never",
    )} · MT5 checked ${line(client.mt5Checked, "never")}`,
  );
  parts.push(`AI status: ${client.aiStatus || "UNKNOWN"} · ${line(client.aiReason, "no note")}`);
  parts.push(`Mic checked: ${line(client.mic?.checkedAt, "never")}`);
  parts.push(`Doctor simulated scan: ${line(client.doctor?.lastScan?.status, "not run")}`);
  parts.push("");

  parts.push(`--- UI SESSION LOGS (${uiLogs.length}) ---`);
  if (uiLogs.length === 0) {
    parts.push("No UI session logs.");
  } else {
    uiLogs.forEach((entry) => parts.push(uiLogLine(entry)));
  }
  parts.push("");
  parts.push("--- END OF DEBUG PACK ---");

  return parts.join("\n");
}

function maskDeep(value) {
  if (typeof value === "string") return maskSecrets(value);
  if (Array.isArray(value)) return value.map(maskDeep);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, maskDeep(item)]),
    );
  }
  return value;
}

export function buildDebugPackJson({ diagnostics = null, serverError = "", client = {} } = {}) {
  return maskDeep({
    kind: "grandmaster-debug-pack",
    generatedAt: new Date().toISOString(),
    build: client.build || null,
    client,
    serverError: serverError || null,
    server: diagnostics,
  });
}

export async function copyText(text) {
  const value = String(text ?? "");
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      /* fall through to the textarea fallback */
    }
  }
  if (typeof document === "undefined") return false;
  const area = document.createElement("textarea");
  area.value = value;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.top = "-1000px";
  document.body.appendChild(area);
  area.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  document.body.removeChild(area);
  return ok;
}

export function downloadFile(filename, content, type = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
