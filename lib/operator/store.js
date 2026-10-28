import crypto from "node:crypto";

const MAX_RUNS = 200;

function intEnv(env, key, fallback) {
  const parsed = Number(env?.[key]);
  return Number.isFinite(parsed) ? Math.round(parsed) : fallback;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function operatorLimits(env = process.env) {
  return {
    maxSessions: clamp(intEnv(env, "GRANDMASTER_OPERATOR_MAX_SESSIONS", 3), 1, 10),
    idleTtlMs: clamp(intEnv(env, "GRANDMASTER_OPERATOR_IDLE_TTL_MINUTES", 30), 1, 240) * 60_000,
    maxRunsPerOwner: clamp(intEnv(env, "GRANDMASTER_OPERATOR_MAX_RUNS", 50), 1, MAX_RUNS),
    approvalTtlMs: clamp(intEnv(env, "GRANDMASTER_OPERATOR_APPROVAL_TTL_MINUTES", 10), 1, 120) * 60_000,
  };
}

/**
 * Process-memory only. Sessions, runs, typed values and snapshots are never
 * written to disk so a restart cannot leave browser state behind.
 */
export class OperatorStore {
  constructor() {
    this.sessions = new Map();
    this.runs = new Map();
  }

  purge(env = process.env) {
    const now = Date.now();
    const limits = operatorLimits(env);
    for (const [id, session] of this.sessions) {
      if (now - new Date(session.lastUsedAt).getTime() > limits.idleTtlMs) {
        Promise.resolve()
          .then(() => session.driver?.close?.())
          .catch(() => {});
        this.sessions.delete(id);
      }
    }
    for (const [id, run] of this.runs) {
      if (now - new Date(run.createdAt).getTime() > 12 * 60 * 60_000) {
        this.runs.delete(id);
      }
    }
    while (this.runs.size > MAX_RUNS) {
      const oldest = this.runs.keys().next().value;
      if (!oldest) break;
      this.runs.delete(oldest);
    }
  }

  createSession({ ownerId, driver }) {
    const at = new Date().toISOString();
    const session = {
      id: crypto.randomUUID(),
      ownerId,
      driver,
      status: "active",
      createdAt: at,
      lastUsedAt: at,
    };
    this.sessions.set(session.id, session);
    return session;
  }

  getSession(id) {
    return this.sessions.get(id) || null;
  }

  sessionsForOwner(ownerId) {
    return [...this.sessions.values()].filter((session) => session.ownerId === ownerId);
  }

  touchSession(id) {
    const session = this.sessions.get(id);
    if (session) session.lastUsedAt = new Date().toISOString();
    return session || null;
  }

  deleteSession(id) {
    return this.sessions.delete(id);
  }

  createRun({ ownerId, sessionId, plan, planHash }) {
    const at = new Date().toISOString();
    const run = {
      id: crypto.randomUUID(),
      ownerId,
      sessionId,
      plan,
      planHash,
      status: "AWAITING_APPROVAL",
      approval: {
        status: "pending",
        approvedAt: null,
        expiresAt: null,
        usedAt: null,
      },
      steps: [],
      result: null,
      error: null,
      lastHost: null,
      createdAt: at,
      updatedAt: at,
    };
    this.runs.set(run.id, run);
    return run;
  }

  getRun(id) {
    return this.runs.get(id) || null;
  }

  runsForOwner(ownerId) {
    return [...this.runs.values()].filter((run) => run.ownerId === ownerId);
  }

  touchRun(id, changes = {}) {
    const run = this.runs.get(id);
    if (!run) return null;
    Object.assign(run, changes, { updatedAt: new Date().toISOString() });
    return run;
  }

  async reset() {
    await Promise.allSettled(
      [...this.sessions.values()].map((session) => session.driver?.close?.()),
    );
    this.sessions.clear();
    this.runs.clear();
  }
}

export const operatorStore = new OperatorStore();
