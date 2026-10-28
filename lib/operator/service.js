import { auditStore } from "../security/auditStore.js";
import { parseOperatorUsers } from "./auth.js";
import {
  MUTATING_TOOLS,
  hashPlan,
  loopbackAllowed,
  parseAllowedHosts,
  validateApproval,
  validateNavigationUrl,
  validatePlan,
} from "./policy.js";
import { createBrowserDriver, resolveBrowserChannel } from "./driver.js";
import { getConnectorVerification } from "./verification.js";
import { operatorLimits, operatorStore } from "./store.js";
import { operatorError, sanitizeOperatorMessage } from "./errors.js";

const BLOCKING_CODES = new Set([
  "OPERATOR_CAPTCHA_DETECTED",
  "OPERATOR_LOGIN_WALL",
  "OPERATOR_SENSITIVE_INPUT_BLOCKED",
  "OPERATOR_ACTION_PROHIBITED",
  "OPERATOR_REDIRECT_BLOCKED",
  "OPERATOR_STALE_TARGET",
  "OPERATOR_URL_HOST_NOT_ALLOWED",
  "OPERATOR_URL_HTTPS_REQUIRED",
  "OPERATOR_URL_SCHEME_BLOCKED",
  "OPERATOR_URL_CREDENTIALS_BLOCKED",
  "OPERATOR_URL_IP_BLOCKED",
  "OPERATOR_URL_PORT_BLOCKED",
  "OPERATOR_URL_LOOPBACK_BLOCKED",
  "OPERATOR_FINANCIAL_ACTION_BLOCKED",
]);

const BLOCK_MESSAGES = {
  OPERATOR_CAPTCHA_DETECTED:
    "A CAPTCHA was detected. Automation stopped without attempting to solve it.",
  OPERATOR_LOGIN_WALL:
    "A login wall was detected. Automation stopped; credentials are never entered.",
  OPERATOR_SENSITIVE_INPUT_BLOCKED: "A password, file or secret input was blocked by policy.",
  OPERATOR_ACTION_PROHIBITED: "The action is blocked by policy.",
  OPERATOR_REDIRECT_BLOCKED: "Navigation left the approved host list and was stopped.",
  OPERATOR_STALE_TARGET: "The target element is stale. Take a new snapshot.",
  OPERATOR_FINANCIAL_ACTION_BLOCKED: "Financial actions are LOCKED by policy.",
};

function audit(event) {
  return auditStore.append(event).catch(() => {});
}

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function isOperatorServerless(env = process.env) {
  return Boolean(env?.VERCEL) || Boolean(env?.AWS_LAMBDA_FUNCTION_NAME);
}

export function assertOperatorLocal(env = process.env) {
  if (isOperatorServerless(env)) {
    throw operatorError(
      503,
      "OPERATOR_SERVERLESS_UNSUPPORTED",
      "The browser operator is local-only. Serverless hosting cannot run a browser session.",
    );
  }
}

export function getOperatorSummary(env = process.env) {
  const auth = parseOperatorUsers(env);
  const hosts = parseAllowedHosts(env);
  const verification = getConnectorVerification(env);
  let browserChannel = "invalid";
  try {
    browserChannel = resolveBrowserChannel(env);
  } catch {
    // Reported as invalid without throwing from status/registry reads.
  }
  return {
    serverless: isOperatorServerless(env),
    authConfigured: auth.configured,
    policyConfigured: hosts.configured,
    configured: auth.configured && hosts.configured,
    allowedHostCount: hosts.hosts.length,
    loopbackAllowed: loopbackAllowed(env),
    browserChannel,
    realConnectorVerified: Boolean(verification),
    lastVerifiedAt: verification?.verifiedAt || null,
    verifiedBrowser: verification?.browser || null,
    verifiedBrowserVersion: verification?.browserVersion || null,
  };
}

export function getOperatorStatus(env = process.env, ownerId) {
  operatorStore.purge(env);
  const limits = operatorLimits(env);
  const summary = getOperatorSummary(env);
  const connectorReady =
    summary.configured && summary.realConnectorVerified && !summary.serverless;
  return {
    ...summary,
    integrationStatus: connectorReady ? "connected" : "not_connected",
    limits: {
      maxSessions: limits.maxSessions,
      idleTtlMinutes: Math.round(limits.idleTtlMs / 60_000),
      approvalTtlMinutes: Math.round(limits.approvalTtlMs / 60_000),
      maxRunsPerOwner: limits.maxRunsPerOwner,
    },
    sessions: ownerId ? operatorStore.sessionsForOwner(ownerId).length : 0,
    runs: ownerId ? operatorStore.runsForOwner(ownerId).length : 0,
  };
}

export function publicSession(session) {
  return {
    id: session.id,
    ownerId: session.ownerId,
    status: session.status,
    createdAt: session.createdAt,
    lastUsedAt: session.lastUsedAt,
  };
}

function actionView(action) {
  if (action.tool === "navigate") return { tool: action.tool, host: hostOf(action.url) };
  if (action.tool === "wait") return { tool: action.tool, ms: action.ms };
  if (action.value !== undefined) {
    return { tool: action.tool, ref: action.ref, value: "[redacted]" };
  }
  return { tool: action.tool, ref: action.ref };
}

export function publicRun(run) {
  return {
    id: run.id,
    ownerId: run.ownerId,
    sessionId: run.sessionId,
    status: run.status,
    planHash: run.planHash,
    approval: { ...run.approval },
    actions: run.plan.actions.map(actionView),
    steps: run.steps.map((step) => ({ tool: step.tool, changeObserved: step.changeObserved })),
    result: run.result ? { ...run.result } : null,
    error: run.error ? { ...run.error } : null,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  };
}

function requireOwnerSession(ownerId, sessionId, env) {
  operatorStore.purge(env);
  const session = operatorStore.getSession(String(sessionId || ""));
  if (!session || session.ownerId !== ownerId || session.status !== "active") {
    throw operatorError(404, "OPERATOR_SESSION_NOT_FOUND", "Operator session not found.");
  }
  return session;
}

function requireOwnerRun(ownerId, runId, env) {
  operatorStore.purge(env);
  const run = operatorStore.getRun(String(runId || ""));
  if (!run || run.ownerId !== ownerId) {
    throw operatorError(404, "OPERATOR_RUN_NOT_FOUND", "Operator run not found.");
  }
  return run;
}

export async function createOperatorSession({ env = process.env, ownerId, driverFactory, requestId } = {}) {
  assertOperatorLocal(env);
  if (!parseAllowedHosts(env).configured) {
    throw operatorError(
      503,
      "OPERATOR_POLICY_NOT_CONFIGURED",
      "GRANDMASTER_OPERATOR_ALLOWED_HOSTS is not configured.",
    );
  }
  operatorStore.purge(env);
  const limits = operatorLimits(env);
  if (operatorStore.sessionsForOwner(ownerId).length >= limits.maxSessions) {
    throw operatorError(
      429,
      "OPERATOR_SESSION_LIMIT",
      `At most ${limits.maxSessions} operator sessions may be open per owner.`,
    );
  }

  let driver;
  try {
    driver = await (driverFactory || createBrowserDriver)({ env });
  } catch (error) {
    throw operatorError(
      error?.status || 503,
      error?.code || "OPERATOR_BROWSER_UNAVAILABLE",
      sanitizeOperatorMessage(error?.message, "The browser could not be started."),
    );
  }

  const session = operatorStore.createSession({ ownerId, driver });
  await audit({
    action: "operator.session.created",
    actor: ownerId,
    requestId,
    status: "active",
    outcome: "created",
    meta: { sessionId: session.id },
  });
  return publicSession(session);
}

export function getOperatorSession(ownerId, sessionId, env = process.env) {
  return publicSession(requireOwnerSession(ownerId, sessionId, env));
}

export async function getOperatorSnapshot({ env = process.env, ownerId, sessionId, requestId } = {}) {
  assertOperatorLocal(env);
  const session = requireOwnerSession(ownerId, sessionId, env);
  operatorStore.touchSession(session.id);

  let snapshot;
  try {
    snapshot = await session.driver.snapshot();
  } catch (error) {
    throw operatorError(
      error?.status || 502,
      error?.code || "OPERATOR_DRIVER_FAILED",
      sanitizeOperatorMessage(error?.message, "The snapshot could not be read."),
    );
  }

  const base = {
    sessionId: session.id,
    ownerId,
    at: new Date().toISOString(),
    blocked: Boolean(snapshot?.blocked),
    reason: snapshot?.blocked || null,
    host: snapshot?.host || null,
    title: snapshot?.blocked ? "" : snapshot?.title || "",
  };

  if (snapshot?.blocked) {
    await audit({
      action: "operator.snapshot.blocked",
      actor: ownerId,
      requestId,
      status: "BLOCKED",
      outcome: "blocked",
      errorCategory: snapshot.blocked,
      meta: { sessionId: session.id, host: base.host },
    });
    return { ...base, elements: [] };
  }

  return {
    ...base,
    elements: (snapshot?.elements || []).map((element) => ({
      ref: String(element.ref),
      tag: String(element.tag),
      type: element.type || null,
      name: String(element.name || ""),
      sensitive: Boolean(element.sensitive),
      disabled: Boolean(element.disabled),
    })),
  };
}

export async function closeOperatorSession({ env = process.env, ownerId, sessionId, requestId } = {}) {
  assertOperatorLocal(env);
  const session = requireOwnerSession(ownerId, sessionId, env);
  session.status = "closing";
  try {
    await session.driver?.close?.();
  } catch {
    // The browser may already be gone; the session is removed either way.
  }
  operatorStore.deleteSession(session.id);
  await audit({
    action: "operator.session.closed",
    actor: ownerId,
    requestId,
    status: "closed",
    outcome: "closed",
    meta: { sessionId: session.id },
  });
  return { id: session.id, status: "closed" };
}

export async function createOperatorRun({ env = process.env, ownerId, sessionId, plan, requestId } = {}) {
  assertOperatorLocal(env);
  const session = requireOwnerSession(ownerId, sessionId, env);
  const validated = validatePlan(plan, env);
  if (!validated.ok) {
    throw operatorError(validated.status, validated.code, validated.message);
  }

  const limits = operatorLimits(env);
  if (operatorStore.runsForOwner(ownerId).length >= limits.maxRunsPerOwner) {
    throw operatorError(429, "OPERATOR_RUN_LIMIT", "Too many stored operator runs for this owner.");
  }

  const run = operatorStore.createRun({
    ownerId,
    sessionId: session.id,
    plan: validated.plan,
    planHash: validated.hash,
  });
  const navigate = validated.plan.actions.find((action) => action.tool === "navigate");
  await audit({
    action: "operator.run.created",
    actor: ownerId,
    requestId,
    status: run.status,
    outcome: "awaiting_approval",
    meta: {
      runId: run.id,
      sessionId: session.id,
      tools: validated.plan.actions.map((action) => action.tool),
      host: navigate ? hostOf(navigate.url) : null,
    },
  });
  return publicRun(run);
}

export function getOperatorRun(ownerId, runId, env = process.env) {
  return publicRun(requireOwnerRun(ownerId, runId, env));
}

export async function approveOperatorRun({
  env = process.env,
  ownerId,
  runId,
  planHash,
  confirmation,
  requestId,
} = {}) {
  assertOperatorLocal(env);
  const run = requireOwnerRun(ownerId, runId, env);

  if (run.status !== "AWAITING_APPROVAL" || run.approval.status !== "pending") {
    throw operatorError(409, "OPERATOR_APPROVAL_REPLAY", "This plan has already been decided.");
  }
  const check = validateApproval({ providedHash: planHash, confirmation, planHash: run.planHash });
  if (!check.ok) throw operatorError(check.status, check.code, check.message);
  if (hashPlan(run.plan) !== run.planHash) {
    throw operatorError(409, "OPERATOR_PLAN_CHANGED", "The frozen plan no longer matches its hash.");
  }

  const limits = operatorLimits(env);
  const approvedAt = new Date();
  run.approval = {
    status: "approved",
    approvedAt: approvedAt.toISOString(),
    expiresAt: new Date(approvedAt.getTime() + limits.approvalTtlMs).toISOString(),
    usedAt: null,
  };
  run.status = "APPROVED";
  run.updatedAt = approvedAt.toISOString();

  await audit({
    action: "operator.run.approved",
    actor: ownerId,
    requestId,
    status: "APPROVED",
    outcome: "approved",
    approvalStatus: "approved",
    meta: {
      runId: run.id,
      sessionId: run.sessionId,
      tools: run.plan.actions.map((action) => action.tool),
      host: run.plan.actions.map((action) => action.url).filter(Boolean).map(hostOf)[0] || null,
    },
  });
  return publicRun(run);
}

export async function executeOperatorRun({ env = process.env, ownerId, runId, requestId } = {}) {
  assertOperatorLocal(env);
  const run = requireOwnerRun(ownerId, runId, env);

  if (run.approval.status === "used") {
    throw operatorError(409, "OPERATOR_APPROVAL_REPLAY", "This approval has already been used.");
  }
  if (run.status === "COMPLETED" || run.status === "FAILED" || run.status === "BLOCKED") {
    throw operatorError(409, "OPERATOR_RUN_FINALIZED", "This run is already final.");
  }
  if (run.approval.status !== "approved") {
    throw operatorError(403, "OPERATOR_APPROVAL_REQUIRED", "A separate approval is required before execution.");
  }
  if (!run.approval.expiresAt || Date.now() >= new Date(run.approval.expiresAt).getTime()) {
    run.approval.status = "expired";
    run.status = "AWAITING_APPROVAL";
    run.updatedAt = new Date().toISOString();
    throw operatorError(410, "OPERATOR_APPROVAL_EXPIRED", "The approval expired. Request a new approval.");
  }
  if (hashPlan(run.plan) !== run.planHash) {
    throw operatorError(409, "OPERATOR_PLAN_CHANGED", "The frozen plan no longer matches its hash.");
  }
  const revalidated = validatePlan(run.plan, env);
  if (!revalidated.ok) {
    throw operatorError(revalidated.status, revalidated.code, revalidated.message);
  }
  if (revalidated.hash !== run.planHash) {
    throw operatorError(409, "OPERATOR_PLAN_CHANGED", "The frozen plan no longer matches its hash.");
  }

  const session = requireOwnerSession(ownerId, run.sessionId, env);

  run.approval.status = "used";
  run.approval.usedAt = new Date().toISOString();
  run.status = "RUNNING";
  run.updatedAt = run.approval.usedAt;
  operatorStore.touchSession(session.id);

  const startedAt = Date.now();
  const steps = [];
  let changeObserved = false;
  let finalHost = run.lastHost || null;

  try {
    for (const action of run.plan.actions) {
      if (action.tool === "navigate") {
        // Revalidate immediately before each navigation.
        const navigation = validateNavigationUrl(action.url, env);
        if (!navigation.ok) {
          throw operatorError(navigation.status, navigation.code, navigation.message);
        }
      }
      const outcome = await session.driver.perform(action);
      if (outcome?.blocked) {
        run.status = "BLOCKED";
        run.error = {
          code: outcome.blocked,
          message: BLOCK_MESSAGES[outcome.blocked] || "Automation was blocked by policy.",
        };
        break;
      }
      if (outcome?.host) finalHost = outcome.host;
      if (outcome?.changeObserved) changeObserved = true;
      steps.push({ tool: action.tool, changeObserved: Boolean(outcome?.changeObserved) });
    }

    if (run.status !== "BLOCKED") {
      const mutating = run.plan.actions.some((action) => MUTATING_TOOLS.has(action.tool));
      if (mutating && !changeObserved) {
        run.status = "FAILED";
        run.error = {
          code: "OPERATOR_NO_CHANGE_OBSERVED",
          message: "No page state change was observed; success is not claimed.",
        };
      } else {
        run.status = "COMPLETED";
        run.result = { changeObserved, stepCount: steps.length, host: finalHost };
      }
    }
  } catch (error) {
    const code = error?.code || "OPERATOR_DRIVER_FAILED";
    run.status = BLOCKING_CODES.has(code) ? "BLOCKED" : "FAILED";
    run.error = {
      code,
      message:
        BLOCK_MESSAGES[code] || sanitizeOperatorMessage(error?.message, "The browser run failed."),
    };
    if (code === "OPERATOR_BROWSER_DISCONNECTED") {
      try {
        await session.driver?.close?.();
      } catch {
        // Already closed.
      }
      operatorStore.deleteSession(session.id);
    }
  }

  run.steps = steps;
  run.lastHost = finalHost;
  run.updatedAt = new Date().toISOString();

  await audit({
    action: "operator.run.executed",
    actor: ownerId,
    requestId,
    status: run.status,
    outcome: run.status.toLowerCase(),
    durationMs: Date.now() - startedAt,
    errorCategory: run.error?.code || null,
    meta: {
      runId: run.id,
      sessionId: run.sessionId,
      tools: run.plan.actions.map((action) => action.tool),
      host: finalHost,
      changeObserved,
    },
  });
  return publicRun(run);
}

export async function resetOperatorState() {
  await operatorStore.reset();
}
