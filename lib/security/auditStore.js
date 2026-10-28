import crypto from "node:crypto";
import { JsonStore } from "../storage/jsonStore.js";

const MAX_AUDIT_EVENTS = 1000;
const SENSITIVE_KEY = /(token|secret|password|api[_-]?key|authorization|cookie)/i;
const SECRET_VALUE = /(AIza[0-9A-Za-z_-]{20,}|sk-[A-Za-z0-9]{16,}|bearer\s+[A-Za-z0-9._-]{16,})/i;

function safeValue(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" || typeof value === "boolean") return value;
  const text = String(value);
  if (SECRET_VALUE.test(text)) return "[redacted]";
  return text.slice(0, 200);
}

function safeMeta(meta) {
  if (!meta || typeof meta !== "object") return null;
  const output = {};
  for (const [key, value] of Object.entries(meta)) {
    if (SENSITIVE_KEY.test(key)) continue;
    if (Array.isArray(value)) {
      output[key] = value.slice(0, 10).map(safeValue);
    } else if (value && typeof value === "object") {
      output[key] = "[object]";
    } else {
      output[key] = safeValue(value);
    }
  }
  return output;
}

export class AuditStore {
  constructor(env = process.env, store = new JsonStore("audit", { env })) {
    this.store = store;
  }

  status() {
    return this.store.status();
  }

  async append(event = {}) {
    const at = new Date().toISOString();
    const meta = safeMeta(event.meta);
    const entry = {
      id: crypto.randomUUID(),
      at,
      requestId: event.requestId
        ? String(event.requestId).slice(0, 80)
        : meta?.requestId
          ? String(meta.requestId).slice(0, 80)
          : null,
      action: String(event.action || "unknown").slice(0, 80),
      actor: String(event.actor || "system").slice(0, 80),
      taskId: event.taskId ? String(event.taskId).slice(0, 80) : null,
      agentId: event.agentId ? String(event.agentId).slice(0, 80) : null,
      status: event.status ? String(event.status).slice(0, 40) : null,
      outcome: String(event.outcome || "recorded").slice(0, 40),
      durationMs: Number.isFinite(event.durationMs) ? event.durationMs : null,
      errorCategory: event.errorCategory
        ? String(event.errorCategory).slice(0, 60)
        : null,
      approvalStatus: event.approvalStatus
        ? String(event.approvalStatus).slice(0, 40)
        : null,
      meta,
    };
    await this.store.update((draft) => {
      draft.items.unshift(entry);
      if (draft.items.length > MAX_AUDIT_EVENTS) draft.items.length = MAX_AUDIT_EVENTS;
    });
    return { ...entry };
  }

  list(limit = 100) {
    const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
    return this.store.items().slice(0, safeLimit).map((item) => ({ ...item }));
  }

  stats() {
    const items = this.store.items();
    return {
      total: items.length,
      lastEventAt: items[0]?.at || null,
    };
  }
}

export const auditStore = new AuditStore(process.env);
