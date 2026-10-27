const SILENT = String(process.env.GRANDMASTER_LOG_SILENT || "") === "1";

export function logEvent(event = {}) {
  if (SILENT) return;
  const payload = {
    ts: new Date().toISOString(),
    level: event.level || "info",
    event: event.event || "event",
    requestId: event.requestId || null,
    taskId: event.taskId || null,
    agentId: event.agentId || null,
    status: event.status || null,
    durationMs: Number.isFinite(event.durationMs) ? event.durationMs : null,
    errorCategory: event.errorCategory || null,
    retryCount: Number.isFinite(event.retryCount) ? event.retryCount : null,
    approvalStatus: event.approvalStatus || null,
    providerStatus: event.providerStatus || null,
  };
  try {
    console.log(JSON.stringify(payload));
  } catch {
    // Logging must never break a request.
  }
}
