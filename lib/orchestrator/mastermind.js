import crypto from "node:crypto";
import { getAgent, getRuntimeAgent, GATES } from "../agents/registry.js";
import { resolveExecutor } from "../agents/executors.js";
import { taskStore } from "../tasks/taskStore.js";
import { auditStore } from "../security/auditStore.js";
import { getVerificationSnapshot } from "../aiProviders.js";
import { logEvent } from "../logger.js";

const MAX_REQUEST_CHARS = 2000;
const MAX_RESULT_SUMMARY = 8000;
const EXECUTION_TIMEOUT_MS = 22_000;
const MAX_DEPTH = 1;
const FINANCIAL_DOMAIN = new Set(["trading_monitor", "binance_research", "finance"]);
const EXTERNAL_DOMAIN = new Set([
  "social_media",
  "youtube_creator",
  "whatsapp_assistant",
  "fiverr_business",
  "website_app_builder",
]);

const RULES = [
  { agentId: "memory", pattern: /^(remember|yaad rakho|yaad rakhna)\b|\b(save (this|it) to memory|my memory|from memory)\b/i },
  { agentId: "security", pattern: /\b(security|vulnerab|permission|audit|secret|cors|auth(entication|orization)?|csrf|xss)\b/i },
  { agentId: "trading_monitor", pattern: /\b(mt5|metatrader|forex|gold|xauusd|trading|trade plan|position)\b/i },
  { agentId: "binance_research", pattern: /\b(binance|crypto|bitcoin|btc|ethereum|eth|altcoin|coin)\b/i },
  { agentId: "finance", pattern: /\b(budget|expense|saving|finance|income|kharcha|paisa|money plan)\b/i },
  { agentId: "social_media", pattern: /\b(instagram|facebook|tiktok|social media|linkedin)\b/i },
  { agentId: "youtube_creator", pattern: /\b(youtube|thumbnail|channel|shorts|video idea|video script)\b/i },
  { agentId: "whatsapp_assistant", pattern: /\b(whatsapp|customer message|customer support)\b/i },
  { agentId: "fiverr_business", pattern: /\b(fiverr|freelance gig|gig)\b/i },
  { agentId: "website_app_builder", pattern: /\b(website|landing page|web app|mobile app|deploy|architecture)\b/i },
  { agentId: "coding", pattern: /\b(code|coding|react|javascript|typescript|python|node|bug|debug|api|refactor|implement|function|sql|test)\b/i },
  { agentId: "education", pattern: /\b(kids?|children|lesson|teach|learning|course|academy|school|student)\b/i },
  { agentId: "content", pattern: /\b(content|blog|article|copywriting|write|draft|caption|script)\b/i },
  { agentId: "business", pattern: /\b(business|startup|client|offer|pricing|marketing|sales|strategy)\b/i },
  { agentId: "task_tracker", pattern: /\b(task|project|milestone|challenge|reminder|checklist|progress)\b/i },
  { agentId: "analytics", pattern: /\b(analytics|report|metrics|stats|kpi|dashboard)\b/i },
  { agentId: "research", pattern: /\b(research|source|fact|evidence|compare|analysis|explain|what is|how does)\b/i },
];

const FINANCIAL_EXECUTION =
  /\b(buy|sell|place (an? )?order|execute (a )?trade|open (a )?(long|short) position|withdraw|transfer (funds|money)|send money|pay (the )?bill|deposit)\b/i;
const EXTERNAL_ACTION =
  /\b(publish|upload|send (a )?message|send (an )?email|deploy|go live|tweet|post (this|it|now)|message (the )?customer|email (the )?customer)\b/i;

function fail(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function cleanRequest(value) {
  const text = String(value || "")
    .replace(/\u0000/g, "")
    .trim();
  if (!text) throw fail(400, "REQUEST_REQUIRED", "request is required.");
  if (text.length > MAX_REQUEST_CHARS) {
    throw fail(400, "REQUEST_TOO_LONG", `request must be at most ${MAX_REQUEST_CHARS} characters.`);
  }
  return text;
}

function sanitize(value, max = 240) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/(AIza[0-9A-Za-z_-]{20,}|sk-[A-Za-z0-9]{16,})/g, "[redacted]")
    .trim()
    .slice(0, max);
}

function classifyAgent(request) {
  for (const rule of RULES) {
    if (rule.pattern.test(request)) return rule.agentId;
  }
  return "research";
}

function evaluatePolicy(request, agent) {
  const financialExecution = FINANCIAL_EXECUTION.test(request);
  const locked =
    financialExecution &&
    (FINANCIAL_DOMAIN.has(agent.id) || /\b(withdraw|transfer|send money|place order|execute trade)\b/i.test(request));
  const externalAction = EXTERNAL_ACTION.test(request);
  const approvalRequired =
    !locked &&
    externalAction &&
    (EXTERNAL_DOMAIN.has(agent.id) || agent.permissions?.externalActions === true);
  return { locked, approvalRequired, financialExecution, externalAction };
}

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(fail(504, "TASK_TIMEOUT", `Task execution timed out after ${ms}ms.`));
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function validateResult(result) {
  if (!result || typeof result !== "object" || typeof result.ok !== "boolean") {
    return { valid: false, reason: "Executor returned an invalid result contract." };
  }
  if (result.ok && (typeof result.summary !== "string" || !result.summary.trim())) {
    return { valid: false, reason: "Executor returned ok without a non-empty summary." };
  }
  if (!result.ok && (!result.error || !result.error.message)) {
    return { valid: false, reason: "Executor failure did not include an error message." };
  }
  return { valid: true, reason: "" };
}

async function record(action, task, outcome, meta = {}) {
  try {
    await auditStore.append({
      action,
      actor: "mastermind",
      taskId: task?.id || null,
      agentId: task?.agentId || null,
      outcome,
      meta,
    });
  } catch {
    // Audit failures must not crash task handling.
  }
}

export function buildPlan(request, env = process.env) {
  const text = cleanRequest(request);
  const agentId = classifyAgent(text);
  const agent = getAgent(agentId) || getAgent("research");
  const policy = evaluatePolicy(text, agent);
  const storageAvailable = taskStore.status().writable;
  const runtime = getRuntimeAgent(agent.id, env, {
    storageAvailable,
    providerVerified: getVerificationSnapshot()?.status === "verified",
  });
  const labels = [];
  if (policy.financialExecution) labels.push("financial-execution");
  if (policy.externalAction) labels.push("external-action");
  if (agent.risk === "high") labels.push("high-risk");

  const gate = policy.locked
    ? "LOCKED"
    : policy.approvalRequired
      ? "APPROVAL REQUIRED"
      : runtime?.gate || GATES.NOT_CONNECTED;

  const steps = [
    {
      id: "classify",
      label: `Classify request and select ${agent.name}`,
      status: "complete",
    },
    {
      id: "policy",
      label: policy.locked
        ? "Blocked by policy: financial execution is LOCKED."
        : policy.approvalRequired
          ? "Request control authorization before any external action."
          : "Confirm permissions and required configuration.",
      status: "complete",
    },
    {
      id: "execute",
      label: policy.locked
        ? "Execution not permitted."
        : `Run ${agent.name}${agent.executor ? "" : " (no executor connected)"}.`,
      status: policy.locked ? "blocked" : "pending",
    },
    {
      id: "validate",
      label: "Validate result, record audit evidence and report honestly.",
      status: "pending",
    },
  ];

  return {
    request: text,
    agentId: agent.id,
    agentName: agent.name,
    agentStatus: runtime?.status || agent.implementation,
    confidence: RULES.find((rule) => rule.pattern.test(text)) ? 0.8 : 0.4,
    labels,
    risk: agent.risk,
    gate,
    locked: policy.locked,
    approvalRequired: policy.approvalRequired,
    reason: policy.locked
      ? "Real trading, money transfers and financial transactions are LOCKED by policy."
      : policy.approvalRequired
        ? "This request would perform a consequential external action."
        : runtime?.statusReason || "",
    capabilities: agent.capabilities,
    permissions: agent.permissions,
    missingConfiguration: runtime?.missingConfiguration || [],
    steps,
  };
}

function derivedIdempotencyKey(agentId, request) {
  return crypto
    .createHash("sha256")
    .update(`${agentId}:${request.replace(/\s+/g, " ").trim().toLowerCase()}`)
    .digest("hex")
    .slice(0, 32);
}

export async function submitTask({
  request,
  agentId,
  idempotencyKey,
  env = process.env,
  fetchImpl,
  parentTaskId = null,
  depth = 0,
  requestId = null,
} = {}) {
  const text = cleanRequest(request);
  if (Number(depth) > MAX_DEPTH) {
    throw fail(400, "RECURSION_LIMIT", "Nested task depth exceeds the allowed limit.");
  }

  const agent = agentId ? getAgent(String(agentId)) : getAgent(classifyAgent(text));
  if (!agent) throw fail(404, "UNKNOWN_AGENT", `Unknown agent: ${agentId}`);

  const policy = evaluatePolicy(text, agent);
  const plan = buildPlan(text, env);
  plan.agentId = agent.id;
  plan.agentName = agent.name;

  if (policy.locked) {
    await record("task.blocked", { id: null, agentId: agent.id }, "locked", {
      risk: agent.risk,
      reason: "financial-execution",
    });
    logEvent({
      event: "task_blocked",
      requestId,
      agentId: agent.id,
      status: "LOCKED",
      errorCategory: "policy_locked",
    });
    return { locked: true, plan, agentId: agent.id, task: null };
  }

  const storageAvailable = taskStore.status().writable;
  const runtime = getRuntimeAgent(agent.id, env, {
    storageAvailable,
    providerVerified: getVerificationSnapshot()?.status === "verified",
  });
  const key =
    String(idempotencyKey || "").trim().slice(0, 120) ||
    derivedIdempotencyKey(agent.id, text);

  const existing = taskStore.findActiveByIdempotency(key);
  if (existing) {
    return {
      duplicate: true,
      task: existing,
      plan,
      agentId: agent.id,
      runtimeStatus: runtime?.status || agent.implementation,
    };
  }

  const approvalRequired = policy.approvalRequired || agent.approval === "required";
  const task = await taskStore.create({
    request: text,
    agentId: agent.id,
    status: approvalRequired ? "AWAITING_APPROVAL" : "QUEUED",
    risk: policy.locked ? "locked" : policy.approvalRequired ? "high" : agent.risk,
    permissions: [
      agent.permissions?.level || "read",
      ...(agent.permissions?.externalActions ? ["external"] : []),
    ],
    approvalRequired,
    approval: approvalRequired
      ? {
          required: true,
          status: "pending",
          requestedAt: new Date().toISOString(),
          reason: "Consequential external action requires control authorization.",
        }
      : null,
    idempotencyKey: key,
    parentTaskId,
    depth: Number(depth) || 0,
    maxAttempts: 2,
  });

  await record("task.created", task, approvalRequired ? "awaiting_approval" : "queued", {
    risk: task.risk,
    approvalRequired,
  });
  logEvent({
    event: "task_created",
    requestId,
    taskId: task.id,
    agentId: task.agentId,
    status: task.status,
    approvalStatus: task.approval?.status || null,
  });

  if (approvalRequired) {
    return { task, plan, agentId: agent.id, duplicate: false, approvalRequired: true };
  }

  const executed = await executeTask(task.id, { env, fetchImpl, requestId });
  return { task: executed, plan, agentId: agent.id, duplicate: false, approvalRequired: false };
}

async function markFailed(task, { code, category, message }, requestId) {
  const current = taskStore.get(task.id);
  const patch = {
    error: {
      code: String(code || "TASK_FAILED").slice(0, 80),
      category: String(category || "execution").slice(0, 60),
      message: sanitize(message || "Task execution failed."),
      at: new Date().toISOString(),
    },
  };
  await taskStore.patch(task.id, patch, patch.error.message);
  let updated = current;
  if (current && current.status !== "FAILED") {
    updated = await taskStore.transition(task.id, "FAILED", patch.error.message);
  }
  await record("task.failed", { id: task.id, agentId: task.agentId }, "failed", {
    errorCategory: patch.error.category,
    retryCount: updated?.attempts || 0,
  });
  logEvent({
    event: "task_failed",
    requestId,
    taskId: task.id,
    agentId: task.agentId,
    status: "FAILED",
    errorCategory: patch.error.category,
    retryCount: updated?.attempts || 0,
  });
  return updated || taskStore.get(task.id);
}

export async function executeTask(taskId, { env = process.env, fetchImpl, requestId = null } = {}) {
  const started = Date.now();
  const existing = taskStore.get(taskId);
  if (!existing) throw fail(404, "TASK_NOT_FOUND", "Task not found.");
  if (existing.status === "AWAITING_APPROVAL") {
    throw fail(409, "APPROVAL_REQUIRED", "The task is waiting for control authorization.");
  }
  if (existing.status === "RUNNING") {
    throw fail(409, "TASK_ALREADY_RUNNING", "The task is already running.");
  }
  if (!["QUEUED", "RETRY_PENDING"].includes(existing.status)) {
    throw fail(409, "INVALID_TRANSITION", `Task cannot run from status ${existing.status}.`);
  }

  await taskStore.recordAttempt(taskId, "Execution attempt started.");
  let task = taskStore.get(taskId);
  task = await taskStore.transition(taskId, "PLANNING", "Mastermind is planning the task.");
  await record("task.planning", task, "planning", { attempt: task.attempts });

  const agent = getAgent(task.agentId);
  const executor = resolveExecutor(agent);
  if (!executor) {
    return markFailed(
      task,
      {
        code: "INTEGRATION_NOT_CONNECTED",
        category: "integration",
        message: `${agent?.name || task.agentId} has no connected executor. No external action was attempted.`,
      },
      requestId,
    );
  }

  if (task.approval?.required && agent.permissions?.externalActions) {
    return markFailed(
      task,
      {
        code: "EXTERNAL_ACTION_NOT_IMPLEMENTED",
        category: "integration",
        message:
          "Control authorization was recorded, but external execution is not implemented. No external action was performed.",
      },
      requestId,
    );
  }

  task = await taskStore.transition(taskId, "RUNNING", `${agent.name} is running.`);
  logEvent({
    event: "task_running",
    requestId,
    taskId,
    agentId: agent.id,
    status: "RUNNING",
    retryCount: task.attempts,
  });

  let result;
  try {
    result = await withTimeout(
      executor({ task, agent, env, fetchImpl }),
      EXECUTION_TIMEOUT_MS,
    );
  } catch (error) {
    return markFailed(
      task,
      {
        code: error.code || "EXECUTION_ERROR",
        category: error.code === "TASK_TIMEOUT" ? "timeout" : "execution",
        message: error.message,
      },
      requestId,
    );
  }

  task = await taskStore.transition(taskId, "VALIDATING", "Validating the executor result.");
  const validation = validateResult(result);
  if (!validation.valid) {
    return markFailed(
      task,
      { code: "VALIDATION_FAILED", category: "validation", message: validation.reason },
      requestId,
    );
  }
  if (!result.ok) {
    return markFailed(
      task,
      {
        code: result.error?.code || "EXECUTOR_FAILED",
        category: result.error?.category || "execution",
        message: result.error?.message || "The executor reported a failure.",
      },
      requestId,
    );
  }

  await taskStore.patch(
    taskId,
    {
      result: {
        ok: true,
        summary: String(result.summary).slice(0, MAX_RESULT_SUMMARY),
        data: result.data || null,
        validatedAt: new Date().toISOString(),
      },
    },
    "Result validated before completion.",
  );
  task = await taskStore.transition(taskId, "COMPLETED", "Result validated.");
  await record("task.completed", task, "completed", {
    durationMs: Date.now() - started,
    retryCount: task.attempts,
  });
  logEvent({
    event: "task_completed",
    requestId,
    taskId,
    agentId: task.agentId,
    status: "COMPLETED",
    durationMs: Date.now() - started,
    retryCount: task.attempts,
  });
  return task;
}

export async function approveTask(taskId, { env = process.env, actor = "control-token" } = {}) {
  const task = taskStore.get(taskId);
  if (!task) throw fail(404, "TASK_NOT_FOUND", "Task not found.");
  if (task.status !== "AWAITING_APPROVAL") {
    throw fail(409, "INVALID_TRANSITION", `Task is not awaiting approval (status ${task.status}).`);
  }
  await taskStore.patch(
    taskId,
    {
      approval: {
        ...(task.approval || {}),
        required: true,
        status: "approved",
        decidedAt: new Date().toISOString(),
        actor,
      },
    },
    "Approved by control authority.",
  );
  const updated = await taskStore.transition(
    taskId,
    "QUEUED",
    "Approved and queued. No external action has been performed yet.",
  );
  await record("task.approved", updated, "approved", { actor });
  logEvent({
    event: "task_approved",
    taskId,
    agentId: updated.agentId,
    status: updated.status,
    approvalStatus: "approved",
  });
  return updated;
}

export async function cancelTask(taskId, { env = process.env } = {}) {
  const task = taskStore.get(taskId);
  if (!task) throw fail(404, "TASK_NOT_FOUND", "Task not found.");
  if (["COMPLETED", "CANCELLED"].includes(task.status)) {
    throw fail(409, "INVALID_TRANSITION", `Task cannot be cancelled from ${task.status}.`);
  }
  if (task.status === "RUNNING") {
    throw fail(409, "TASK_RUNNING", "A running task cannot be cancelled; wait for it to finish.");
  }
  const updated = await taskStore.transition(taskId, "CANCELLED", "Cancelled by user.");
  await record("task.cancelled", updated, "cancelled", {});
  return updated;
}

export async function retryTask(taskId, { env = process.env, fetchImpl, requestId = null } = {}) {
  const task = taskStore.get(taskId);
  if (!task) throw fail(404, "TASK_NOT_FOUND", "Task not found.");
  if (task.status !== "FAILED") {
    throw fail(409, "INVALID_TRANSITION", `Only FAILED tasks can be retried (status ${task.status}).`);
  }
  if (task.attempts >= task.maxAttempts) {
    throw fail(409, "RETRY_LIMIT_REACHED", "The retry limit for this task has been reached.");
  }
  const pending = await taskStore.transition(taskId, "RETRY_PENDING", "Retry approved.");
  await record("task.retry_scheduled", pending, "retry_pending", {
    retryCount: pending.attempts,
  });
  return executeTask(taskId, { env, fetchImpl, requestId });
}
