const DEFAULT_TIMEOUT_MS = 3_000;
const MAX_RESPONSE_BYTES = 512 * 1024;
const MAX_POSITIONS = 100;
const MAX_ABS_NUMBER = 1e12;

export const MT5_ERRORS = {
  MT5_BRIDGE_NOT_CONFIGURED:
    "No MT5 bridge is configured. Set MT5_BRIDGE_URL on the server.",
  MT5_BRIDGE_BLOCKED_URL:
    "The configured MT5 bridge URL is not a loopback address and was blocked by policy.",
  MT5_BRIDGE_TIMEOUT: "The MT5 bridge did not respond before the timeout.",
  MT5_BRIDGE_UNREACHABLE: "The MT5 bridge could not be reached.",
  MT5_BRIDGE_INVALID_RESPONSE:
    "The MT5 bridge returned an invalid or oversized response.",
};

const READ_ONLY = Object.freeze({ readOnly: true, tradingLocked: true });

function isLoopbackHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  if (host === "localhost" || host === "::1" || host === "[::1]") return true;
  const match = host.match(/^127(?:\.(\d{1,3})){3}$/);
  if (!match) return false;
  return host
    .split(".")
    .slice(1)
    .every((octet) => Number(octet) <= 255);
}

function parseBridgeUrl(raw) {
  let url;
  try {
    url = new URL(String(raw || "").trim());
  } catch {
    return { ok: false, code: "MT5_BRIDGE_BLOCKED_URL" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, code: "MT5_BRIDGE_BLOCKED_URL" };
  }
  if (url.username || url.password) {
    return { ok: false, code: "MT5_BRIDGE_BLOCKED_URL" };
  }
  if (url.search || url.hash) {
    return { ok: false, code: "MT5_BRIDGE_BLOCKED_URL" };
  }
  if (!isLoopbackHost(url.hostname)) {
    return { ok: false, code: "MT5_BRIDGE_BLOCKED_URL" };
  }
  const base = `${url.origin}${url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`}`;
  return { ok: true, base, snapshotUrl: new URL("snapshot", base).toString() };
}

function errorResult(code) {
  return {
    ok: false,
    error: { code, message: MT5_ERRORS[code] || MT5_ERRORS.MT5_BRIDGE_UNREACHABLE },
  };
}

async function readCappedText(response, maxBytes) {
  if (!response.body || typeof response.body.getReader !== "function") {
    const text = await response.text();
    return new TextEncoder().encode(text).length > maxBytes
      ? { tooLarge: true }
      : { text };
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return { tooLarge: true };
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { text: new TextDecoder().decode(merged) };
}

function safeNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number) || Math.abs(number) > MAX_ABS_NUMBER) return null;
  return Math.round(number * 100) / 100;
}

// FX/metals prices need more than 2 decimals; money and volume do not.
function safePrice(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number) || Math.abs(number) > MAX_ABS_NUMBER) return null;
  return Math.round(number * 100000) / 100000;
}

function safeText(value, max = 64) {
  if (value === null || value === undefined) return null;
  const text = String(value)
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
  return text || null;
}

function maskLogin(value) {
  if (value === null || value === undefined || value === "") return null;
  const text = String(value).replace(/\s+/g, "");
  // The bridge already masks the login as ****1234; keep it instead of
  // masking a second time into a bare ****.
  if (/^\*{2,}[0-9A-Za-z._-]{0,4}$/.test(text)) return text;
  if (!/^[0-9A-Za-z._-]{1,64}$/.test(text)) return "****";
  return text.length > 4 ? `****${text.slice(-4)}` : "****";
}

function normalizeSide(value) {
  if (value === 0 || /^buy$/i.test(String(value))) return "BUY";
  if (value === 1 || /^sell$/i.test(String(value))) return "SELL";
  return "UNKNOWN";
}

function sanitizePosition(position) {
  if (!position || typeof position !== "object" || Array.isArray(position)) return null;
  return {
    symbol: safeText(position.symbol, 24) || "UNKNOWN",
    side: normalizeSide(position.side ?? position.type),
    volume: safeNumber(position.volume),
    openPrice: safePrice(position.openPrice ?? position.open_price ?? position.priceOpen),
    currentPrice: safePrice(position.currentPrice ?? position.current_price ?? position.priceCurrent),
    profit: safeNumber(position.profit),
  };
}

function safeIso(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function sanitizeAccount(account) {
  const source = account && typeof account === "object" && !Array.isArray(account) ? account : {};
  const currency = safeText(source.currency, 8);
  const tradeMode = ["demo", "contest", "real"].includes(source.tradeMode)
    ? source.tradeMode
    : source.isDemo === true
      ? "demo"
      : "unknown";
  return {
    login: maskLogin(source.login),
    server: safeText(source.server, 64),
    currency: currency && /^[A-Za-z]{2,6}$/.test(currency) ? currency.toUpperCase() : null,
    balance: safeNumber(source.balance),
    equity: safeNumber(source.equity),
    margin: safeNumber(source.margin),
    freeMargin: safeNumber(source.freeMargin ?? source.free_margin ?? source.marginFree),
    profit: safeNumber(source.profit),
    tradeMode,
    isDemo: tradeMode === "demo",
  };
}

function sanitizeTerminal(terminal) {
  const source =
    terminal && typeof terminal === "object" && !Array.isArray(terminal) ? terminal : {};
  return {
    connected: source.connected === true,
    build: safeNumber(source.build),
    company: safeText(source.company, 48),
  };
}

function sanitizeSymbolHealth(symbol) {
  if (!symbol || typeof symbol !== "object" || Array.isArray(symbol)) return null;
  const name = safeText(symbol.name, 24);
  if (!name) return null;
  const age = safeNumber(symbol.tickAgeSeconds);
  return {
    name,
    available: symbol.available === true,
    visible: symbol.visible === true,
    bid: safePrice(symbol.bid),
    ask: safePrice(symbol.ask),
    tickTime: safeIso(symbol.tickTime),
    tickAgeSeconds: Number.isFinite(age) && age >= 0 ? Math.round(age) : null,
    stale: symbol.stale === true,
  };
}

export function getMt5Status(env = process.env) {
  const raw = String(env?.MT5_BRIDGE_URL || "").trim();
  if (!raw) {
    return {
      ...READ_ONLY,
      configured: false,
      status: "not_connected",
      reasonCode: "MT5_BRIDGE_NOT_CONFIGURED",
      message: MT5_ERRORS.MT5_BRIDGE_NOT_CONFIGURED,
    };
  }
  const parsed = parseBridgeUrl(raw);
  if (!parsed.ok) {
    return {
      ...READ_ONLY,
      configured: true,
      status: "blocked",
      reasonCode: parsed.code,
      message: MT5_ERRORS.MT5_BRIDGE_BLOCKED_URL,
    };
  }
  return {
    ...READ_ONLY,
    configured: true,
    status: "configured_unverified",
    reasonCode: "MT5_BRIDGE_CONFIGURED_NOT_VERIFIED",
    message:
      "A loopback bridge URL is configured. Connectivity is verified only when a read-only snapshot is loaded.",
  };
}

export async function probeMt5Status({
  env = process.env,
  fetchImpl,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const base = getMt5Status(env);
  if (!base.configured || base.status === "blocked") {
    return { ...base, reachable: false, terminalConnected: false };
  }

  const result = await readMt5Snapshot({ env, fetchImpl, timeoutMs });
  if (!result.ok) {
    const invalidResponse = result.error.code === "MT5_BRIDGE_INVALID_RESPONSE";
    return {
      ...base,
      configured: true,
      reachable: invalidResponse,
      terminalConnected: false,
      status: invalidResponse ? "bridge_invalid_response" : "offline",
      reasonCode: result.error.code,
      message: MT5_ERRORS[result.error.code],
      symbolHealth: null,
    };
  }

  const connected = result.snapshot.connected === true;
  return {
    ...base,
    configured: true,
    reachable: true,
    terminalConnected: connected,
    status: connected ? "online" : "terminal_disconnected",
    reasonCode: connected ? "MT5_BRIDGE_ONLINE" : "MT5_BRIDGE_TERMINAL_DISCONNECTED",
    message: connected
      ? "The read-only bridge is reachable and an MT5 terminal is connected."
      : "The bridge is reachable, but no MT5 terminal is logged in or connected.",
    // Public market-data health only. No account, login or positions here.
    symbolHealth: result.snapshot.symbolHealth || null,
  };
}

export async function readMt5Snapshot({
  env = process.env,
  fetchImpl,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const status = getMt5Status(env);
  if (!status.configured) return errorResult("MT5_BRIDGE_NOT_CONFIGURED");
  if (status.status === "blocked") return errorResult("MT5_BRIDGE_BLOCKED_URL");

  const bridge = parseBridgeUrl(env?.MT5_BRIDGE_URL);
  if (!bridge.ok) return errorResult("MT5_BRIDGE_BLOCKED_URL");

  const doFetch = fetchImpl || globalThis.fetch;
  if (typeof doFetch !== "function") return errorResult("MT5_BRIDGE_UNREACHABLE");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(100, Number(timeoutMs) || DEFAULT_TIMEOUT_MS));
  let text;
  try {
    const response = await doFetch(bridge.snapshotUrl, {
      method: "GET",
      headers: { accept: "application/json" },
      redirect: "error",
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response || !response.ok) return errorResult("MT5_BRIDGE_UNREACHABLE");
    text = await response.text();
  } catch (error) {
    return errorResult(error?.name === "AbortError" ? "MT5_BRIDGE_TIMEOUT" : "MT5_BRIDGE_UNREACHABLE");
  } finally {
    clearTimeout(timer);
  }

  if (typeof text !== "string" || new TextEncoder().encode(text).length > MAX_RESPONSE_BYTES) {
    return errorResult("MT5_BRIDGE_INVALID_RESPONSE");
  }

  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    return errorResult("MT5_BRIDGE_INVALID_RESPONSE");
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return errorResult("MT5_BRIDGE_INVALID_RESPONSE");
  }
  if (typeof payload.connected !== "boolean") {
    return errorResult("MT5_BRIDGE_INVALID_RESPONSE");
  }

  const fetchedAt = new Date().toISOString();
  if (payload.connected !== true) {
    const terminalReason =
      typeof payload.reason === "string" && /^[a-z_]{1,40}$/.test(payload.reason)
        ? payload.reason
        : null;
    return {
      ok: true,
      snapshot: {
        ...READ_ONLY,
        source: "mt5-bridge",
        connected: false,
        reasonCode: "MT5_BRIDGE_NOT_CONNECTED",
        terminalReason,
        fetchedAt,
        checkedAt: safeIso(payload.checkedAt),
        terminal: sanitizeTerminal(payload.terminal),
        account: null,
        positions: [],
        positionsTruncated: false,
        symbolHealth: sanitizeSymbolHealth(payload.symbolHealth),
      },
    };
  }

  if (!payload.account || typeof payload.account !== "object" || Array.isArray(payload.account)) {
    return errorResult("MT5_BRIDGE_INVALID_RESPONSE");
  }

  const rawPositions = Array.isArray(payload.positions) ? payload.positions : [];
  const positions = rawPositions
    .slice(0, MAX_POSITIONS)
    .map(sanitizePosition)
    .filter(Boolean);

  return {
    ok: true,
    snapshot: {
      ...READ_ONLY,
      source: "mt5-bridge",
      connected: true,
      fetchedAt,
      checkedAt: safeIso(payload.checkedAt),
      terminal: sanitizeTerminal(payload.terminal),
      account: sanitizeAccount(payload.account),
      positions,
      positionsTruncated: rawPositions.length > MAX_POSITIONS,
      symbolHealth: sanitizeSymbolHealth(payload.symbolHealth),
    },
  };
}
