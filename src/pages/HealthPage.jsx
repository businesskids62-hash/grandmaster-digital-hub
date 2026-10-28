/* Presentational health page. All probes run in App.jsx so the sidebar state
   stays in sync; this page only shows results and triggers refreshes. */

function Row({ icon, title, subtitle, children }) {
  return (
    <div className="gm-list-row">
      <span className="gm-row-icon">{icon}</span>
      <div className="gm-row-main">
        <div className="gm-row-title">{title}</div>
        <div className="gm-row-sub">{subtitle}</div>
      </div>
      {children}
    </div>
  );
}

function Pill({ type = "", children }) {
  return <span className={`gm-pill ${type}`}>{children}</span>;
}

export default function HealthPage({
  buildInfo,
  backend,
  backendType,
  healthData,
  healthError,
  lastChecked,
  refreshing,
  onFreshCheck,
  aiStatus,
  aiView,
  aiDetail,
  aiReason,
  aiCheckedAt,
  mt5Status,
  mt5View,
  mt5Checked,
  storage,
  storageView,
  mic,
  isListening,
  onRefreshMic,
  doctorScan,
  doctorRunning,
  onRunDoctor,
}) {
  const micState = mic || {};
  const micType =
    micState.permission === "granted"
      ? "green"
      : micState.permission === "denied" || micState.secureContext === false
        ? "red"
        : micState.permission === "prompt"
          ? "gold"
          : "";
  const doctorType = doctorRunning
    ? "gold"
    : doctorScan?.lastScan?.status === "clean"
      ? "green"
      : doctorScan?.lastScan?.status === "threats_found"
        ? "gold"
        : "";
  const storageLabel = storageView?.label || "NOT CHECKED";
  const checks = [
    ["Backend API", backend],
    ["AI provider", aiView?.label || "UNKNOWN"],
    ["Microphone", micState.permission ? micState.permission.toUpperCase() : "UNKNOWN"],
    ["Doctor (simulated)", doctorScan?.lastScan?.status || "NOT RUN"],
  ];

  return (
    <>
      <section className="gm-welcome">
        <div>
          <div className="gm-kicker">Diagnostics · fresh checks</div>
          <h1 className="gm-h1">
            System <span className="gm-gradient">Health.</span>
          </h1>
          <p className="gm-muted" style={{ margin: 0 }}>
            Backend, AI provider, microphone and the simulated Doctor, each with
            the time it was last checked.
          </p>
        </div>
        <button
          className="gm-btn primary"
          onClick={onFreshCheck}
          disabled={refreshing}
          aria-label="Run a fresh health check"
        >
          {refreshing ? "Checking…" : "↻ Fresh check"}
        </button>
      </section>

      <div className="gm-notice" role="status">
        <strong>Fresh check:</strong> re-reads readiness, forces one bounded live
        AI provider check and probes the read-only MT5 bridge. Last checked:{" "}
        <strong>{lastChecked || "never"}</strong>.
        {healthError ? ` · ${healthError}` : ""}
      </div>

      <div className="gm-grid gm-two" style={{ marginTop: 16 }}>
        <section className="gm-card">
          <div className="gm-card-head">
            <div>
              <h2>Backend</h2>
              <p>HTTP reachability is not proof that every subsystem works.</p>
            </div>
            <Pill type={backendType}>{backend}</Pill>
          </div>
          <div className="gm-list">
            <Row
              icon="⌘"
              title="Readiness report"
              subtitle={
                healthData
                  ? `status ${healthData.status || "unknown"} · storage ${
                      healthData.storageStatus || "unknown"
                    }${healthData.requestId ? ` · req #${String(healthData.requestId).slice(0, 8)}` : ""}`
                  : "Not loaded yet"
              }
            >
              <Pill type={healthData?.status === "GREEN" ? "green" : "gold"}>
                {healthData?.status || "UNKNOWN"}
              </Pill>
            </Row>
            <Row
              icon="▤"
              title="Storage"
              subtitle={
                storage
                  ? `${storage.mode} · ${storage.writable ? "writable" : "read-only"} · ${
                      healthData?.storageStatus || "unknown"
                    }`
                  : "Task, memory and audit stores"
              }
            >
              <Pill type={storageView?.type}>{storageLabel}</Pill>
            </Row>
            <Row
              icon="◫"
              title="MT5 Bridge"
              subtitle={`Read-only · trading locked · ${
                mt5Checked ? `checked ${mt5Checked}` : "not checked"
              }${mt5Status?.terminalConnected ? " · terminal connected" : ""}`}
            >
              <Pill type={mt5View?.type}>{mt5View?.label || "NOT CHECKED"}</Pill>
            </Row>
            <Row
              icon="⬢"
              title="Trading Safety"
              subtitle="No live trading, orders or money movement from this dashboard"
            >
              <Pill type="green">LOCKED</Pill>
            </Row>
          </div>
        </section>

        <section className="gm-card">
          <div className="gm-card-head">
            <div>
              <h2>AI provider</h2>
              <p>
                Cached snapshot by default. “Fresh check” performs one small live
                verification call.
              </p>
            </div>
            <Pill type={aiView?.type}>{aiView?.label || "UNKNOWN"}</Pill>
          </div>
          <div className="gm-list">
            <Row
              icon="✦"
              title="Model"
              subtitle={
                aiDetail
                  ? `${aiDetail.provider || "provider"} / ${
                      aiDetail.model || "model"
                    }${aiDetail.latencyMs != null ? ` · ${aiDetail.latencyMs} ms` : ""}${
                      aiDetail.stale ? " · stale" : ""
                    }`
                  : "No snapshot loaded"
              }
            >
              <Pill type={aiView?.type}>{aiStatus}</Pill>
            </Row>
            <Row
              icon="⏱"
              title="Last verified"
              subtitle={
                aiCheckedAt ? `checked ${aiCheckedAt}` : "Not verified in this session"
              }
            >
              <Pill type={aiDetail?.stale ? "gold" : aiDetail ? "green" : ""}>
                {aiDetail?.stale ? "STALE" : aiDetail ? "CACHED" : "NOT CHECKED"}
              </Pill>
            </Row>
            <Row
              icon="⚠"
              title="Provider note"
              subtitle={aiReason || "No provider problem reported"}
            >
              <Pill type={aiReason ? "gold" : "green"}>
                {aiReason ? "NOTE" : "CLEAR"}
              </Pill>
            </Row>
          </div>
        </section>
      </div>

      <div className="gm-grid gm-two" style={{ marginTop: 16 }}>
        <section className="gm-card">
          <div className="gm-card-head">
            <div>
              <h2>Microphone</h2>
              <p>
                Browser permission and device state. Wake word “Mere Sher” needs
                localhost or HTTPS.
              </p>
            </div>
            <Pill type={micType}>
              {micState.supported === false
                ? "UNSUPPORTED"
                : micState.permission === "denied"
                  ? "BLOCKED"
                  : isListening
                    ? "LISTENING"
                    : micState.permission
                      ? "IDLE"
                      : "UNKNOWN"}
            </Pill>
          </div>
          <div className="gm-list">
            <Row
              icon="🎙"
              title="Permission"
              subtitle={
                micState.supported === false
                  ? "Device enumeration is not supported in this browser"
                  : `${micState.permission || "unknown"} · ${
                      micState.deviceCount ?? 0
                    } audio input(s)`
              }
            >
              <Pill type={micType}>{micState.permission || "UNKNOWN"}</Pill>
            </Row>
            <Row
              icon="🗣"
              title="Speech recognition"
              subtitle={
                micState.speechSupported
                  ? "Web Speech API available"
                  : "Not available — the wake word cannot start in this browser"
              }
            >
              <Pill type={micState.speechSupported ? "green" : "gold"}>
                {micState.speechSupported ? "AVAILABLE" : "UNAVAILABLE"}
              </Pill>
            </Row>
            <Row
              icon="🔒"
              title="Secure context"
              subtitle={
                micState.secureContext === false
                  ? "Open the UI on localhost or HTTPS or the browser blocks the mic"
                  : "localhost/HTTPS requirement satisfied"
              }
            >
              <Pill type={micState.secureContext === false ? "red" : "green"}>
                {micState.secureContext === false ? "NOT SECURE" : "OK"}
              </Pill>
            </Row>
            <Row
              icon="⏱"
              title="Last checked"
              subtitle={micState.checkedAt || "Never checked in this session"}
            >
              <button className="gm-btn ghost" onClick={onRefreshMic}>
                ↻ Re-check
              </button>
            </Row>
          </div>
        </section>

        <section className="gm-card">
          <div className="gm-card-head">
            <div>
              <h2>System Doctor</h2>
              <p>SIMULATED — the browser has no filesystem or antivirus access.</p>
            </div>
            <Pill type={doctorType}>
              {doctorRunning ? "RUNNING" : doctorScan ? "SIMULATED" : "NOT RUN"}
            </Pill>
          </div>
          <div className="gm-list">
            <Row
              icon="🦠"
              title="Simulated threats"
              subtitle={`${doctorScan?.threats?.length ?? 0} simulated threat(s) · nothing was scanned`}
            >
              <Pill type="gold">SIMULATED</Pill>
            </Row>
            <Row
              icon="🗑"
              title="Simulated junk files"
              subtitle={`${doctorScan?.junkFiles?.length ?? 0} file(s) · nothing was deleted`}
            >
              <Pill type="gold">SIMULATED</Pill>
            </Row>
            <Row
              icon="⏱"
              title="Last scan"
              subtitle={
                doctorScan?.lastScan?.completedAt
                  ? `${doctorScan.lastScan.status} · ${new Date(
                      doctorScan.lastScan.completedAt,
                    ).toLocaleTimeString()}`
                  : "No scan has run in this session"
              }
            >
              <button
                className="gm-btn ghost"
                onClick={onRunDoctor}
                disabled={doctorRunning}
              >
                {doctorRunning ? "Scanning…" : "Run simulated scan"}
              </button>
            </Row>
          </div>
        </section>
      </div>

      <section className="gm-card" style={{ marginTop: 16 }}>
        <div className="gm-card-head">
          <div>
            <h2>Check summary</h2>
            <p>
              Build {buildInfo?.commitSha || "dev"} · {buildInfo?.buildTime || "unknown"}
            </p>
          </div>
        </div>
        <div className="gm-list">
          {checks.map(([name, value]) => (
            <Row key={name} icon="•" title={name} subtitle={String(value)}>
              <Pill
                type={
                  /online|green|verified|granted|clean/i.test(String(value))
                    ? "green"
                    : /off|fail|error|denied|not|unknown|run/i.test(String(value))
                      ? "gold"
                      : ""
                }
              >
                {value}
              </Pill>
            </Row>
          ))}
        </div>
        <p className="gm-muted gm-small" style={{ marginTop: 12 }}>
          Status shown here comes from real endpoints and browser APIs. The Doctor
          row is simulated, and a green backend row does not prove AI, MT5 or
          storage works.
        </p>
      </section>
    </>
  );
}
