import { useCallback, useEffect, useMemo, useState } from "react";

const TABS = [
  { id: "agents", label: "Agents" },
  { id: "tasks", label: "Tasks & Approvals" },
  { id: "memory", label: "Memory" },
  { id: "integrations", label: "Integrations" },
  { id: "security", label: "Security & Audit" },
];

const TASK_STATUS_STYLE = {
  COMPLETED: "green",
  FAILED: "red",
  AWAITING_APPROVAL: "gold",
  RUNNING: "gold",
  RETRY_PENDING: "gold",
};

const AGENT_STATUS_STYLE = {
  operational: "green",
  advisory_ready: "green",
  requires_verification: "gold",
  requires_configuration: "red",
  not_connected: "red",
  locked: "red",
  degraded: "gold",
};

const GATE_STYLE = {
  GREEN: "green",
  LOCKED: "red",
  "NOT CONNECTED": "red",
  "APPROVAL REQUIRED": "gold",
};

const LABEL_STYLE = {
  "LIVE VERIFIED": "green",
  "LOCALLY TESTED": "green",
  "VERIFIED IN CODE": "gold",
  "APPROVAL REQUIRED": "gold",
  "NOT CONNECTED": "red",
  "NOT IMPLEMENTED": "red",
  "MOCK/SIMULATED": "gold",
};

class ApiError extends Error {
  constructor(message, code, status, requestId = null) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.requestId = requestId;
  }
}

async function request(apiBase, path, { method = "GET", body, token } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(`${apiBase}/api/v1${path}`, {
      method,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { "X-Grandmaster-Token": token } : {}),
      },
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
        "The backend returned an unexpected response. Live data is unavailable.",
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

function statusTone(status) {
  return AGENT_STATUS_STYLE[status] || "";
}

function protectedAuthFailure(error) {
  const suffix = error?.requestId ? ` (request ${error.requestId})` : "";
  if (error?.code === "INVALID_CONTROL_TOKEN") {
    return `Tasks and notifications are locked: the control token was rejected. Check the token and retry.${suffix}`;
  }
  if (error?.code === "APPROVAL_AUTHORITY_NOT_CONFIGURED") {
    return `Tasks and notifications are locked: the server has no control authority configured.${suffix}`;
  }
  if (error?.code === "APPROVAL_REQUIRED") {
    return `Tasks and notifications are locked: enter the control token to load them.${suffix}`;
  }
  return "";
}

export default function AgentDesks({ apiBase = "" }) {
  const [tab, setTab] = useState("agents");
  const [status, setStatus] = useState(null);
  const [agents, setAgents] = useState([]);
  const [desks, setDesks] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [taskStats, setTaskStats] = useState(null);
  const [memories, setMemories] = useState([]);
  const [memoryCategories, setMemoryCategories] = useState([]);
  const [memoryQuery, setMemoryQuery] = useState("");
  const [memoryCategory, setMemoryCategory] = useState("");
  const [integrations, setIntegrations] = useState([]);
  const [channels, setChannels] = useState([]);
  const [posture, setPosture] = useState(null);
  const [audit, setAudit] = useState(null);
  const [selectedAgentId, setSelectedAgentId] = useState(null);
  const [agentDetail, setAgentDetail] = useState(null);
  const [planPreview, setPlanPreview] = useState(null);
  const [lastTask, setLastTask] = useState(null);
  const [taskRequest, setTaskRequest] = useState("");
  const [taskAgent, setTaskAgent] = useState("");
  const [memoryText, setMemoryText] = useState("");
  const [memoryNewCategory, setMemoryNewCategory] = useState("preference");
  const [memoryLoaded, setMemoryLoaded] = useState(false);
  const [memoryAuthError, setMemoryAuthError] = useState("");
  const [taskAuthError, setTaskAuthError] = useState("");
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [integrationResults, setIntegrationResults] = useState({});

  const controlReady = Boolean(status?.controlAuthorityConfigured);

  const loadCore = useCallback(async (authToken = "") => {
    const auth = String(authToken || "").trim();
    setLoading(true);
    setError("");
    setTaskAuthError("");
    try {
      const core = await request(apiBase, "/status");
      setStatus(core);
      if (Array.isArray(core.notifications)) setChannels(core.notifications);
      if (core.tasks) setTaskStats(core.tasks);
    } catch (e) {
      setError(
        e.status === 0 || e.code === "TIMEOUT"
          ? e.message
          : `Backend unreachable: ${e.message}`,
      );
      setLoading(false);
      return;
    }

    const requests = [
      ["agents", request(apiBase, "/agents")],
      ["integrations", request(apiBase, "/integrations")],
      ["security posture", request(apiBase, "/security/posture")],
    ];
    if (auth) {
      requests.push(
        ["tasks", request(apiBase, "/tasks?limit=50", { token: auth })],
        ["notifications", request(apiBase, "/notifications", { token: auth })],
      );
    }

    const settled = await Promise.allSettled(requests.map(([, promise]) => promise));
    const results = Object.fromEntries(
      requests.map(([name], index) => [name, settled[index]]),
    );

    if (results.agents.status === "fulfilled") {
      setAgents(results.agents.value.agents || []);
      setDesks(results.agents.value.desks || []);
    } else {
      setAgents([]);
      setDesks([]);
    }
    if (results.integrations.status === "fulfilled") {
      setIntegrations(results.integrations.value.integrations || []);
    } else {
      setIntegrations([]);
    }
    if (results["security posture"].status === "fulfilled") {
      setPosture(results["security posture"].value.posture || null);
    } else {
      setPosture(null);
    }

    const tasksResult = results.tasks;
    if (tasksResult?.status === "fulfilled") {
      setTasks(tasksResult.value.tasks || []);
      setTaskStats(tasksResult.value.stats || null);
    } else if (auth) {
      setTasks([]);
      setTaskStats(null);
    }

    const notificationsResult = results.notifications;
    if (notificationsResult?.status === "fulfilled") {
      setChannels(notificationsResult.value.channels || []);
    } else if (auth) {
      setChannels([]);
    }

    const protectedFailure =
      tasksResult?.status === "rejected"
        ? tasksResult.reason
        : notificationsResult?.status === "rejected"
          ? notificationsResult.reason
          : null;
    if (protectedFailure) {
      const authMessage = protectedAuthFailure(protectedFailure);
      if (authMessage) setTaskAuthError(authMessage);
    }

    const failedSections = Object.entries(results).filter(
      ([name, result]) =>
        result.status === "rejected" &&
        !["tasks", "notifications"].includes(name),
    );
    if (failedSections.length) {
      setError(
        `Could not load ${failedSections
          .map(([name, result]) => `${name} (${result.reason?.message || "request failed"})`)
          .join("; ")}. No substitute data is shown.`,
      );
    }
    setLoading(false);
  }, [apiBase]);

  useEffect(() => {
    loadCore("");
  }, [loadCore]);

  const showError = (e) => {
    setNotice("");
    const suffix = e?.requestId ? ` (request ${e.requestId})` : "";
    setError(`${e?.message || "Request failed."}${suffix}`);
  };

  const requireToken = () => {
    if (token.trim()) return true;
    setError("");
    setNotice("Control authorization required. Enter the server-side control token first.");
    return false;
  };

  const memoryAuthFailure = (e) => {
    const suffix = e?.requestId ? ` (request ${e.requestId})` : "";
    if (e.code === "INVALID_CONTROL_TOKEN") {
      return `Memory is locked: the control token was rejected. Check the token and try again.${suffix}`;
    }
    if (e.code === "APPROVAL_AUTHORITY_NOT_CONFIGURED") {
      return `Memory is locked: the server has no control authority configured.${suffix}`;
    }
    if (e.code === "APPROVAL_REQUIRED") {
      return `Memory is locked: enter the control token to load stored memories.${suffix}`;
    }
    return "";
  };

  const loadMemories = useCallback(
    async (authToken = token, { silent = false } = {}) => {
      const auth = String(authToken || "").trim();
      if (!auth) {
        setMemoryAuthError("");
        setNotice("Enter the control token to load server memory.");
        return false;
      }
      setBusy("memory-list");
      setError("");
      setMemoryAuthError("");
      try {
        const data = await request(apiBase, "/memory?limit=50", { token: auth });
        setMemories(data.memories || []);
        if (Array.isArray(data.categories) && data.categories.length) {
          setMemoryCategories(data.categories);
        }
        setMemoryLoaded(true);
        return true;
      } catch (e) {
        const authMessage = memoryAuthFailure(e);
        if (authMessage) {
          setMemories([]);
          setMemoryLoaded(false);
          setMemoryAuthError(authMessage);
        } else if (!silent) {
          showError(e);
        }
        return false;
      } finally {
        setBusy("");
      }
    },
    [apiBase, token],
  );

  async function openAgent(agentId) {
    setSelectedAgentId(agentId);
    setAgentDetail(null);
    try {
      const data = await request(apiBase, `/agents/${encodeURIComponent(agentId)}`);
      setAgentDetail({
        ...(data.agent || {}),
        recentTasks: data.recentTasks || [],
      });
    } catch (e) {
      showError(e);
    }
  }

  async function refreshTasks() {
    if (!requireToken()) return false;
    const data = await request(apiBase, "/tasks?limit=50", {
      token: token.trim(),
    });
    setTasks(data.tasks || []);
    setTaskStats(data.stats || null);
    setTaskAuthError("");
    return true;
  }

  async function submitTask(event) {
    event.preventDefault();
    if (!taskRequest.trim()) return;
    if (!requireToken()) return;
    setBusy("create-task");
    setError("");
    setNotice("");
    setPlanPreview(null);
    setLastTask(null);
    try {
      const data = await request(apiBase, "/tasks", {
        method: "POST",
        token: token.trim(),
        body: {
          request: taskRequest.trim(),
          agentId: taskAgent || undefined,
        },
      });
      setPlanPreview(data.plan || null);
      setLastTask(data.task || null);
      setTaskRequest("");
      setTaskAuthError("");
      setNotice(
        data.approvalRequired
          ? "Task created and is AWAITING APPROVAL. Nothing external was performed."
          : `Task finished with status ${data.task?.status || "unknown"}.`,
      );
      await refreshTasks();
      await loadCore(token);
    } catch (e) {
      if (e.code === "ACTION_LOCKED") {
        setNotice("LOCKED by policy. No task was created and no financial action was performed.");
      } else if (protectedAuthFailure(e)) {
        setTaskAuthError(protectedAuthFailure(e));
      } else {
        showError(e);
      }
    } finally {
      setBusy("");
    }
  }

  async function planTask() {
    if (!taskRequest.trim()) return;
    setBusy("plan");
    setError("");
    setNotice("");
    try {
      const data = await request(apiBase, "/mastermind/plan", {
        method: "POST",
        body: { request: taskRequest.trim() },
      });
      setPlanPreview(data.plan || null);
      setNotice(
        data.plan?.gate === "LOCKED"
          ? "This request is LOCKED by policy."
          : data.plan?.approvalRequired
            ? "This request would require control authorization."
            : "Plan generated. No task was created.",
      );
    } catch (e) {
      showError(e);
    } finally {
      setBusy("");
    }
  }

  async function taskAction(taskId, action) {
    if (!requireToken()) return;
    setBusy(`${action}-${taskId}`);
    setError("");
    setNotice("");
    try {
      const data = await request(apiBase, `/tasks/${taskId}/${action}`, {
        method: "POST",
        token: token.trim(),
      });
      const updated = data.task;
      setLastTask(updated || null);
      setTaskAuthError("");
      setNotice(
        action === "approve"
          ? "Approval recorded. No external action has been performed."
          : `Task is now ${updated?.status || "updated"}.`,
      );
      await refreshTasks();
      await loadCore(token);
    } catch (e) {
      const authMessage = protectedAuthFailure(e);
      if (authMessage) {
        setTaskAuthError(authMessage);
        setError("");
      } else {
        showError(e);
      }
    } finally {
      setBusy("");
    }
  }

  async function searchMemory(event) {
    event.preventDefault();
    if (!requireToken()) return;
    setBusy("memory-search");
    setError("");
    setMemoryAuthError("");
    try {
      const params = new URLSearchParams({ limit: "50" });
      if (memoryQuery.trim()) params.set("q", memoryQuery.trim());
      if (memoryCategory) params.set("category", memoryCategory);
      const data = await request(apiBase, `/memory?${params.toString()}`, {
        token: token.trim(),
      });
      setMemories(data.memories || []);
      if (Array.isArray(data.categories) && data.categories.length) {
        setMemoryCategories(data.categories);
      }
      setMemoryLoaded(true);
    } catch (e) {
      const authMessage = memoryAuthFailure(e);
      if (authMessage) {
        setMemories([]);
        setMemoryLoaded(false);
        setMemoryAuthError(authMessage);
      } else {
        showError(e);
      }
    } finally {
      setBusy("");
    }
  }

  async function addMemory(event) {
    event.preventDefault();
    if (!requireToken()) return;
    setBusy("memory-create");
    setError("");
    setNotice("");
    setMemoryAuthError("");
    try {
      await request(apiBase, "/memory", {
        method: "POST",
        token: token.trim(),
        body: { text: memoryText.trim(), category: memoryNewCategory },
      });
      setMemoryText("");
      setNotice("Memory stored on the server.");
      const data = await request(apiBase, "/memory?limit=50", {
        token: token.trim(),
      });
      setMemories(data.memories || []);
      if (Array.isArray(data.categories) && data.categories.length) {
        setMemoryCategories(data.categories);
      }
      setMemoryLoaded(true);
    } catch (e) {
      const authMessage = memoryAuthFailure(e);
      if (authMessage) {
        setMemoryLoaded(false);
        setMemoryAuthError(authMessage);
      } else {
        showError(e);
      }
    } finally {
      setBusy("");
    }
  }

  async function removeMemory(id) {
    if (!requireToken()) return;
    setBusy(`memory-delete-${id}`);
    setError("");
    setNotice("");
    try {
      await request(apiBase, `/memory/${id}`, {
        method: "DELETE",
        token: token.trim(),
      });
      setMemories((current) => current.filter((item) => item.id !== id));
      setNotice("Memory deleted.");
    } catch (e) {
      const authMessage = memoryAuthFailure(e);
      if (authMessage) {
        setMemoryAuthError(authMessage);
      } else {
        showError(e);
      }
    } finally {
      setBusy("");
    }
  }

  async function testIntegration(id) {
    if (!requireToken()) return;
    setBusy(`integration-${id}`);
    setError("");
    try {
      const data = await request(apiBase, `/integrations/${id}/test`, {
        method: "POST",
        token: token.trim(),
      });
      setIntegrationResults((current) => ({ ...current, [id]: data }));
      if (id === "ai_provider") await loadCore(token);
    } catch (e) {
      const authMessage = protectedAuthFailure(e);
      if (authMessage) {
        setTaskAuthError(authMessage);
        setError("");
      } else {
        showError(e);
      }
    } finally {
      setBusy("");
    }
  }

  async function loadAudit() {
    if (!requireToken()) return;
    setBusy("audit");
    setError("");
    setNotice("");
    try {
      const data = await request(apiBase, "/audit?limit=100", {
        method: "GET",
        token: token.trim(),
      });
      setAudit(data);
    } catch (e) {
      showError(e);
    } finally {
      setBusy("");
    }
  }

  const detail = agentDetail;
  const providerVerified = status?.provider?.verified === true;
  const providerConfigured = status?.provider?.configured === true;
  const verifiedModel = status?.provider?.verification?.model;
  const providerLabel = providerVerified
    ? verifiedModel
      ? `VERIFIED · ${verifiedModel}`
      : "VERIFIED"
    : providerConfigured
      ? "CONFIGURED · NOT VERIFIED"
      : "NOT CONFIGURED";
  const storageLabel = status?.storage?.tasks?.durable
    ? "DURABLE"
    : status?.storage?.tasks?.ephemeral
      ? "EPHEMERAL"
      : status?.storage?.tasks?.mode || "UNKNOWN";
  const selectedTaskPreview = lastTask || null;
  const approvalInbox = tasks.filter(
    (task) =>
      task.status === "AWAITING_APPROVAL" ||
      task.approval?.status === "pending",
  );

  const memoryCategoryOptions = useMemo(
    () =>
      memoryCategories.length
        ? memoryCategories
        : ["preference", "project", "goal", "task_summary", "instruction", "agent_summary"],
    [memoryCategories],
  );

  return (
    <div className="desk-root">
      <style>{deskCss}</style>

      <div className="gm-welcome">
        <div>
          <div className="gm-kicker">PHASE 3 · AGENT OPERATIONS</div>
          <h1 className="gm-h1">
            Agent <span className="gm-gradient">Desks</span>
          </h1>
          <p className="gm-muted" style={{ margin: 0, maxWidth: 760 }}>
            Live server-side data from <code>/api/v1</code>. A status is shown only
            when the backend reports it; external integrations stay NOT CONNECTED
            until they are actually implemented.
          </p>
        </div>
        <div className="desk-head-actions">
          <button
            type="button"
            className="gm-btn"
            onClick={() => loadCore(token)}
            disabled={loading}
          >
            {loading ? "Refreshing…" : "↻ Refresh"}
          </button>
        </div>
      </div>

      <div className="desk-status-strip">
        <Pill tone={providerVerified ? "green" : providerConfigured ? "gold" : "red"}>
          AI PROVIDER: {providerLabel}
        </Pill>
        <Pill tone={storageLabel === "DURABLE" ? "green" : "gold"}>
          STORAGE: {storageLabel}
        </Pill>
        <Pill tone={controlReady ? "green" : "red"}>
          CONTROL AUTHORITY: {controlReady ? "CONFIGURED" : "NOT CONFIGURED"}
        </Pill>
        <Pill tone="gold">
          TASKS: {taskStats?.total ?? status?.tasks?.total ?? 0}
        </Pill>
        <Pill tone="gold">QUEUED: {taskStats?.byStatus?.QUEUED ?? 0}</Pill>
        <Pill tone="gold">RUNNING: {taskStats?.byStatus?.RUNNING ?? 0}</Pill>
        <Pill tone="green">COMPLETED: {taskStats?.byStatus?.COMPLETED ?? 0}</Pill>
        <Pill tone={taskStats?.byStatus?.FAILED ? "red" : "gold"}>
          FAILED: {taskStats?.byStatus?.FAILED ?? 0}
        </Pill>
        <Pill tone="gold">
          AWAITING APPROVAL: {taskStats?.awaitingApproval ?? 0}
        </Pill>
      </div>

      {status?.provider?.verification && !providerVerified && (
        <div className="gm-notice" style={{ marginBottom: 14 }}>
          <strong>AI provider verification:</strong>{" "}
          {status.provider.verification.reason || "not verified"} (checked{" "}
          {formatDate(status.provider.verification.checkedAt)}). Advisory agents
          remain NOT CONNECTED until a real verification call succeeds.
        </div>
      )}

      {!controlReady && status && (
        <div className="gm-notice danger" style={{ marginBottom: 14 }}>
          <strong>Approvals are disabled.</strong> The server has no
          <code> GRANDMASTER_CONTROL_TOKEN</code> (16+ chars), so approval,
          memory and audit requests are refused. This is intentional.
        </div>
      )}

      <div className="desk-token-row">
        <label className="desk-token-label" htmlFor="gm-control-token">
          Control token
        </label>
        <input
          id="gm-control-token"
          className="gm-field desk-token-input"
          type="password"
          autoComplete="new-password"
          placeholder="Server-side GRANDMASTER_CONTROL_TOKEN"
          value={token}
          onChange={(event) => {
            const next = event.target.value;
            setToken(next);
            setTasks([]);
            setTaskStats(null);
            setChannels([]);
            setAudit(null);
            setMemories([]);
            setMemoryLoaded(false);
            setMemoryAuthError("");
            setTaskAuthError("");
          }}
        />
        <span className="gm-muted gm-small">
          Enter the token, then select Refresh to load protected tasks and
          notifications. Held in component memory only. Never written to
          localStorage or sessionStorage.
        </span>
        <Pill tone={token.trim() ? "gold" : ""}>
          {token.trim() ? "TOKEN ENTERED" : "NO TOKEN"}
        </Pill>
      </div>

      <div className="desk-tabs" role="tablist" aria-label="Agent operations">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            className={`desk-tab ${tab === item.id ? "active" : ""}`}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {error && (
        <div
          className="gm-notice danger"
          role="alert"
          style={{
            marginBottom: 14,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <span>{error}</span>
          <button
            type="button"
            className="gm-btn"
            onClick={() => loadCore(token)}
            disabled={loading}
          >
            {loading ? "Retrying…" : "Retry"}
          </button>
        </div>
      )}
      {notice && (
        <div className="gm-notice" role="status" style={{ marginBottom: 14 }}>
          {notice}
        </div>
      )}
      {taskAuthError && (
        <div className="gm-notice danger" role="alert" style={{ marginBottom: 14 }}>
          {taskAuthError}
        </div>
      )}

      {loading && !status && (
        <div className="gm-card gm-empty">Loading agent operations data…</div>
      )}

      {tab === "agents" && (
        <section className="desk-section">
          <div className="desk-section-head">
            <div>
              <h2>Mission desks</h2>
              <p>
                Five workspaces mapped to the agent registry and integration
                registry. Status labels are evidence-based. Task counts come from
                the local server store; no live market or publishing metrics are
                shown.
              </p>
            </div>
            <Pill tone={desks.length === 5 ? "gold" : "red"}>
              {desks.length}/5 MAPPED
            </Pill>
          </div>

          {!desks.length && !loading && (
            <div className="gm-empty">
              Desk summaries are unavailable from the backend. No substitute data
              is shown.
            </div>
          )}

          <div className="desk-mission-grid">
            {desks.map((desk) => (
              <article key={desk.id} className="gm-card desk-mission">
                <div className="desk-mission-head">
                  <strong>{desk.name}</strong>
                  <Pill tone={LABEL_STYLE[desk.statusLabel] || ""}>
                    {desk.statusLabel}
                  </Pill>
                </div>
                <p className="desk-mission-boundary">{desk.boundary}</p>
                <div className="desk-mission-meta">
                  <Pill tone={GATE_STYLE[desk.gate] || ""}>{desk.gate}</Pill>
                  <span>STORED TASKS: {desk.taskCount ?? 0}</span>
                  <span>
                    {desk.liveVerified ? "LIVE VERIFIED" : "NO LIVE METRICS"}
                  </span>
                </div>
                <div className="desk-mission-agents">
                  {(desk.agents || []).map((agentItem) => (
                    <span key={agentItem.id} className="gm-muted gm-small">
                      {agentItem.name}: {agentItem.statusLabel}
                    </span>
                  ))}
                </div>
                {desk.missingConfiguration?.length > 0 && (
                  <div className="desk-missing">
                    Missing: {desk.missingConfiguration.join(", ")}
                  </div>
                )}
                {desk.approvalRequired && (
                  <div className="desk-mission-approval">
                    APPROVAL REQUIRED for consequential external actions.
                  </div>
                )}
              </article>
            ))}
          </div>

          <div className="desk-section-head">
            <div>
              <h2>Specialist registry</h2>
              <p>
                {agents.length} agents with contracts, permissions and honest
                runtime gates.
              </p>
            </div>
            {detail && (
              <button
                type="button"
                className="gm-btn ghost"
                onClick={() => {
                  setAgentDetail(null);
                  setSelectedAgentId(null);
                }}
              >
                Close detail
              </button>
            )}
          </div>

          {!agents.length && !loading && (
            <div className="gm-empty">No agents returned by the backend.</div>
          )}

          <div className="desk-agent-grid">
            {agents.map((agent) => (
              <button
                type="button"
                key={agent.id}
                className={`desk-agent-card ${
                  selectedAgentId === agent.id ? "selected" : ""
                }`}
                onClick={() => openAgent(agent.id)}
                aria-pressed={selectedAgentId === agent.id}
              >
                <div className="desk-agent-top">
                  <span className="gm-agent-icon">⌘</span>
                  <div className="desk-agent-pills">
                    <Pill tone={statusTone(agent.status)}>
                      {String(agent.status || "UNKNOWN").replace(/_/g, " ").toUpperCase()}
                    </Pill>
                    <Pill tone={LABEL_STYLE[agent.evidence?.label] || ""}>
                      {agent.evidence?.label || "NOT VERIFIED"}
                    </Pill>
                    <Pill tone={GATE_STYLE[agent.gate] || ""}>{agent.gate}</Pill>
                  </div>
                </div>
                <div className="desk-agent-name">{agent.name}</div>
                <p className="desk-agent-desc">{agent.responsibility}</p>
                <div className="desk-agent-meta">
                  <span>RISK: {String(agent.risk || "—").toUpperCase()}</span>
                  <span>{agent.capabilities?.length || 0} CAPABILITIES</span>
                </div>
                {agent.missingConfiguration?.length > 0 && (
                  <div className="desk-missing">
                    Missing: {agent.missingConfiguration.join(", ")}
                  </div>
                )}
              </button>
            ))}
          </div>

          {detail && (
            <div className="gm-card desk-detail">
              <div className="gm-card-head">
                <div>
                  <h2>{detail.name}</h2>
                  <p>{detail.responsibility}</p>
                </div>
                <div className="desk-agent-pills">
                  <Pill tone={statusTone(detail.status)}>
                    {String(detail.status || "").replace(/_/g, " ").toUpperCase()}
                  </Pill>
                  <Pill tone={LABEL_STYLE[detail.evidence?.label] || ""}>
                    {detail.evidence?.label || "NOT VERIFIED"}
                  </Pill>
                  <Pill tone={GATE_STYLE[detail.gate] || ""}>{detail.gate}</Pill>
                </div>
              </div>

              <p className="gm-muted gm-small">{detail.statusReason}</p>
              {detail.evidence?.detail &&
                detail.evidence.detail !== detail.statusReason && (
                  <p className="gm-muted gm-small">
                    Evidence: {detail.evidence.detail}
                  </p>
                )}

              <div className="desk-detail-grid">
                <div>
                  <h3>Capabilities</h3>
                  <ul className="desk-list">
                    {(detail.capabilities || []).map((capability) => (
                      <li key={capability.id}>
                        <strong>{capability.label}</strong>
                        <span className="gm-muted gm-small"> · {capability.kind}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h3>Permissions</h3>
                  <ul className="desk-list">
                    <li>Level: {detail.permissions?.level || "—"}</li>
                    <li>
                      External actions:{" "}
                      {detail.permissions?.externalActions ? "YES (gated)" : "NO"}
                    </li>
                    <li>
                      Financial actions:{" "}
                      {detail.permissions?.financialActions ? "YES" : "NO (LOCKED)"}
                    </li>
                    {detail.permissions?.notes && (
                      <li className="gm-muted gm-small">{detail.permissions.notes}</li>
                    )}
                  </ul>
                  {detail.lockedActions?.length > 0 && (
                    <div className="desk-locked-actions">
                      <strong>Locked actions:</strong> {detail.lockedActions.join(", ")}
                    </div>
                  )}
                </div>
                <div>
                  <h3>Connections</h3>
                  <ul className="desk-list">
                    {(detail.connections || []).map((connection) => (
                      <li key={connection.envVar}>
                        <code>{connection.envVar}</code>{" "}
                        <Pill tone={connection.configured ? "green" : "red"}>
                          {connection.configured ? "CONFIGURED" : "MISSING"}
                        </Pill>{" "}
                        <Pill tone={connection.implemented ? "gold" : "red"}>
                          {connection.implemented ? "IMPLEMENTED" : "NOT IMPLEMENTED"}
                        </Pill>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              <div className="desk-detail-footer">
                <button
                  type="button"
                  className="gm-btn primary"
                  onClick={() => {
                    setTaskAgent(detail.id);
                    setTab("tasks");
                  }}
                >
                  Create a task for {detail.name}
                </button>
                <span className="gm-muted gm-small">
                  Recent tasks: {detail.recentTasks?.length ?? 0}
                </span>
              </div>

              {detail.recentTasks?.length > 0 && (
                <div className="desk-recent-tasks">
                  {detail.recentTasks.map((task) => (
                    <div key={task.id} className="desk-recent-row">
                      <Pill tone={TASK_STATUS_STYLE[task.status] || ""}>
                        {task.status}
                      </Pill>
                      <span className="desk-recent-request">Task {task.id}</span>
                      <span className="gm-muted gm-small">
                        {formatDate(task.createdAt)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {tab === "tasks" && (
        <section className="desk-section">
          <div className="desk-section-head">
            <div>
              <h2>Task control</h2>
              <p>
                Financial execution is LOCKED. Consequential external actions stop
                at AWAITING APPROVAL and are never published by this system.
              </p>
            </div>
            <button type="button" className="gm-btn" onClick={refreshTasks}>
              ↻ Refresh tasks
            </button>
          </div>

          <div className="gm-card desk-inbox">
            <div className="gm-card-head">
              <div>
                <h2>Approval inbox</h2>
                <p>
                  Real tasks waiting for control authorization. Approving records
                  the decision and queues the task; external execution remains NOT
                  IMPLEMENTED.
                </p>
              </div>
              <Pill tone={approvalInbox.length ? "gold" : "green"}>
                {approvalInbox.length} WAITING
              </Pill>
            </div>
            {!token.trim() && (
              <div className="gm-muted gm-small">
                Enter the control token and select Refresh tasks to load the
                approval inbox.
              </div>
            )}
            {token.trim() && !approvalInbox.length && (
              <div className="gm-muted gm-small">
                No tasks are waiting for approval.
              </div>
            )}
            <div className="desk-inbox-list">
              {approvalInbox.map((task) => (
                <div key={task.id} className="desk-inbox-row">
                  <div className="desk-inbox-main">
                    <Pill tone="gold">AWAITING APPROVAL</Pill>
                    <strong>{task.request}</strong>
                    <span className="gm-muted gm-small">
                      ID {task.id} · {task.agentId} · risk {task.risk} ·{" "}
                      {formatDate(task.createdAt)}
                    </span>
                  </div>
                  <div className="desk-inbox-actions">
                    <button
                      type="button"
                      className="gm-btn primary"
                      disabled={busy === `approve-${task.id}`}
                      onClick={() => taskAction(task.id, "approve")}
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      className="gm-btn danger"
                      disabled={busy === `cancel-${task.id}`}
                      onClick={() => taskAction(task.id, "cancel")}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <form className="gm-card desk-form" onSubmit={submitTask}>
            <label htmlFor="desk-task-request">Request</label>
            <textarea
              id="desk-task-request"
              className="gm-field gm-textarea"
              placeholder="e.g. Draft a product launch checklist"
              maxLength={2000}
              value={taskRequest}
              onChange={(event) => setTaskRequest(event.target.value)}
            />
            <div className="desk-form-row">
              <div className="desk-form-field">
                <label htmlFor="desk-task-agent">Agent</label>
                <select
                  id="desk-task-agent"
                  className="gm-field"
                  value={taskAgent}
                  onChange={(event) => setTaskAgent(event.target.value)}
                >
                  <option value="">Auto (Mastermind classification)</option>
                  {agents.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="desk-form-actions">
                <button
                  type="submit"
                  className="gm-btn primary"
                  disabled={busy === "create-task" || !taskRequest.trim()}
                >
                  {busy === "create-task" ? "Submitting…" : "Submit task"}
                </button>
                <button
                  type="button"
                  className="gm-btn"
                  onClick={planTask}
                  disabled={busy === "plan" || !taskRequest.trim()}
                >
                  {busy === "plan" ? "Planning…" : "Preview plan"}
                </button>
              </div>
            </div>
          </form>

          {planPreview && (
            <div className="gm-card desk-plan">
              <div className="gm-card-head">
                <div>
                  <h2>Plan</h2>
                  <p>
                    {planPreview.agentName} · {planPreview.gate}
                  </p>
                </div>
                <Pill tone={GATE_STYLE[planPreview.gate] || ""}>
                  {planPreview.gate || "NOT CONNECTED"}
                </Pill>
              </div>
              {planPreview.reason && (
                <p className="gm-muted gm-small">{planPreview.reason}</p>
              )}
              <ol className="desk-plan-steps">
                {planPreview.steps?.map((step) => (
                  <li key={step.id} className={step.status}>
                    <strong>{step.label}</strong>
                    <span className="gm-muted gm-small"> · {step.status}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {selectedTaskPreview && (
            <div className="gm-card desk-plan">
              <div className="gm-card-head">
                <div>
                  <h2>Latest task</h2>
                  <p>{selectedTaskPreview.request}</p>
                </div>
                <Pill tone={TASK_STATUS_STYLE[selectedTaskPreview.status] || ""}>
                  {selectedTaskPreview.status}
                </Pill>
              </div>
              {selectedTaskPreview.result?.summary && (
                <pre className="desk-pre">{selectedTaskPreview.result.summary}</pre>
              )}
              {selectedTaskPreview.error && (
                <div className="gm-notice danger">
                  <strong>{selectedTaskPreview.error.code}</strong>{" "}
                  {selectedTaskPreview.error.message}
                </div>
              )}
            </div>
          )}

          <div className="desk-task-list">
            {!tasks.length && !loading && (
              <div className="gm-empty">
                {taskAuthError
                  ? "Tasks are locked. Enter a valid control token and select Refresh."
                  : token.trim()
                    ? "No tasks recorded yet."
                    : "Enter the control token to load tasks and notifications."}
              </div>
            )}
            {tasks.map((task) => {
              const canCancel = !["COMPLETED", "CANCELLED", "RUNNING"].includes(task.status);
              const canRun = ["QUEUED", "RETRY_PENDING"].includes(task.status);
              const canRetry =
                task.status === "FAILED" && task.attempts < task.maxAttempts;
              return (
                <article key={task.id} className="gm-card desk-task">
                  <div className="desk-task-head">
                    <div className="desk-task-title">
                      <Pill tone={TASK_STATUS_STYLE[task.status] || ""}>
                        {task.status}
                      </Pill>
                      <strong>{task.request}</strong>
                    </div>
                    <div className="desk-task-meta">
                      <span>ID {task.id}</span>
                      <span>{task.agentId}</span>
                      <span>attempts {task.attempts}/{task.maxAttempts}</span>
                      <span>{formatDate(task.createdAt)}</span>
                    </div>
                  </div>

                  {task.approval?.required && (
                    <div className="desk-approval-row">
                      <Pill tone={task.approval.status === "approved" ? "green" : "gold"}>
                        APPROVAL {String(task.approval.status).toUpperCase()}
                      </Pill>
                      <span className="gm-muted gm-small">
                        {task.approval.status === "pending"
                          ? "Awaiting control authorization. No external action is performed."
                          : task.approval.status === "approved"
                            ? "Approval recorded. External execution is still not implemented."
                            : ""}
                      </span>
                    </div>
                  )}

                  {task.result?.summary && (
                    <pre className="desk-pre">{task.result.summary}</pre>
                  )}
                  {task.error && (
                    <div className="desk-task-error">
                      <strong>{task.error.code}</strong> {task.error.message}
                    </div>
                  )}

                  <div className="desk-task-actions">
                    {task.status === "AWAITING_APPROVAL" && (
                      <button
                        type="button"
                        className="gm-btn primary"
                        disabled={busy === `approve-${task.id}`}
                        onClick={() => taskAction(task.id, "approve")}
                      >
                        Approve
                      </button>
                    )}
                    {canRun && (
                      <button
                        type="button"
                        className="gm-btn"
                        disabled={busy === `run-${task.id}`}
                        onClick={() => taskAction(task.id, "run")}
                      >
                        Run
                      </button>
                    )}
                    {canRetry && (
                      <button
                        type="button"
                        className="gm-btn"
                        disabled={busy === `retry-${task.id}`}
                        onClick={() => taskAction(task.id, "retry")}
                      >
                        Retry
                      </button>
                    )}
                    {canCancel && (
                      <button
                        type="button"
                        className="gm-btn danger"
                        disabled={busy === `cancel-${task.id}`}
                        onClick={() => taskAction(task.id, "cancel")}
                      >
                        Cancel
                      </button>
                    )}
                    <details className="desk-task-history">
                      <summary>History</summary>
                      <ol>
                        {(task.history || []).map((entry, index) => (
                          <li key={`${entry.at}-${index}`}>
                            <span>{entry.status}</span>{" "}
                            <span className="gm-muted gm-small">
                              {formatDate(entry.at)}
                            </span>
                            {entry.detail ? (
                              <div className="gm-muted gm-small">{entry.detail}</div>
                            ) : null}
                          </li>
                        ))}
                      </ol>
                    </details>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      {tab === "memory" && (
        <section className="desk-section">
          <div className="desk-section-head">
            <div>
              <h2>Persistent memory</h2>
              <p>
                Stored by the backend. Secrets are rejected. Listing, search,
                create, update and delete all require the control token.
              </p>
            </div>
            {status?.storage?.memory && (
              <Pill tone={status.storage.memory.durable ? "green" : "gold"}>
                {status.storage.memory.durable
                  ? "DURABLE"
                  : status.storage.memory.ephemeral
                    ? "EPHEMERAL (/tmp)"
                    : "PROCESS MEMORY"}
              </Pill>
            )}
          </div>

          {!token.trim() && (
            <div className="gm-notice" style={{ marginBottom: 14 }}>
              Server memory is protected. Enter the control token above, then
              select <strong>Load memories</strong> or search.
            </div>
          )}
          {memoryAuthError && (
            <div
              className="gm-notice danger"
              role="alert"
              style={{ marginBottom: 14 }}
            >
              {memoryAuthError}
            </div>
          )}

          <form className="gm-card desk-form" onSubmit={addMemory}>
            <label htmlFor="desk-memory-text">New memory</label>
            <textarea
              id="desk-memory-text"
              className="gm-field gm-textarea desk-memory-input"
              placeholder="e.g. Prefers concise, evidence-based answers"
              maxLength={1000}
              value={memoryText}
              onChange={(event) => setMemoryText(event.target.value)}
            />
            <div className="desk-form-row">
              <div className="desk-form-field">
                <label htmlFor="desk-memory-category">Category</label>
                <select
                  id="desk-memory-category"
                  className="gm-field"
                  value={memoryNewCategory}
                  onChange={(event) => setMemoryNewCategory(event.target.value)}
                >
                  {memoryCategoryOptions.map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </select>
              </div>
              <div className="desk-form-actions">
                <button
                  type="submit"
                  className="gm-btn primary"
                  disabled={busy === "memory-create" || !memoryText.trim()}
                >
                  {busy === "memory-create" ? "Saving…" : "Save memory"}
                </button>
              </div>
            </div>
          </form>

          <form className="desk-toolbar" onSubmit={searchMemory}>
            <input
              className="gm-field"
              type="search"
              placeholder="Search memory"
              value={memoryQuery}
              onChange={(event) => setMemoryQuery(event.target.value)}
            />
            <select
              className="gm-field"
              value={memoryCategory}
              onChange={(event) => setMemoryCategory(event.target.value)}
              aria-label="Filter by category"
            >
              <option value="">All categories</option>
              {memoryCategoryOptions.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="gm-btn"
              onClick={() => loadMemories()}
              disabled={!token.trim() || busy === "memory-list"}
            >
              {busy === "memory-list" ? "Loading…" : "Load memories"}
            </button>
            <button
              type="submit"
              className="gm-btn"
              disabled={!token.trim() || busy === "memory-search"}
            >
              Search
            </button>
          </form>

          <div className="desk-memory-list">
            {!memories.length && !loading && (
              <div className="gm-empty">
                {memoryLoaded
                  ? "No memories stored."
                  : token.trim()
                    ? "Memory list not loaded. Select Load memories."
                    : "Enter the control token to load server memory."}
              </div>
            )}
            {memories.map((memory) => (
              <div key={memory.id} className="gm-card desk-memory">
                <div className="desk-memory-main">
                  <div className="desk-memory-text">{memory.text}</div>
                  <div className="desk-memory-meta">
                    <Pill tone="gold">{memory.category}</Pill>
                    <span className="gm-muted gm-small">ID {memory.id}</span>
                    <span className="gm-muted gm-small">source {memory.source}</span>
                    {(memory.tags || []).map((tag) => (
                      <span key={tag} className="gm-muted gm-small">
                        #{tag}
                      </span>
                    ))}
                    <span className="gm-muted gm-small">
                      {formatDate(memory.updatedAt)}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  className="gm-btn danger"
                  disabled={busy === `memory-delete-${memory.id}`}
                  onClick={() => removeMemory(memory.id)}
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {tab === "integrations" && (
        <section className="desk-section">
          <div className="desk-section-head">
            <div>
              <h2>Integration framework</h2>
              <p>
                Every external integration reports its real state. A test never
                performs an external action unless the integration is implemented.
              </p>
            </div>
          </div>

          <div className="desk-integration-grid">
            {integrations.map((integration) => {
              const result = integrationResults[integration.id];
              return (
                <article key={integration.id} className="gm-card desk-integration">
                  <div className="gm-card-head">
                    <div>
                      <h2>{integration.name}</h2>
                      <p>{integration.permissionRequirements}</p>
                    </div>
                    <Pill tone={integration.status === "connected" ? "green" : integration.status === "degraded" ? "gold" : "red"}>
                      {String(integration.status).replace(/_/g, " ").toUpperCase()}
                    </Pill>
                  </div>
                  {integration.missingConfiguration?.length > 0 && (
                    <div className="desk-missing">
                      Missing: {integration.missingConfiguration.join(", ")}
                    </div>
                  )}
                  {integration.error && (
                    <p className="gm-muted gm-small">{integration.error}</p>
                  )}
                  {integration.id === "ai_provider" && (
                    <div className="desk-missing">
                      This verification performs a real provider call. A configuration
                      value alone is not treated as healthy.
                    </div>
                  )}
                  <div className="desk-integration-footer">
                    <button
                      type="button"
                      className="gm-btn"
                      disabled={busy === `integration-${integration.id}`}
                      onClick={() => testIntegration(integration.id)}
                    >
                      {busy === `integration-${integration.id}`
                        ? "Testing…"
                        : integration.id === "ai_provider"
                          ? "Verify (real call)"
                          : "Safe test"}
                    </button>
                    <span className="gm-muted gm-small">
                      {integration.supportedOperations?.join(" · ")}
                    </span>
                  </div>
                  {result && (
                    <div className="desk-integration-result">
                      <Pill tone={result.status === "ok" ? "green" : "gold"}>
                        {String(result.status).replace(/_/g, " ").toUpperCase()}
                      </Pill>{" "}
                      <span className="gm-small">{result.message}</span>
                      <div className="gm-muted gm-small">
                        External action performed: {result.performed ? "yes" : "no"}
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
          </div>

          <div className="gm-card" style={{ marginTop: 16 }}>
            <div className="gm-card-head">
              <div>
                <h2>Notification channels</h2>
                <p>Only in-app notifications are operational.</p>
              </div>
            </div>
            <div className="gm-list">
              {channels.map((channel) => (
                <div key={channel.id} className="gm-list-row">
                  <span className="gm-row-icon">◉</span>
                  <div className="gm-row-main">
                    <div className="gm-row-title">{channel.label || channel.id}</div>
                    <div className="gm-row-sub">{channel.detail || channel.note || "No external channel contacted."}</div>
                  </div>
                  <Pill tone={channel.status === "operational" ? "green" : "red"}>
                    {String(channel.status || "unknown").replace(/_/g, " ").toUpperCase()}
                  </Pill>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {tab === "security" && (
        <section className="desk-section">
          <div className="desk-section-head">
            <div>
              <h2>Security posture & audit</h2>
              <p>
                Policy controls are enforced on the server, not by hidden buttons.
                Audit access requires the control token.
              </p>
            </div>
          </div>

          <div className="desk-posture-grid">
            {(posture?.lockedActions || []).map((item) => (
              <div key={item.action} className="gm-card desk-posture">
                <div className="desk-posture-head">
                  <strong>{item.action.replace(/_/g, " ")}</strong>
                  <Pill tone={item.status === "LOCKED" ? "red" : "gold"}>
                    {item.status}
                  </Pill>
                </div>
                <p className="gm-muted gm-small">{item.detail}</p>
              </div>
            ))}
          </div>

          {posture?.notes?.length > 0 && (
            <div className="gm-notice" style={{ marginBottom: 14 }}>
              {posture.notes.map((note) => (
                <div key={note} className="gm-small">
                  · {note}
                </div>
              ))}
            </div>
          )}

          <div className="gm-card">
            <div className="gm-card-head">
              <div>
                <h2>Audit trail</h2>
                <p>Sanitized server-side events. Secrets are dropped before storage.</p>
              </div>
              <button
                type="button"
                className="gm-btn"
                onClick={loadAudit}
                disabled={busy === "audit"}
              >
                {busy === "audit" ? "Loading…" : "Load audit"}
              </button>
            </div>

            {!audit && (
              <div className="gm-muted gm-small">
                Enter the control token and load the audit trail.
              </div>
            )}

            {audit && (
              <>
                <div className="desk-audit-stats">
                  <Pill tone="gold">{audit.stats?.total ?? 0} EVENTS</Pill>
                  <span className="gm-muted gm-small">
                    Last event: {formatDate(audit.stats?.lastEventAt)}
                  </span>
                  <span className="gm-muted gm-small">
                    Showing up to 100 most recent events. The backend does not claim
                    this list is a complete audit history.
                  </span>
                </div>
                <div className="desk-audit-list">
                  {(audit.events || []).map((event) => (
                    <div key={event.id} className="desk-audit-row">
                      <Pill tone={event.outcome === "failed" ? "red" : "gold"}>
                        {String(event.outcome || "recorded").toUpperCase()}
                      </Pill>
                      <div className="desk-audit-main">
                        <strong>{event.action}</strong>
                        <div className="gm-muted gm-small">
                          ID {event.id}
                          {` · ${event.actor}`}
                          {event.agentId ? ` · ${event.agentId}` : ""}
                          {event.taskId ? ` · task ${event.taskId}` : ""}
                          {` · ${formatDate(event.at)}`}
                        </div>
                        {event.detail ? (
                          <div className="gm-muted gm-small">{event.detail}</div>
                        ) : null}
                      </div>
                    </div>
                  ))}
                  {!audit.events?.length && (
                    <div className="gm-empty">No audit events recorded.</div>
                  )}
                </div>
              </>
            )}
          </div>

          <div className="gm-notice danger" style={{ marginTop: 14 }}>
            <strong>Boundaries:</strong> real trading LOCKED · money movement LOCKED
            · MT5 MONITOR ONLY · Binance RESEARCH ONLY · external publishing and
            account changes require approval and are not implemented.
          </div>
        </section>
      )}
    </div>
  );
}

const deskCss = `
.desk-root{display:flex;flex-direction:column;gap:14px}
.desk-head-actions{display:flex;gap:8px;align-items:flex-start}
.desk-status-strip{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:4px}
.desk-token-row{display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding:12px 14px;border:1px solid var(--border);border-radius:12px;background:#ffffff03}
.desk-token-label{font-size:11px;font-weight:800;letter-spacing:.4px;text-transform:uppercase;color:var(--muted)}
.desk-token-input{max-width:320px;padding:9px 11px}
.desk-tabs{display:flex;flex-wrap:wrap;gap:6px;border-bottom:1px solid var(--border);padding-bottom:10px}
.desk-tab{border:1px solid transparent;background:transparent;color:var(--muted);border-radius:9px;padding:9px 12px;font-size:12px;font-weight:700}
.desk-tab:hover{background:#ffffff08;color:#fff}
.desk-tab.active{background:#f5bc4b14;border-color:#f5bc4b38;color:var(--gold2)}
.desk-section{display:flex;flex-direction:column;gap:14px}
.desk-section-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;flex-wrap:wrap}
.desk-section-head h2{margin:0;font-size:15px;font-weight:800}
.desk-section-head p{margin:5px 0 0;font-size:11px;color:var(--muted);max-width:820px}
.desk-mission-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px}
.desk-mission{display:flex;flex-direction:column;gap:9px}
.desk-mission-head{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}
.desk-mission-head strong{font-size:12px;line-height:1.4}
.desk-mission-boundary{margin:0;font-size:11px;color:var(--muted);line-height:1.55}
.desk-mission-meta{display:flex;flex-wrap:wrap;align-items:center;gap:8px;font-size:9px;letter-spacing:.4px;color:#7d879c;font-weight:700}
.desk-mission-agents{display:flex;flex-direction:column;gap:3px;border-top:1px solid var(--border);padding-top:8px}
.desk-mission-approval{font-size:10px;color:var(--gold2);background:#f5bc4b0d;border:1px solid #f5bc4b26;border-radius:8px;padding:6px 8px}
.desk-inbox{display:flex;flex-direction:column;gap:10px}
.desk-inbox-list{display:flex;flex-direction:column;gap:8px}
.desk-inbox-row{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;border:1px solid var(--border);border-radius:9px;padding:9px 10px;background:#ffffff03;flex-wrap:wrap}
.desk-inbox-main{display:flex;flex-direction:column;gap:5px;flex:1;min-width:220px;font-size:11px}
.desk-inbox-main strong{overflow-wrap:anywhere}
.desk-inbox-actions{display:flex;gap:8px;flex-wrap:wrap}
.desk-agent-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:12px}
.desk-agent-card{display:flex;flex-direction:column;gap:8px;text-align:left;border:1px solid var(--border);background:linear-gradient(145deg,#121622,#0e111a);border-radius:13px;padding:14px;color:inherit;transition:.15s;min-height:190px}
.desk-agent-card:hover{border-color:#f5bc4b66;transform:translateY(-1px)}
.desk-agent-card.selected{border-color:#f5bc4b99;background:#f5bc4b0a}
.desk-agent-top{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}
.desk-agent-pills{display:flex;flex-wrap:wrap;gap:5px;justify-content:flex-end}
.desk-agent-name{font-size:13px;font-weight:800}
.desk-agent-desc{font-size:11px;color:var(--muted);margin:0;line-height:1.55;flex:1}
.desk-agent-meta{display:flex;flex-wrap:wrap;gap:8px;font-size:9px;letter-spacing:.4px;color:#7d879c;font-weight:700}
.desk-missing{font-size:10px;color:var(--gold2);background:#f5bc4b0d;border:1px solid #f5bc4b26;border-radius:8px;padding:6px 8px;overflow-wrap:anywhere}
.desk-detail{display:flex;flex-direction:column;gap:12px}
.desk-detail-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px}
.desk-detail-grid h3{font-size:11px;text-transform:uppercase;letter-spacing:.6px;color:var(--gold);margin:0 0 8px}
.desk-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:7px;font-size:11px}
.desk-list li{line-height:1.5;overflow-wrap:anywhere}
.desk-list code{font-size:10px;background:#ffffff0a;border:1px solid var(--border);border-radius:6px;padding:2px 5px}
.desk-locked-actions{margin-top:9px;font-size:10px;color:var(--red);background:#ff737d0d;border:1px solid #ff737d26;border-radius:8px;padding:7px 9px}
.desk-detail-footer{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;border-top:1px solid var(--border);padding-top:12px}
.desk-recent-tasks{display:flex;flex-direction:column;gap:6px;border-top:1px solid var(--border);padding-top:10px}
.desk-recent-row{display:flex;align-items:center;gap:10px;font-size:11px}
.desk-recent-request{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.desk-form{display:flex;flex-direction:column;gap:10px}
.desk-form label{font-size:11px;font-weight:800;letter-spacing:.4px;text-transform:uppercase;color:var(--muted)}
.desk-form-row{display:flex;align-items:flex-end;gap:12px;flex-wrap:wrap}
.desk-form-field{display:flex;flex-direction:column;gap:6px;min-width:220px;flex:1}
.desk-form-actions{display:flex;gap:8px;flex-wrap:wrap}
.desk-memory-input{min-height:90px}
.desk-plan{display:flex;flex-direction:column;gap:8px}
.desk-plan-steps{margin:0;padding-left:20px;display:flex;flex-direction:column;gap:6px;font-size:11px}
.desk-plan-steps li.blocked{color:var(--red)}
.desk-plan-steps li.complete{color:var(--green)}
.desk-plan-steps li.pending{color:var(--muted)}
.desk-pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:320px;overflow:auto;background:#090c14;border:1px solid var(--border);border-radius:10px;padding:12px;margin:0;font:11px/1.7 ui-monospace,Consolas,monospace;color:#dce1ef}
.desk-task-list{display:flex;flex-direction:column;gap:10px}
.desk-task{display:flex;flex-direction:column;gap:9px}
.desk-task-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;flex-wrap:wrap}
.desk-task-title{display:flex;align-items:flex-start;gap:8px;font-size:12px;flex:1;min-width:220px}
.desk-task-meta{display:flex;flex-wrap:wrap;gap:10px;font-size:10px;color:var(--muted)}
.desk-approval-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;background:#f5bc4b08;border:1px solid #f5bc4b26;border-radius:9px;padding:8px 10px}
.desk-task-error{font-size:11px;color:var(--red);background:#ff737d0d;border:1px solid #ff737d26;border-radius:9px;padding:8px 10px;overflow-wrap:anywhere}
.desk-task-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.desk-task-history{font-size:11px;color:var(--muted);margin-left:auto}
.desk-task-history summary{cursor:pointer;font-weight:700;color:#c4cad8}
.desk-task-history ol{margin:8px 0 0;padding-left:18px;display:flex;flex-direction:column;gap:5px;max-height:200px;overflow:auto}
.desk-toolbar{display:flex;flex-wrap:wrap;gap:8px}
.desk-toolbar .gm-field{flex:1;min-width:160px;padding:9px 11px}
.desk-toolbar .gm-field:last-of-type{flex:0 0 180px}
.desk-memory-list{display:flex;flex-direction:column;gap:9px}
.desk-memory{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
.desk-memory-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:7px}
.desk-memory-text{font-size:12px;line-height:1.55;overflow-wrap:anywhere}
.desk-memory-meta{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.desk-integration-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px}
.desk-integration{display:flex;flex-direction:column;gap:9px}
.desk-integration-footer{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-top:auto}
.desk-integration-result{font-size:11px;border-top:1px solid var(--border);padding-top:9px;display:flex;flex-direction:column;gap:5px}
.desk-posture-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px}
.desk-posture{display:flex;flex-direction:column;gap:7px}
.desk-posture-head{display:flex;align-items:center;justify-content:space-between;gap:8px}
.desk-posture-head strong{font-size:11px;text-transform:capitalize}
.desk-posture p{margin:0}
.desk-audit-stats{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px}
.desk-audit-list{display:flex;flex-direction:column;gap:7px;max-height:460px;overflow:auto}
.desk-audit-row{display:flex;align-items:flex-start;gap:10px;border:1px solid var(--border);border-radius:9px;padding:8px 10px;background:#ffffff03}
.desk-audit-main{flex:1;min-width:0;font-size:11px}
.desk-audit-main strong{overflow-wrap:anywhere}
@media (max-width:640px){
  .desk-token-input{max-width:none;width:100%}
  .desk-task-history{margin-left:0}
  .desk-memory{flex-direction:column;align-items:stretch}
}
`;
