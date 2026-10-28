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

async function operatorRequest(
  apiBase,
  path,
  { method = "GET", operatorToken = "", controlToken = "", body } = {},
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  const headers = {};
  if (operatorToken) headers["X-Grandmaster-Operator-Token"] = operatorToken;
  if (controlToken) headers["X-Grandmaster-Token"] = controlToken;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  try {
    const response = await fetch(`${apiBase}/api/v1${path}`, {
      method,
      cache: "no-store",
      signal: controller.signal,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
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

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

const REF_PATTERN = /^gmop-\d{1,3}$/;
const MAX_ACTIONS = 12;
const TOOL_LABELS = {
  navigate: "Navigate",
  click: "Click",
  fill: "Type",
  select: "Select",
  press: "Press key",
  read: "Read",
  wait: "Wait",
};
const RUN_TONE = {
  AWAITING_APPROVAL: "gold",
  APPROVED: "gold",
  RUNNING: "gold",
  COMPLETED: "green",
  FAILED: "red",
  BLOCKED: "red",
};
const MANUAL_FALLBACK = {
  OPERATOR_CAPTCHA_DETECTED:
    "CAPTCHA automation se solve nahi hoga. Page manually khol kar CAPTCHA khud complete karein, phir naya snapshot lein.",
  OPERATOR_LOGIN_WALL:
    "Login page mila. Apne browser mein manually sign-in karein, phir is page se naya snapshot lein. Credentials is app mein kabhi na likhein.",
  OPERATOR_TIMEOUT:
    "Page ne time par jawab nahi diya. Browser tab manually check karein aur naya snapshot lein.",
  OPERATOR_BROWSER_DISCONNECTED:
    "Browser connection band ho gaya. Session stop karke dobara start karein.",
  OPERATOR_NO_CHANGE_OBSERVED:
    "Koi DOM change observe nahi hua, is liye success claim nahi kiya gaya. Page manually check karein.",
  OPERATOR_STALE_TARGET:
    "Element purana ho gaya. Naya snapshot lein aur plan dobara freeze karein.",
  OPERATOR_SENSITIVE_INPUT_BLOCKED:
    "Password ya secret field block hui hai. Aisi values manually enter karein, automation se nahi.",
  OPERATOR_FINANCIAL_ACTION_BLOCKED:
    "Financial action permanently LOCKED hai. Payment ya trading manually bhi is tool se nahi hogi.",
  OPERATOR_ACTION_PROHIBITED:
    "Yeh action policy se blocked hai. Manual review karein.",
};

function manualFallback(code) {
  return (
    MANUAL_FALLBACK[code] ||
    "Run ruk gaya hai. Page manually check karein, naya snapshot lein aur plan dobara banayein."
  );
}

function expectedResult(action) {
  switch (action.tool) {
    case "navigate":
      return action.host
        ? `Current tab mein ${action.host} khulega; allowed host par hi rehna zaroori hai.`
        : "Current tab mein approved URL khulega; host allowlist enforce hogi.";
    case "click":
      return "Element click hoga aur visible DOM change observe kiya jayega.";
    case "fill":
      return "Value field mein type hogi; password/file fields blocked hain.";
    case "select":
      return "Select field mein option choose hoga aur change observe hoga.";
    case "press":
      return "Diya gaya key press hoga aur change observe hoga.";
    case "read":
      return "Element ka text read-only mode mein parha jayega.";
    case "wait":
      return `Automation ${action.ms ?? 0} ms wait karega bina kisi interaction ke.`;
    default:
      return "Policy ke mutabiq action execute hoga.";
  }
}

function targetLabel(action) {
  if (action.tool === "navigate") return action.host || "—";
  if (action.tool === "wait") return "—";
  return action.ref || "—";
}

function proposedLabel(action) {
  if (action.tool === "wait") return `${action.ms} ms`;
  if (action.value !== undefined) return `${TOOL_LABELS[action.tool]} · value set`;
  return TOOL_LABELS[action.tool] || action.tool;
}

export default function BrowserOperator({ apiBase = "" }) {
  const [publicStatus, setPublicStatus] = useState(null);
  const [statusError, setStatusError] = useState(null);
  const [operatorStatus, setOperatorStatus] = useState(null);
  const [checking, setChecking] = useState(false);
  const [statusNotice, setStatusNotice] = useState("");
  const [statusActionError, setStatusActionError] = useState(null);
  const [operatorToken, setOperatorToken] = useState("");
  const [controlToken, setControlToken] = useState("");
  const [session, setSession] = useState(null);
  const [sessionBusy, setSessionBusy] = useState(false);
  const [snapshot, setSnapshot] = useState(null);
  const [snapshotBusy, setSnapshotBusy] = useState(false);
  const [url, setUrl] = useState("");
  const [tool, setTool] = useState("click");
  const [ref, setRef] = useState("");
  const [value, setValue] = useState("");
  const [waitMs, setWaitMs] = useState("500");
  const [drafts, setDrafts] = useState([]);
  const [run, setRun] = useState(null);
  const [confirmation, setConfirmation] = useState("");
  const [runBusy, setRunBusy] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState("");
  const draftId = useRef(1);
  const mounted = useRef(true);

  const loadPublicStatus = useCallback(async () => {
    setStatusError(null);
    try {
      const data = await operatorRequest(apiBase, "/status");
      if (!mounted.current) return;
      setPublicStatus(data.operator || null);
    } catch (e) {
      if (!mounted.current) return;
      setPublicStatus(null);
      setStatusError(e);
    }
  }, [apiBase]);

  useEffect(() => {
    mounted.current = true;
    loadPublicStatus();
    return () => {
      mounted.current = false;
    };
  }, [loadPublicStatus]);

  const info = operatorStatus || publicStatus;
  const connected = operatorStatus?.integrationStatus === "connected";
  const serverless = Boolean(info?.serverless);
  const verified = Boolean(info?.realConnectorVerified);
  const configured = Boolean(info?.configured);
  const canStart =
    connected && Boolean(operatorToken.trim()) && !session && !sessionBusy && !serverless;

  const missingConfiguration = [];
  if (info && !info.authConfigured) missingConfiguration.push("GRANDMASTER_OPERATOR_USERS");
  if (info && !info.policyConfigured) {
    missingConfiguration.push("GRANDMASTER_OPERATOR_ALLOWED_HOSTS");
  }
  if (info && !info.realConnectorVerified) {
    missingConfiguration.push("Real connector test evidence (operator-verification.json)");
  }
  if (serverless) missingConfiguration.push("Local or self-hosted runtime (serverless is unsupported)");

  async function checkOperator(event) {
    event?.preventDefault();
    const token = operatorToken.trim();
    setStatusActionError(null);
    setStatusNotice("");
    if (!token) {
      setStatusNotice("Operator token enter karein, phir check karein.");
      return;
    }
    setChecking(true);
    try {
      const data = await operatorRequest(apiBase, "/operator/status", {
        operatorToken: token,
      });
      if (!mounted.current) return;
      setOperatorStatus(data.operator || null);
      setStatusNotice(
        data.operator?.integrationStatus === "connected"
          ? "Operator token accepted. Real connector verified — session start ho sakta hai."
          : "Operator token accepted, lekin connector NOT CONNECTED hai. Neeche missing configuration dekhein.",
      );
    } catch (e) {
      if (!mounted.current) return;
      setOperatorStatus(null);
      setStatusActionError(
        e instanceof ApiError ? e : new ApiError("Status check failed.", "REQUEST_FAILED", 0),
      );
    } finally {
      if (mounted.current) setChecking(false);
    }
  }

  async function startSession() {
    setError(null);
    setNotice("");
    if (!canStart) {
      setNotice("Session start karne se pehle real connector verification aur operator token zaroori hain.");
      return;
    }
    setSessionBusy(true);
    try {
      const data = await operatorRequest(apiBase, "/operator/sessions", {
        method: "POST",
        operatorToken: operatorToken.trim(),
        body: {},
      });
      if (!mounted.current) return;
      setSession(data.session || null);
      setSnapshot(null);
      setRun(null);
      setDrafts([]);
      setNotice("Browser session start ho gaya. Ab snapshot lein ya URL ke saath plan banayein.");
      if (data.session?.id) await loadSnapshot(data.session.id, { quiet: true });
    } catch (e) {
      if (!mounted.current) return;
      setError(e instanceof ApiError ? e : new ApiError("Session start failed.", "REQUEST_FAILED", 0));
    } finally {
      if (mounted.current) setSessionBusy(false);
    }
  }

  async function stopSession() {
    if (!session) return;
    setError(null);
    setNotice("");
    setSessionBusy(true);
    try {
      await operatorRequest(apiBase, `/operator/sessions/${session.id}`, {
        method: "DELETE",
        operatorToken: operatorToken.trim(),
      });
      if (!mounted.current) return;
      setSession(null);
      setSnapshot(null);
      setRun(null);
      setDrafts([]);
      setConfirmation("");
      setNotice("Session stop ho gaya aur browser context band kar diya gaya.");
    } catch (e) {
      if (!mounted.current) return;
      setError(e instanceof ApiError ? e : new ApiError("Session stop failed.", "REQUEST_FAILED", 0));
    } finally {
      if (mounted.current) setSessionBusy(false);
    }
  }

  const loadSnapshot = useCallback(
    async (sessionId = session?.id, { quiet = false } = {}) => {
      if (!sessionId) {
        if (!quiet) setNotice("Pehle browser session start karein.");
        return;
      }
      setSnapshotBusy(true);
      if (!quiet) {
        setError(null);
        setNotice("");
      }
      try {
        const data = await operatorRequest(
          apiBase,
          `/operator/sessions/${sessionId}/snapshot`,
          { operatorToken: operatorToken.trim() },
        );
        if (!mounted.current) return;
        setSnapshot(data.snapshot || null);
        if (!quiet) {
          setNotice(
            data.snapshot?.blocked
              ? "Snapshot BLOCKED hai. Neeche reason aur manual fallback dekhein."
              : `Snapshot loaded: ${data.snapshot?.elements?.length || 0} element references.`,
          );
        }
      } catch (e) {
        if (!mounted.current) return;
        setSnapshot(null);
        if (!quiet) {
          setError(e instanceof ApiError ? e : new ApiError("Snapshot failed.", "REQUEST_FAILED", 0));
        }
      } finally {
        if (mounted.current) setSnapshotBusy(false);
      }
    },
    [apiBase, operatorToken, session?.id],
  );

  function clearCredentials() {
    setOperatorToken("");
    setControlToken("");
    setConfirmation("");
    setOperatorStatus(null);
    setStatusNotice("");
    setStatusActionError(null);
    setError(null);
    setNotice(
      session
        ? "Credentials memory se clear ho gaye. Active session ko stop karne ke liye dobara operator token chahiye hoga."
        : "Credentials memory se clear ho gaye. Kahin persist nahi kiye gaye.",
    );
  }

  function actionCount() {
    return drafts.length + (url.trim() ? 1 : 0);
  }

  function addDraft(event) {
    event.preventDefault();
    setError(null);
    setNotice("");
    if (!session) {
      setNotice("Action add karne se pehle session start karein.");
      return;
    }
    if (actionCount() >= MAX_ACTIONS) {
      setError(
        new ApiError(`Ek plan mein zyada se zyada ${MAX_ACTIONS} actions allowed hain.`, "DRAFT_LIMIT", 0),
      );
      return;
    }

    if (tool === "wait") {
      const ms = Number(waitMs);
      if (!Number.isFinite(ms) || ms < 50 || ms > 5000) {
        setError(new ApiError("Wait 50 se 5000 milliseconds ke darmiyan hona chahiye.", "DRAFT_INVALID_WAIT", 0));
        return;
      }
      setDrafts((list) => [...list, { id: draftId.current++, tool: "wait", ms: Math.round(ms) }]);
      setWaitMs("500");
      return;
    }

    const cleanRef = ref.trim();
    const target = snapshot?.elements?.find((element) => element.ref === cleanRef);
    if (!REF_PATTERN.test(cleanRef)) {
      setError(new ApiError("Target snapshot ka gmop-N reference hona chahiye.", "DRAFT_INVALID_TARGET", 0));
      return;
    }
    if (target?.sensitive) {
      setError(
        new ApiError(
          "Yeh password ya secret field hai. Aise fields automation se block hain.",
          "DRAFT_SENSITIVE_TARGET",
          0,
        ),
      );
      return;
    }
    if (target?.disabled) {
      setError(new ApiError("Yeh element disabled hai. Naya snapshot lein.", "DRAFT_DISABLED_TARGET", 0));
      return;
    }
    if (tool === "fill" || tool === "select" || tool === "press") {
      if (!value) {
        setError(new ApiError(`${TOOL_LABELS[tool]} ke liye value zaroori hai.`, "DRAFT_INVALID_VALUE", 0));
        return;
      }
      if (value.length > 500) {
        setError(new ApiError("Value 500 characters se zyada nahi ho sakti.", "DRAFT_VALUE_TOO_LARGE", 0));
        return;
      }
    }

    setDrafts((list) => [
      ...list,
      {
        id: draftId.current++,
        tool,
        ref: cleanRef,
        value: tool === "fill" || tool === "select" || tool === "press" ? value : undefined,
      },
    ]);
    setRef("");
    setValue("");
  }

  function removeDraft(id) {
    setDrafts((list) => list.filter((item) => item.id !== id));
  }

  function resetPlan() {
    setRun(null);
    setDrafts([]);
    setUrl("");
    setConfirmation("");
    setError(null);
    setNotice("Plan clear ho gaya. Naya plan freeze karein.");
  }

  async function freezePlan(event) {
    event.preventDefault();
    setError(null);
    setNotice("");
    if (!session) {
      setNotice("Plan freeze karne se pehle session start karein.");
      return;
    }
    const actions = [];
    if (url.trim()) actions.push({ tool: "navigate", url: url.trim() });
    for (const draft of drafts) {
      if (draft.tool === "wait") actions.push({ tool: "wait", ms: draft.ms });
      else if (draft.tool === "fill" || draft.tool === "select" || draft.tool === "press") {
        actions.push({ tool: draft.tool, ref: draft.ref, value: draft.value });
      } else actions.push({ tool: draft.tool, ref: draft.ref });
    }
    if (!actions.length) {
      setNotice("Kam az kam ek action add karein ya URL enter karein.");
      return;
    }

    setRunBusy(true);
    try {
      const data = await operatorRequest(apiBase, "/operator/runs", {
        method: "POST",
        operatorToken: operatorToken.trim(),
        body: { sessionId: session.id, plan: { version: 1, actions } },
      });
      if (!mounted.current) return;
      setRun(data.run || null);
      setDrafts([]);
      setUrl("");
      setConfirmation("");
      setNotice(
        "Plan freeze ho gaya. Exact hash verify karein, phir control token aur typed APPROVE ke saath approve karein.",
      );
    } catch (e) {
      if (!mounted.current) return;
      setError(e instanceof ApiError ? e : new ApiError("Plan creation failed.", "REQUEST_FAILED", 0));
    } finally {
      if (mounted.current) setRunBusy(false);
    }
  }

  async function approveRun(event) {
    event.preventDefault();
    if (!run) return;
    setError(null);
    setNotice("");
    if (confirmation !== "APPROVE") {
      setNotice("Approval ke liye exactly APPROVE type karein.");
      return;
    }
    if (!controlToken.trim()) {
      setNotice("Control token zaroori hai. Operator token approval ke liye kaafi nahi.");
      return;
    }
    setRunBusy(true);
    try {
      const data = await operatorRequest(apiBase, `/operator/runs/${run.id}/approve`, {
        method: "POST",
        operatorToken: operatorToken.trim(),
        controlToken: controlToken.trim(),
        body: { planHash: run.planHash, confirmation },
      });
      if (!mounted.current) return;
      setRun(data.run || null);
      setConfirmation("");
      setNotice("Approval record ho gaya. Approval single-use hai — ab execute karein.");
    } catch (e) {
      if (!mounted.current) return;
      setError(e instanceof ApiError ? e : new ApiError("Approval failed.", "REQUEST_FAILED", 0));
    } finally {
      if (mounted.current) setRunBusy(false);
    }
  }

  async function executeRun() {
    if (!run) return;
    setError(null);
    setNotice("");
    setRunBusy(true);
    setExecuting(true);
    try {
      const data = await operatorRequest(apiBase, `/operator/runs/${run.id}/execute`, {
        method: "POST",
        operatorToken: operatorToken.trim(),
        body: {},
      });
      if (!mounted.current) return;
      setRun(data.run || null);
      if (data.run?.status === "COMPLETED") {
        setNotice("Run COMPLETED. Observed page change ke baad hi success report ki gayi hai.");
      } else if (data.run?.status === "BLOCKED") {
        setNotice("Run BLOCKED. Neeche manual fallback follow karein.");
      } else if (data.run?.status === "FAILED") {
        setNotice("Run FAILED. Success claim nahi kiya gaya; page manually verify karein.");
      }
      await loadSnapshot(session?.id, { quiet: true });
    } catch (e) {
      if (!mounted.current) return;
      setError(e instanceof ApiError ? e : new ApiError("Execution failed.", "REQUEST_FAILED", 0));
    } finally {
      if (mounted.current) {
        setRunBusy(false);
        setExecuting(false);
      }
    }
  }

  const elementCount = snapshot?.elements?.length || 0;
  const runError = run?.error || null;

  return (
    <div className="gmop-root">
      <style>{operatorCss}</style>

      <div className="gm-welcome">
        <div>
          <div className="gm-kicker">AUTOMATION · LOCAL BROWSER OPERATOR</div>
          <h1 className="gm-h1">
            Browser <span className="gm-gradient">Operator</span>
          </h1>
          <p className="gm-muted" style={{ margin: 0, maxWidth: 820 }}>
            Yeh page aap ke apne computer par ek real browser session chalata hai.
            Har plan freeze hota hai, alag approval leta hai aur execute se pehle
            dobara validate hota hai. Koi result tab tak success nahi kehlata jab
            tak page par observable change na ho.
          </p>
        </div>
        <div className="gmop-head-actions">
          <button
            type="button"
            className="gm-btn"
            onClick={loadPublicStatus}
            disabled={checking}
          >
            ↻ Refresh status
          </button>
        </div>
      </div>

      <div className="gm-notice danger">
        <strong>OPERATOR SAFETY.</strong> Passwords, secrets, file upload/download,
        cookies, arbitrary JavaScript, desktop control, payments aur trading
        hamesha blocked hain. Browser credentials kabhi AI model ko nahi bheje
        jate. Tokens sirf is component ki memory mein rehte hain — localStorage
        ya sessionStorage use nahi hota.
      </div>

      <div className="gm-notice">
        <strong>Roman Urdu:</strong> Pehle terminal mein{" "}
        <code>GRANDMASTER_OPERATOR_REAL_TEST=1 npm run test:operator:real</code>{" "}
        chalayein. Jab tak real connector test pass nahi hota, status{" "}
        <strong>NOT CONNECTED</strong> rahega aur session start nahi hoga.
        Har plan ke liye control token aur typed <code>APPROVE</code> zaroori hai.
        CAPTCHA ya login wall par automation khud ruk jata hai — wahan kaam manually
        karein.
      </div>

      <section className="gm-card" aria-labelledby="gmop-status-title">
        <div className="gm-card-head">
          <div>
            <h2 id="gmop-status-title">Connector status</h2>
            <p>Public configuration summary — tokens aur page data include nahi hote.</p>
          </div>
          <Pill
            tone={
              serverless
                ? "red"
                : connected
                  ? "green"
                  : checking
                    ? "gold"
                    : "red"
            }
          >
            {serverless
              ? "SERVERLESS: UNSUPPORTED"
              : connected
                ? "CONNECTED"
                : checking
                  ? "CHECKING"
                  : "NOT CONNECTED"}
          </Pill>
        </div>

        {statusError && (
          <div className="gm-notice danger" role="status">
            Backend unreachable: {statusError.message}
            {statusError.code ? ` (${statusError.code})` : ""}
          </div>
        )}

        <div className="gmop-status-grid">
          <div>
            <div className="gmop-label">Connection</div>
            <Pill tone={connected ? "green" : "red"}>{connected ? "CONNECTED" : "NOT CONNECTED"}</Pill>
          </div>
          <div>
            <div className="gmop-label">Real connector test</div>
            <Pill tone={verified ? "green" : "red"}>
              {verified ? "VERIFIED" : "NOT VERIFIED"}
            </Pill>
          </div>
          <div>
            <div className="gmop-label">Configuration</div>
            <Pill tone={configured ? "green" : "red"}>
              {configured ? "CONFIGURED" : "INCOMPLETE"}
            </Pill>
          </div>
          <div>
            <div className="gmop-label">Browser channel</div>
            <div className="gmop-value">{info?.browserChannel || "—"}</div>
          </div>
          <div>
            <div className="gmop-label">Verified browser</div>
            <div className="gmop-value">
              {info?.verifiedBrowser
                ? `${info.verifiedBrowser} ${info.verifiedBrowserVersion || ""}`.trim()
                : "—"}
            </div>
          </div>
          <div>
            <div className="gmop-label">Last verified</div>
            <div className="gmop-value">{formatDate(info?.lastVerifiedAt)}</div>
          </div>
        </div>

        {missingConfiguration.length > 0 && (
          <div className="gm-notice danger" role="status">
            <strong>Missing configuration:</strong>
            <ul className="gmop-list">
              {missingConfiguration.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            {!serverless && !verified && (
              <p style={{ marginBottom: 0 }}>
                Real connector verify karne ke liye{" "}
                <code>GRANDMASTER_OPERATOR_REAL_TEST=1 npm run test:operator:real</code>{" "}
                chalayein. Test pass hone par hi status CONNECTED ho sakta hai.
              </p>
            )}
          </div>
        )}

        {serverless && (
          <div className="gm-notice danger">
            <strong>OPERATOR_SERVERLESS_UNSUPPORTED.</strong> Vercel/serverless
            hosting par browser session nahi chal sakta; every operator request 503
            return karega. Is feature ko local ya self-hosted server par chalayein.
          </div>
        )}

        <form className="gmop-inline-form" onSubmit={checkOperator}>
          <label className="gmop-label" htmlFor="gmop-operator-token">
            Operator token
          </label>
          <input
            id="gmop-operator-token"
            className="gm-field gmop-token-input"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="Server-side operator token"
            value={operatorToken}
            onChange={(event) => setOperatorToken(event.target.value)}
          />
          <button type="submit" className="gm-btn" disabled={checking || !operatorToken.trim()}>
            {checking ? "Checking…" : "Check with operator token"}
          </button>
          {operatorToken && (
            <button type="button" className="gm-btn ghost" onClick={clearCredentials}>
              Clear credentials
            </button>
          )}
          <span className="gm-muted gm-small">
            {operatorToken ? "TOKEN IN MEMORY ONLY" : "NO OPERATOR TOKEN"}
          </span>
        </form>

        {statusActionError && (
          <div className="gm-notice danger" role="alert">
            <strong>{statusActionError.code}.</strong> {statusActionError.message}
            {statusActionError.requestId ? (
              <span className="gm-muted gm-small"> (request {statusActionError.requestId})</span>
            ) : null}
          </div>
        )}
        {statusNotice && (
          <div className="gm-notice" role="status">
            {statusNotice}
          </div>
        )}
      </section>

      <section className="gm-card" aria-labelledby="gmop-session-title">
        <div className="gm-card-head">
          <div>
            <h2 id="gmop-session-title">Browser session</h2>
            <p>Ek hi ephemeral tab. Koi cookie, profile, screenshot ya HTML persist nahi hota.</p>
          </div>
          <Pill tone={session ? "green" : "red"}>{session ? "SESSION ACTIVE" : "NO SESSION"}</Pill>
        </div>

        <div className="gmop-session-grid">
          <div>
            <label className="gmop-label" htmlFor="gmop-control-token">
              Control token (approval only)
            </label>
            <input
              id="gmop-control-token"
              className="gm-field"
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="Separate approval authority"
              value={controlToken}
              onChange={(event) => setControlToken(event.target.value)}
            />
            <p className="gm-muted gm-small" style={{ margin: "6px 0 0" }}>
              Operator token session chalata hai; control token sirf plan approve
              karta hai. Ek token doosre ki jagah nahi le sakta.
            </p>
          </div>
          <div className="gmop-session-actions">
            <button
              type="button"
              className="gm-btn primary"
              onClick={startSession}
              disabled={!canStart}
              title={
                connected
                  ? "Start a local browser session"
                  : "Real connector verification aur operator token ke bina start nahi hoga"
              }
            >
              {sessionBusy && !session ? "Starting…" : "Start session"}
            </button>
            <button
              type="button"
              className="gm-btn ghost"
              onClick={stopSession}
              disabled={!session || sessionBusy}
            >
              {sessionBusy && session ? "Stopping…" : "Stop session"}
            </button>
            <button
              type="button"
              className="gm-btn"
              onClick={() => loadSnapshot()}
              disabled={!session || snapshotBusy}
            >
              {snapshotBusy ? "Loading…" : "Take snapshot"}
            </button>
          </div>
        </div>

        {!connected && (
          <div className="gm-notice" role="status">
            Start session locked hai jab tak real connector verification pass na ho
            aur configuration complete na ho. Yeh state jaan bujh kar fail-closed hai.
          </div>
        )}

        {session && (
          <div className="gmop-session-meta">
            <div>
              <div className="gmop-label">Session</div>
              <div className="gmop-value gmop-mono">{session.id}</div>
            </div>
            <div>
              <div className="gmop-label">Started</div>
              <div className="gmop-value">{formatDate(session.createdAt)}</div>
            </div>
            <div>
              <div className="gmop-label">Tab</div>
              <select className="gm-field gmop-tab-select" disabled aria-label="Current tab">
                <option>{snapshot?.host ? `Current tab — ${snapshot.host}` : "Current tab (single-tab only)"}</option>
              </select>
            </div>
          </div>
        )}
      </section>

      {snapshot && (
        <section className="gm-card" aria-labelledby="gmop-snapshot-title">
          <div className="gm-card-head">
            <div>
              <h2 id="gmop-snapshot-title">Current page snapshot</h2>
              <p>
                {snapshot.host || "—"} · {snapshot.title || "Untitled"} ·{" "}
                {formatDate(snapshot.at)}
              </p>
            </div>
            <Pill tone={snapshot.blocked ? "red" : "green"}>
              {snapshot.blocked ? "BLOCKED" : `${elementCount} REFS`}
            </Pill>
          </div>

          {snapshot.blocked ? (
            <div className="gm-notice danger" role="status">
              <strong>{snapshot.reason}.</strong> {manualFallback(snapshot.reason)}
            </div>
          ) : elementCount === 0 ? (
            <div className="gm-notice">Is page par koi safe interactive element nahi mila.</div>
          ) : (
            <div className="gmop-table-wrap">
              <table className="gmop-table">
                <thead>
                  <tr>
                    <th>Ref</th>
                    <th>Element</th>
                    <th>Name</th>
                    <th>Flags</th>
                    <th>Use</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.elements.map((element) => (
                    <tr key={element.ref}>
                      <td className="gmop-mono">{element.ref}</td>
                      <td>
                        {element.tag}
                        {element.type ? ` · ${element.type}` : ""}
                      </td>
                      <td>{element.name || "—"}</td>
                      <td>
                        {element.sensitive && <Pill tone="red">SENSITIVE</Pill>}{" "}
                        {element.disabled && <Pill tone="gold">DISABLED</Pill>}
                        {!element.sensitive && !element.disabled && <span className="gm-muted">safe</span>}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="gm-btn ghost gmop-mini-btn"
                          onClick={() => setRef(element.ref)}
                          disabled={element.sensitive || element.disabled}
                        >
                          Use
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      <section className="gm-card" aria-labelledby="gmop-plan-title">
        <div className="gm-card-head">
          <div>
            <h2 id="gmop-plan-title">Safe action composer</h2>
            <p>Sirf allowed tools. Target snapshot ke numbered reference se chunte hain.</p>
          </div>
          <Pill tone="gold">{drafts.length + (url.trim() ? 1 : 0)} / {MAX_ACTIONS}</Pill>
        </div>

        <form onSubmit={addDraft} className="gmop-composer">
          <div>
            <label className="gmop-label" htmlFor="gmop-url">
              Navigation URL (optional)
            </label>
            <input
              id="gmop-url"
              className="gm-field"
              type="url"
              inputMode="url"
              placeholder="https://allowed-host.example/page"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
            />
            <p className="gm-muted gm-small" style={{ margin: "6px 0 0" }}>
              Sirf HTTPS allowlisted hosts. Loopback sirf explicit opt-in ke saath.
            </p>
          </div>

          <div>
            <label className="gmop-label" htmlFor="gmop-tool">
              Action
            </label>
            <select
              id="gmop-tool"
              className="gm-field"
              value={tool}
              onChange={(event) => setTool(event.target.value)}
            >
              <option value="click">Click</option>
              <option value="fill">Type (fill)</option>
              <option value="select">Select option</option>
              <option value="press">Press key</option>
              <option value="read">Read (read-only)</option>
              <option value="wait">Wait</option>
            </select>
          </div>

          {tool !== "wait" ? (
            <>
              <div>
                <label className="gmop-label" htmlFor="gmop-ref">
                  Target reference
                </label>
                <input
                  id="gmop-ref"
                  className="gm-field gmop-mono"
                  type="text"
                  placeholder="gmop-1"
                  value={ref}
                  onChange={(event) => setRef(event.target.value)}
                />
              </div>
              {(tool === "fill" || tool === "select" || tool === "press") && (
                <div>
                  <label className="gmop-label" htmlFor="gmop-value">
                    Value (memory only, never echoed back)
                  </label>
                  <input
                    id="gmop-value"
                    className="gm-field"
                    type="text"
                    autoComplete="off"
                    maxLength={500}
                    value={value}
                    onChange={(event) => setValue(event.target.value)}
                  />
                </div>
              )}
            </>
          ) : (
            <div>
              <label className="gmop-label" htmlFor="gmop-wait">
                Wait (50–5000 ms)
              </label>
              <input
                id="gmop-wait"
                className="gm-field"
                type="number"
                min="50"
                max="5000"
                step="50"
                value={waitMs}
                onChange={(event) => setWaitMs(event.target.value)}
              />
            </div>
          )}

          <div className="gmop-composer-actions">
            <button type="submit" className="gm-btn" disabled={!session || runBusy}>
              Add action
            </button>
          </div>
        </form>

        {drafts.length > 0 && (
          <ol className="gmop-drafts">
            {drafts.map((draft, index) => (
              <li key={draft.id} className="gmop-draft">
                <span className="gmop-draft-index">
                  {index + (url.trim() ? 2 : 1)}
                </span>
                <div className="gmop-draft-body">
                  <div className="gmop-draft-title">
                    {draft.tool === "wait"
                      ? `Wait ${draft.ms} ms`
                      : `${TOOL_LABELS[draft.tool]} · ${draft.ref}`}
                  </div>
                  <div className="gm-muted gm-small">
                    {draft.tool === "wait"
                      ? "Koi interaction nahi; sirf wait."
                      : draft.value !== undefined
                        ? "Value set (memory only, plan response mein redacted)."
                        : expectedResult(draft)}
                  </div>
                </div>
                <button
                  type="button"
                  className="gm-btn ghost gmop-mini-btn"
                  onClick={() => removeDraft(draft.id)}
                >
                  Remove
                </button>
              </li>
            ))}
          </ol>
        )}

        <div className="gmop-freeze-row">
          <button
            type="button"
            className="gm-btn primary"
            onClick={freezePlan}
            disabled={!session || runBusy || actionCount() === 0 || Boolean(run)}
          >
            {runBusy && !run ? "Freezing…" : "Freeze plan"}
          </button>
          {drafts.length > 0 && (
            <button type="button" className="gm-btn ghost" onClick={() => setDrafts([])}>
              Clear actions
            </button>
          )}
          <span className="gm-muted gm-small">
            {actionCount() === 0
              ? "Plan khaali hai."
              : "Freeze karne par plan hash lock ho jayega."}
          </span>
        </div>

        {notice && (
          <div className="gm-notice" role="status" aria-live="polite">
            {notice}
          </div>
        )}

        {error && (
          <div className="gm-notice danger" role="alert">
            <strong>{error.code}.</strong> {error.message}
            {error.requestId ? (
              <span className="gm-muted gm-small"> (request {error.requestId})</span>
            ) : null}
          </div>
        )}
      </section>

      {run && (
        <section className="gm-card" aria-labelledby="gmop-run-title">
          <div className="gm-card-head">
            <div>
              <h2 id="gmop-run-title">Frozen plan &amp; approval</h2>
              <p>Yeh plan freeze ho chuka hai. Hash badalne par approval reject hoga.</p>
            </div>
            <Pill tone={executing ? "gold" : RUN_TONE[run.status] || ""}>
              {executing ? "RUNNING" : run.status}
            </Pill>
          </div>

          <div className="gmop-hash-block">
            <div className="gmop-label">Frozen plan hash (SHA-256)</div>
            <code className="gmop-hash">{run.planHash}</code>
            <p className="gm-muted gm-small" style={{ margin: "6px 0 0" }}>
              Approve karte waqt yeh exact hash server ko bheja jata hai. Replay,
              expired approval aur changed plan reject hote hain.
            </p>
          </div>

          <div className="gmop-table-wrap">
            <table className="gmop-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Action</th>
                  <th>Target</th>
                  <th>Proposed action</th>
                  <th>Expected result</th>
                </tr>
              </thead>
              <tbody>
                {run.actions.map((action, index) => (
                  <tr key={`${action.tool}-${index}`}>
                    <td>{index + 1}</td>
                    <td>{TOOL_LABELS[action.tool] || action.tool}</td>
                    <td className="gmop-mono">{targetLabel(action)}</td>
                    <td>{proposedLabel(action)}</td>
                    <td>{expectedResult(action)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="gm-notice">
            <strong>Approval authority:</strong> operator token + control token dono
            chahiye aur typed <code>APPROVE</code> zaroori hai. Irreversible,
            destructive aur financial actions is system mein eligible hi nahi —
            woh planning stage par LOCKED hain.
          </div>

          {run.status === "AWAITING_APPROVAL" && (
            <form className="gmop-approval" onSubmit={approveRun}>
              <div>
                <label className="gmop-label" htmlFor="gmop-confirmation">
                  Type APPROVE to approve this exact plan
                </label>
                <input
                  id="gmop-confirmation"
                  className="gm-field gmop-mono"
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="APPROVE"
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                />
              </div>
              <div className="gmop-approval-actions">
                <button
                  type="submit"
                  className="gm-btn primary"
                  disabled={
                    runBusy || confirmation !== "APPROVE" || !controlToken.trim() || !operatorToken.trim()
                  }
                >
                  {runBusy ? "Approving…" : "Approve frozen plan"}
                </button>
                <span className="gm-muted gm-small">
                  {controlToken.trim()
                    ? "Control token present (memory only)"
                    : "Control token required for approval"}
                </span>
              </div>
            </form>
          )}

          {(run.status === "APPROVED" || run.status === "RUNNING") && (
            <div className="gmop-execute">
              <button
                type="button"
                className="gm-btn primary"
                onClick={executeRun}
                disabled={runBusy || executing}
              >
                {executing ? "RUNNING…" : "Execute approved plan"}
              </button>
              <span className="gm-muted gm-small">
                Execution se pehle hash, target aur policy dobara validate hoti hai.
                Approval single-use hai.
              </span>
            </div>
          )}

          {(run.status === "COMPLETED" ||
            run.status === "FAILED" ||
            run.status === "BLOCKED") && (
            <div className="gmop-result" role="status" aria-live="polite">
              <div className="gmop-status-grid">
                <div>
                  <div className="gmop-label">Run status</div>
                  <Pill tone={RUN_TONE[run.status]}>{run.status}</Pill>
                </div>
                <div>
                  <div className="gmop-label">Steps</div>
                  <div className="gmop-value">{run.steps.length}</div>
                </div>
                <div>
                  <div className="gmop-label">Change observed</div>
                  <div className="gmop-value">
                    {run.result?.changeObserved ? "YES" : "NO"}
                  </div>
                </div>
                <div>
                  <div className="gmop-label">Host</div>
                  <div className="gmop-value gmop-mono">{run.result?.host || "—"}</div>
                </div>
              </div>
              {runError && (
                <div className="gm-notice danger">
                  <strong>{runError.code}.</strong> {runError.message}
                  <div style={{ marginTop: 6 }}>{manualFallback(runError.code)}</div>
                </div>
              )}
              {run.status === "COMPLETED" && !run.result?.changeObserved && (
                <p className="gm-muted gm-small" style={{ marginBottom: 0 }}>
                  Read-only ya navigation-only plan tha; is liye DOM change optional
                  hai. Success sirf observe ki gayi state par based hai.
                </p>
              )}
              {run.status === "COMPLETED" && run.result?.changeObserved && (
                <p className="gm-muted gm-small" style={{ marginBottom: 0 }}>
                  Observable DOM change record hua. Naya snapshot le kar verify karein.
                </p>
              )}
            </div>
          )}

          <div className="gmop-freeze-row">
            <button type="button" className="gm-btn ghost" onClick={resetPlan}>
              New plan
            </button>
            <button
              type="button"
              className="gm-btn"
              onClick={() => loadSnapshot()}
              disabled={!session || snapshotBusy}
            >
              {snapshotBusy ? "Loading…" : "Load fresh snapshot"}
            </button>
          </div>
        </section>
      )}

      <div className="gm-notice">
        <strong>Manual fallback:</strong> Login, CAPTCHA, OTP, payment aur kisi bhi
        sensitive step ko hamesha khud apne browser mein complete karein. Automation
        wahan ruk kar BLOCKED report karta hai; woh challenge solve karne ki koshish
        nahi karta. Agar koi action fail ho to page manually check karein, naya
        snapshot lein aur naya plan freeze karein. Yeh page MT5 trading aur money
        movement ko touch nahi karta — woh LOCKED hain.
      </div>
    </div>
  );
}

const operatorCss = `
.gmop-root{display:flex;flex-direction:column;gap:14px}
.gmop-head-actions{display:flex;gap:8px;align-items:flex-start}
.gmop-status-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-bottom:14px}
.gmop-label{font-size:10px;font-weight:850;letter-spacing:.45px;text-transform:uppercase;color:var(--muted);margin-bottom:6px}
.gmop-value{font-size:12px;font-weight:750;overflow-wrap:anywhere}
.gmop-mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;overflow-wrap:anywhere}
.gmop-inline-form{display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding:12px 14px;border:1px solid var(--border);border-radius:12px;background:#ffffff03}
.gmop-token-input{max-width:320px;padding:9px 11px}
.gmop-session-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(260px,.8fr);gap:14px;align-items:start}
.gmop-session-actions{display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end}
.gmop-session-meta{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(120px,.6fr) minmax(200px,1fr);gap:12px;margin-top:14px;padding-top:14px;border-top:1px solid var(--border)}
.gmop-tab-select{max-width:320px}
.gmop-table-wrap{overflow-x:auto;border:1px solid var(--border);border-radius:11px;margin-bottom:14px}
.gmop-table{width:100%;border-collapse:collapse;font-size:11px;min-width:660px}
.gmop-table th{text-align:left;padding:9px 11px;color:var(--muted);font-size:9px;letter-spacing:.6px;text-transform:uppercase;border-bottom:1px solid var(--border);background:#ffffff03}
.gmop-table td{padding:9px 11px;border-bottom:1px solid var(--border);font-weight:700;vertical-align:top}
.gmop-table tr:last-child td{border-bottom:0}
.gmop-mini-btn{padding:6px 10px;font-size:10px}
.gmop-composer{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-bottom:14px}
.gmop-composer-actions{display:flex;align-items:flex-end}
.gmop-drafts{list-style:none;margin:0 0 14px;padding:0;display:flex;flex-direction:column;gap:8px}
.gmop-draft{display:flex;align-items:center;gap:11px;padding:10px 12px;border:1px solid var(--border);border-radius:11px;background:#ffffff03}
.gmop-draft-index{display:grid;place-items:center;width:24px;height:24px;flex:0 0 24px;border-radius:8px;background:#f5bc4b14;color:var(--gold2);font-size:10px;font-weight:850}
.gmop-draft-body{flex:1;min-width:0}
.gmop-draft-title{font-size:11px;font-weight:800}
.gmop-freeze-row{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin-top:12px}
.gmop-hash-block{border:1px solid #f5bc4b2b;background:#f5bc4b08;border-radius:12px;padding:12px;margin-bottom:14px}
.gmop-hash{display:block;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;color:var(--gold2);overflow-wrap:anywhere}
.gmop-approval{display:grid;grid-template-columns:minmax(0,1fr) minmax(240px,.7fr);gap:14px;align-items:end;padding:14px;border:1px solid var(--border);border-radius:12px;background:#ffffff03;margin-bottom:12px}
.gmop-approval-actions{display:flex;flex-direction:column;gap:6px;align-items:flex-start}
.gmop-execute{display:flex;flex-wrap:wrap;align-items:center;gap:12px;padding:14px;border:1px solid #f5bc4b2b;border-radius:12px;background:#f5bc4b08;margin-bottom:12px}
.gmop-result{display:flex;flex-direction:column;gap:10px}
.gmop-list{margin:8px 0 0;padding-left:18px}
.gmop-list li{margin-bottom:3px}
@media(max-width:980px){.gmop-status-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.gmop-session-grid,.gmop-approval{grid-template-columns:1fr}.gmop-session-actions{justify-content:flex-start}.gmop-session-meta{grid-template-columns:1fr}.gmop-composer{grid-template-columns:1fr}}
@media(max-width:600px){.gmop-status-grid{grid-template-columns:1fr}.gmop-inline-form{align-items:stretch}.gmop-token-input{max-width:none}}
`;
