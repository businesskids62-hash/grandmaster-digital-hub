import { useCallback, useEffect, useRef, useState } from "react";

class ApiError extends Error {
  constructor(message, code, status, requestId = null) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.requestId = requestId;
  }
}

async function request(apiBase, path, { token } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(`${apiBase}/api/v1${path}`, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
      headers: token ? { "X-Grandmaster-Token": token } : {},
    });
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    if (!response.ok || payload?.ok === false) {
      throw new ApiError(
        payload?.error?.message || `Request failed (${response.status})`,
        payload?.error?.code || "REQUEST_FAILED",
        response.status,
        payload?.requestId || null,
      );
    }
    if (!payload || typeof payload !== "object" || payload.ok !== true) {
      throw new ApiError(
        "The backend returned an unexpected response.",
        "MALFORMED_RESPONSE",
        response.status,
        payload?.requestId || null,
      );
    }
    return payload.data ?? {};
  } catch (error) {
    if (error.name === "AbortError") {
      throw new ApiError("Request timed out. Check the backend and retry.", "TIMEOUT", 0);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function Pill({ tone, children }) {
  return <span className={`gm-pill ${tone || ""}`}>{children}</span>;
}

function formatMoney(value, currency) {
  if (value === null || value === undefined) return "—";
  try {
    return new Intl.NumberFormat(undefined, {
      style: currency ? "currency" : "decimal",
      currency: currency || undefined,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return String(value);
  }
}

function formatPrice(value) {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 5 }).format(value);
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

function snapshotError(error) {
  if (error?.code === "APPROVAL_REQUIRED") {
    return "The control token is required to load account data.";
  }
  if (error?.code === "INVALID_CONTROL_TOKEN") {
    return "The control token was rejected. Account data was not returned.";
  }
  if (error?.code === "APPROVAL_AUTHORITY_NOT_CONFIGURED") {
    return "The server has no control authority configured. Set GRANDMASTER_CONTROL_TOKEN server-side.";
  }
  return error?.message || "The read-only snapshot could not be loaded.";
}

const BRIDGE_TONE = {
  configured_unverified: "gold",
  blocked: "red",
  not_connected: "red",
};

const BRIDGE_LABEL = {
  configured_unverified: "BRIDGE: CONFIGURED · NOT VERIFIED",
  blocked: "BRIDGE: BLOCKED BY POLICY",
  not_connected: "BRIDGE: NOT CONFIGURED",
};

export default function Mt5Monitor({ apiBase = "" }) {
  const [status, setStatus] = useState(null);
  const [statusError, setStatusError] = useState("");
  const [token, setToken] = useState("");
  const [snapshot, setSnapshot] = useState(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [loadingSnapshot, setLoadingSnapshot] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState("");
  const mounted = useRef(true);

  const loadStatus = useCallback(async () => {
    setLoadingStatus(true);
    setStatusError("");
    try {
      const data = await request(apiBase, "/mt5/status");
      if (!mounted.current) return;
      setStatus(data);
    } catch (e) {
      if (!mounted.current) return;
      setStatus(null);
      setStatusError(
        e?.code === "TIMEOUT" ? e.message : `Backend unreachable: ${e?.message || "request failed"}`,
      );
    } finally {
      if (mounted.current) setLoadingStatus(false);
    }
  }, [apiBase]);

  useEffect(() => {
    mounted.current = true;
    loadStatus();
    return () => {
      mounted.current = false;
    };
  }, [loadStatus]);

  async function loadSnapshot(event) {
    event?.preventDefault();
    const auth = token.trim();
    setError(null);
    setNotice("");
    if (!auth) {
      setNotice("Enter the server-side control token to load the read-only snapshot.");
      return;
    }
    setLoadingSnapshot(true);
    try {
      const data = await request(apiBase, "/mt5/snapshot", { token: auth });
      if (!mounted.current) return;
      const next = data.snapshot || null;
      setSnapshot(next);
      setNotice(
        next?.connected
          ? "Read-only snapshot loaded from the configured bridge."
          : "The bridge is reachable, but no MT5 terminal is connected. No account data was returned.",
      );
    } catch (e) {
      if (!mounted.current) return;
      setSnapshot(null);
      setError(e instanceof ApiError ? e : new ApiError("Snapshot request failed.", "REQUEST_FAILED", 0));
    } finally {
      if (mounted.current) setLoadingSnapshot(false);
    }
  }

  function clearSession() {
    setToken("");
    setSnapshot(null);
    setError(null);
    setNotice("");
  }

  const bridgeStatus = status?.status || "not_connected";
  const account = snapshot?.connected ? snapshot.account : null;
  const positions = Array.isArray(snapshot?.positions) ? snapshot.positions : [];

  return (
    <div className="mt5-root">
      <style>{mt5Css}</style>

      <div className="gm-welcome">
        <div>
          <div className="gm-kicker">TRADING · READ-ONLY MONITOR</div>
          <h1 className="gm-h1">
            MT5 <span className="gm-gradient">Monitor</span>
          </h1>
          <p className="gm-muted" style={{ margin: 0, maxWidth: 780 }}>
            Account snapshots are fetched by the server from a loopback bridge
            you configure. This page has no MT5 login, no broker credentials and
            no order or withdrawal controls.
          </p>
        </div>
        <div className="mt5-head-actions">
          <button type="button" className="gm-btn" onClick={loadStatus} disabled={loadingStatus}>
            {loadingStatus ? "Checking…" : "↻ Refresh status"}
          </button>
        </div>
      </div>

      <div className="gm-notice danger" style={{ marginBottom: 14 }}>
        <strong>TRADING LOCKED.</strong> Monitoring only. No order, close,
        cancel or withdrawal endpoint exists in this application. The browser
        never contacts MT5 or the bridge directly.
      </div>

      <section className="gm-card">
        <div className="gm-card-head">
          <div>
            <h2>Bridge configuration</h2>
            <p>Public status reports configuration only — never the bridge URL or account data.</p>
          </div>
          <Pill tone={loadingStatus ? "gold" : BRIDGE_TONE[bridgeStatus] || "red"}>
            {loadingStatus ? "BRIDGE: CHECKING" : BRIDGE_LABEL[bridgeStatus] || "BRIDGE: UNKNOWN"}
          </Pill>
        </div>
        <div className="mt5-status-strip">
          <Pill tone="green">READ ONLY</Pill>
          <Pill tone="green">TRADING LOCKED</Pill>
          <Pill tone={status?.configured ? "gold" : "red"}>
            CONFIGURED: {status?.configured ? "YES" : "NO"}
          </Pill>
          {status?.reasonCode && <Pill tone="gold">{status.reasonCode}</Pill>}
        </div>
        {statusError && <div className="gm-notice danger">{statusError}</div>}
        {status?.message && (
          <p className="gm-muted gm-small" style={{ marginBottom: 0 }}>
            {status.message}
          </p>
        )}
      </section>

      <form className="mt5-token-row" onSubmit={loadSnapshot}>
        <label className="mt5-token-label" htmlFor="gm-mt5-control-token">
          Control token
        </label>
        <input
          id="gm-mt5-control-token"
          className="gm-field mt5-token-input"
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder="Server-side control token"
          value={token}
          onChange={(event) => setToken(event.target.value)}
        />
        <button type="submit" className="gm-btn primary" disabled={loadingSnapshot}>
          {loadingSnapshot ? "Loading…" : "Load read-only snapshot"}
        </button>
        <button type="button" className="gm-btn ghost" onClick={clearSession} disabled={loadingSnapshot}>
          Clear token
        </button>
        <span className="gm-muted gm-small">
          {token.trim() ? "TOKEN ENTERED (memory only)" : "NO TOKEN"}
        </span>
      </form>

      {notice && <div className="gm-notice">{notice}</div>}

      {error && (
        <div className="gm-notice danger">
          <strong>{error.code}.</strong> {snapshotError(error)}
          {error.requestId ? (
            <span className="gm-muted gm-small"> (request {error.requestId})</span>
          ) : null}
        </div>
      )}

      {snapshot && (
        <section className="gm-card">
          <div className="gm-card-head">
            <div>
              <h2>Read-only snapshot</h2>
              <p>Fetched {formatDate(snapshot.fetchedAt)} · source {snapshot.source}</p>
            </div>
            <Pill tone={snapshot.connected ? "green" : "red"}>
              {snapshot.connected ? "TERMINAL: CONNECTED" : "TERMINAL: NOT CONNECTED"}
            </Pill>
          </div>

          {!snapshot.connected && (
            <div className="gm-notice">
              The bridge responded without a connected terminal. No account or
              position data was returned.
            </div>
          )}

          {account && (
            <>
              <div className="mt5-identity">
                <div>
                  <div className="gm-stat-note">LOGIN (MASKED SERVER-SIDE)</div>
                  <div className="mt5-identity-value">{account.login || "—"}</div>
                </div>
                <div>
                  <div className="gm-stat-note">SERVER</div>
                  <div className="mt5-identity-value">{account.server || "—"}</div>
                </div>
                <div>
                  <div className="gm-stat-note">CURRENCY</div>
                  <div className="mt5-identity-value">{account.currency || "—"}</div>
                </div>
              </div>

              <div className="mt5-account-grid">
                {[
                  ["Balance", account.balance],
                  ["Equity", account.equity],
                  ["Margin", account.margin],
                  ["Free margin", account.freeMargin],
                  ["Floating P/L", account.profit],
                ].map(([label, value]) => (
                  <div className="mt5-metric" key={label}>
                    <div className="gm-stat-note">{label}</div>
                    <div
                      className={`mt5-metric-value ${
                        label === "Floating P/L" && value !== null
                          ? value >= 0
                            ? "positive"
                            : "negative"
                          : ""
                      }`}
                    >
                      {formatMoney(value, account.currency)}
                    </div>
                  </div>
                ))}
              </div>

              <h3 className="mt5-table-title">Open positions ({positions.length})</h3>
              {positions.length === 0 ? (
                <p className="gm-muted gm-small" style={{ margin: 0 }}>
                  The bridge reported no open positions.
                </p>
              ) : (
                <div className="mt5-table-wrap">
                  <table className="mt5-table">
                    <thead>
                      <tr>
                        <th>Symbol</th>
                        <th>Side</th>
                        <th>Volume</th>
                        <th>Open</th>
                        <th>Current</th>
                        <th>Profit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {positions.map((position, index) => (
                        <tr key={`${position.symbol}-${index}`}>
                          <td>{position.symbol}</td>
                          <td>
                            <Pill
                              tone={
                                position.side === "BUY"
                                  ? "green"
                                  : position.side === "SELL"
                                    ? "red"
                                    : ""
                              }
                            >
                              {position.side}
                            </Pill>
                          </td>
                          <td>{position.volume === null ? "—" : position.volume}</td>
                          <td>{formatPrice(position.openPrice)}</td>
                          <td>{formatPrice(position.currentPrice)}</td>
                          <td
                            className={
                              position.profit === null
                                ? ""
                                : position.profit >= 0
                                  ? "positive"
                                  : "negative"
                            }
                          >
                            {formatMoney(position.profit, account.currency)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {snapshot.positionsTruncated && (
                <p className="gm-muted gm-small" style={{ marginBottom: 0 }}>
                  Only the first 100 positions are shown.
                </p>
              )}
            </>
          )}
        </section>
      )}

      <div className="gm-notice">
        <strong>Bridge contract:</strong> the server requests{" "}
        <code>GET /snapshot</code> from the configured loopback bridge, validates
        the response, masks the account login and exposes only symbol, side,
        volume, prices and profit per position. Tickets, comments and
        credentials are discarded.
      </div>
    </div>
  );
}

const mt5Css = `
.mt5-root{display:flex;flex-direction:column;gap:14px}
.mt5-head-actions{display:flex;gap:8px;align-items:flex-start}
.mt5-status-strip{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px}
.mt5-token-row{display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding:12px 14px;border:1px solid var(--border);border-radius:12px;background:#ffffff03}
.mt5-token-label{font-size:11px;font-weight:800;letter-spacing:.4px;text-transform:uppercase;color:var(--muted)}
.mt5-token-input{max-width:320px;padding:9px 11px}
.mt5-identity{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-bottom:14px}
.mt5-identity-value{font-size:13px;font-weight:800;margin-top:5px;overflow-wrap:anywhere}
.mt5-account-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px;margin-bottom:18px}
.mt5-metric{border:1px solid var(--border);border-radius:11px;background:#ffffff03;padding:11px 12px}
.mt5-metric-value{font-size:18px;font-weight:850;letter-spacing:-.4px;margin-top:7px;overflow-wrap:anywhere}
.mt5-metric-value.positive,.mt5-table td.positive{color:var(--green)}
.mt5-metric-value.negative,.mt5-table td.negative{color:var(--red)}
.mt5-table-title{margin:0 0 10px;font-size:13px;font-weight:800}
.mt5-table-wrap{overflow-x:auto;border:1px solid var(--border);border-radius:11px}
.mt5-table{width:100%;border-collapse:collapse;font-size:11px;min-width:560px}
.mt5-table th{text-align:left;padding:9px 11px;color:var(--muted);font-size:9px;letter-spacing:.6px;text-transform:uppercase;border-bottom:1px solid var(--border);background:#ffffff03}
.mt5-table td{padding:9px 11px;border-bottom:1px solid var(--border);font-weight:700}
.mt5-table tr:last-child td{border-bottom:0}
@media(max-width:900px){.mt5-account-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.mt5-identity{grid-template-columns:1fr}}
`;
