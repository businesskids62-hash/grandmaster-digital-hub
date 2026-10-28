import crypto from "node:crypto";
import { JsonStore } from "../storage/jsonStore.js";

export const TASK_STATUSES = [
  "QUEUED",
  "PLANNING",
  "RUNNING",
  "VALIDATING",
  "AWAITING_APPROVAL",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "RETRY_PENDING",
];

export const ACTIVE_STATUSES = [
  "QUEUED",
  "PLANNING",
  "RUNNING",
  "VALIDATING",
  "AWAITING_APPROVAL",
  "RETRY_PENDING",
];

const TRANSITIONS = {
  QUEUED: ["PLANNING", "RUNNING", "CANCELLED", "FAILED"],
  PLANNING: ["RUNNING", "AWAITING_APPROVAL", "FAILED", "CANCELLED"],
  RUNNING: ["VALIDATING", "FAILED", "CANCELLED"],
  VALIDATING: ["COMPLETED", "FAILED"],
  AWAITING_APPROVAL: ["QUEUED", "CANCELLED"],
  RETRY_PENDING: ["PLANNING", "RUNNING", "CANCELLED", "FAILED"],
  FAILED: ["RETRY_PENDING", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

const MAX_TASKS = 500;
const MAX_HISTORY = 50;
const MAX_REQUEST_CHARS = 2000;

function nowISO() {
  return new Date().toISOString();
}

function cleanText(value, max) {
  return String(value || "")
    .replace(/\u0000/g, "")
    .trim()
    .slice(0, max);
}

export class TaskStore {
  constructor(env = process.env, store = new JsonStore("tasks", { env })) {
    this.store = store;
  }

  status() {
    return this.store.status();
  }

  list({ agentId, status, limit = 50 } = {}) {
    const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
    return this.store
      .items()
      .filter((task) => !agentId || task.agentId === agentId)
      .filter((task) => !status || task.status === status)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, safeLimit)
      .map((task) => ({ ...task }));
  }

  get(id) {
    const task = this.store.items().find((item) => item.id === id);
    return task ? { ...task } : null;
  }

  findActiveByIdempotency(key) {
    if (!key) return null;
    const task = this.store
      .items()
      .find(
        (item) =>
          item.idempotencyKey === key &&
          ACTIVE_STATUSES.includes(item.status),
      );
    return task ? { ...task } : null;
  }

  async create(input = {}) {
    const request = cleanText(input.request, MAX_REQUEST_CHARS);
    if (!request) {
      const error = new Error("request is required.");
      error.status = 400;
      error.code = "INVALID_REQUEST";
      throw error;
    }
    const agentId = cleanText(input.agentId, 60);
    if (!agentId) {
      const error = new Error("agentId is required.");
      error.status = 400;
      error.code = "INVALID_AGENT";
      throw error;
    }
    const status = TASK_STATUSES.includes(input.status) ? input.status : "QUEUED";
    const at = nowISO();
    const attemptCount = Number.isFinite(input.attempts) ? input.attempts : 0;
    const maxAttempts = Math.min(Math.max(Number(input.maxAttempts) || 2, 1), 5);
    const id = crypto.randomUUID();
    // Normalize the approval contract so every record carries the same fields,
    // whichever caller created it.
    const approval = input.approval
      ? {
          id: cleanText(input.approval.id, 80) || crypto.randomUUID(),
          taskId: id,
          agentId,
          required: true,
          status: cleanText(input.approval.status, 20) || "pending",
          action: cleanText(input.approval.action, 60) || "external_action",
          risk: cleanText(input.approval.risk, 20) || "high",
          requestedAt: cleanText(input.approval.requestedAt, 40) || at,
          decidedAt: input.approval.decidedAt || null,
          decision: cleanText(input.approval.decision, 20) || null,
          decidedBy: cleanText(input.approval.decidedBy, 80) || null,
          requestId: cleanText(input.approval.requestId, 80) || null,
          reason: cleanText(input.approval.reason, 240) || null,
        }
      : null;

    const task = {
      id,
      request,
      agentId,
      status,
      progress: status === "AWAITING_APPROVAL" ? 15 : 5,
      createdAt: at,
      updatedAt: at,
      attempts: attemptCount,
      maxAttempts,
      depth: Number(input.depth) || 0,
      parentTaskId: input.parentTaskId || null,
      idempotencyKey: cleanText(input.idempotencyKey, 120) || null,
      risk: cleanText(input.risk, 20) || "low",
      permissions: Array.isArray(input.permissions) ? input.permissions.map(String) : [],
      approval,
      result: null,
      error: null,
      history: [
        {
          at,
          event: "created",
          status,
          detail: input.approval?.required ? "Awaiting explicit approval." : null,
        },
      ],
    };

    await this.store.update((draft) => {
      draft.items.unshift(task);
      if (draft.items.length > MAX_TASKS) draft.items.length = MAX_TASKS;
    });
    return { ...task };
  }

  async transition(id, nextStatus, detail = null) {
    if (!TASK_STATUSES.includes(nextStatus)) {
      const error = new Error(`Unknown task status: ${nextStatus}`);
      error.status = 400;
      error.code = "INVALID_STATUS";
      throw error;
    }
    let updated = null;
    await this.store.update((draft) => {
      const task = draft.items.find((item) => item.id === id);
      if (!task) {
        const error = new Error("Task not found.");
        error.status = 404;
        error.code = "TASK_NOT_FOUND";
        throw error;
      }
      const allowed = TRANSITIONS[task.status] || [];
      if (!allowed.includes(nextStatus)) {
        const error = new Error(
          `Task cannot move from ${task.status} to ${nextStatus}.`,
        );
        error.status = 409;
        error.code = "INVALID_TRANSITION";
        throw error;
      }
      const at = nowISO();
      task.status = nextStatus;
      task.updatedAt = at;
      task.progress =
        nextStatus === "COMPLETED"
          ? 100
          : nextStatus === "FAILED" || nextStatus === "CANCELLED"
            ? task.progress
            : Math.min(95, (task.progress || 0) + 20);
      task.history = [
        ...(task.history || []),
        { at, event: "transition", status: nextStatus, detail },
      ].slice(-MAX_HISTORY);
      updated = { ...task };
    });
    return updated;
  }

  async patch(id, patch = {}, detail = null) {
    let updated = null;
    await this.store.update((draft) => {
      const task = draft.items.find((item) => item.id === id);
      if (!task) {
        const error = new Error("Task not found.");
        error.status = 404;
        error.code = "TASK_NOT_FOUND";
        throw error;
      }
      const allowed = [
        "progress",
        "result",
        "error",
        "approval",
        "attempts",
        "risk",
        "permissions",
      ];
      for (const key of allowed) {
        if (Object.prototype.hasOwnProperty.call(patch, key)) {
          task[key] = patch[key];
        }
      }
      const at = nowISO();
      task.updatedAt = at;
      task.history = [
        ...(task.history || []),
        { at, event: "update", status: task.status, detail },
      ].slice(-MAX_HISTORY);
      updated = { ...task };
    });
    return updated;
  }

  async recordAttempt(id, detail = null) {
    let updated = null;
    await this.store.update((draft) => {
      const task = draft.items.find((item) => item.id === id);
      if (!task) {
        const error = new Error("Task not found.");
        error.status = 404;
        error.code = "TASK_NOT_FOUND";
        throw error;
      }
      if (task.attempts >= task.maxAttempts) {
        const error = new Error("Retry limit reached.");
        error.status = 409;
        error.code = "RETRY_LIMIT_REACHED";
        throw error;
      }
      task.attempts += 1;
      task.updatedAt = nowISO();
      task.history = [
        ...(task.history || []),
        {
          at: task.updatedAt,
          event: "attempt",
          status: task.status,
          detail: detail || `Attempt ${task.attempts}/${task.maxAttempts}`,
        },
      ].slice(-MAX_HISTORY);
      updated = { ...task };
    });
    return updated;
  }

  stats() {
    const items = this.store.items();
    const byStatus = Object.fromEntries(TASK_STATUSES.map((status) => [status, 0]));
    const byAgent = {};
    for (const task of items) {
      if (byStatus[task.status] !== undefined) byStatus[task.status] += 1;
      byAgent[task.agentId] = (byAgent[task.agentId] || 0) + 1;
    }
    return {
      total: items.length,
      byStatus,
      byAgent,
      completed: byStatus.COMPLETED,
      failed: byStatus.FAILED,
      awaitingApproval: byStatus.AWAITING_APPROVAL,
    };
  }
}

export const taskStore = new TaskStore(process.env);
