import { generateText } from "../aiProviders.js";
import { memoryStore } from "../memory/memoryStore.js";
import { taskStore } from "../tasks/taskStore.js";
import { auditStore } from "../security/auditStore.js";
import { getSecurityPosture } from "../security/posture.js";
import { getNotifications } from "../notifications/notificationService.js";
import { AGENT_REGISTRY } from "../agents/registry.js";

const MAX_SUMMARY = 8_000;

const ADVISORY_PROMPTS = {
  coding:
    "You are the Coding Agent inside Grandmaster Digital Hub. Provide concrete implementation guidance, a verification plan and risks. Do not claim to have edited files, run commands, executed tests or deployed anything.",
  business:
    "You are the Business Agent inside Grandmaster Digital Hub. Produce a practical business plan with assumptions, risks and next steps. Do not claim to have contacted customers, signed contracts or moved money.",
  content:
    "You are the Content Creation Agent inside Grandmaster Digital Hub. Draft a content brief and copy for human review. Do not claim to have published anything.",
  finance:
    "You are the Finance Education and Budgeting Agent inside Grandmaster Digital Hub. Give educational budgeting guidance. You must not execute payments, transfers, trades or account changes.",
  social_media:
    "You are the Social Media Agent inside Grandmaster Digital Hub. Draft post copy for review. Publishing requires explicit approval and is not implemented; do not claim anything was posted.",
  youtube_creator:
    "You are the YouTube Creator Agent inside Grandmaster Digital Hub. Plan videos, titles and scripts. Uploads and channel changes require approval and are not implemented; do not claim anything was published.",
  research:
    "You are the Research Agent inside Grandmaster Digital Hub. Synthesize knowledge and produce a verification plan with sources to check. You do not have live web browsing; state uncertainty and do not fabricate citations.",
  education:
    "You are the Education and Kids Academy Agent inside Grandmaster Digital Hub. Create an age-appropriate lesson plan and learning path. Do not claim to have enrolled students or contacted parents.",
  website_app_builder:
    "You are the Website and App Builder Agent inside Grandmaster Digital Hub. Produce an architecture and build plan. You do not create files, run builds or deploy; do not claim you did.",
};

function clip(value, max = MAX_SUMMARY) {
  return String(value || "").slice(0, max);
}

function failureFromProvider(error) {
  const attempts = Array.isArray(error?.attempts) ? error.attempts : [];
  const firstFailure = attempts.find((attempt) => attempt.status === "failed");
  const code = firstFailure?.errorCategory || error?.code || "provider_error";
  const category = String(code).startsWith("provider_") ? code : "provider_error";
  return {
    ok: false,
    error: {
      code: String(code).toUpperCase(),
      category,
      message: firstFailure?.error || "The AI provider is unavailable.",
      attempts: attempts.map((attempt) => ({
        provider: attempt.provider,
        model: attempt.model,
        status: attempt.status,
        statusCode: attempt.statusCode ?? null,
        errorCategory: attempt.errorCategory || null,
      })),
    },
  };
}

function advisoryExecutor(promptKey) {
  return async ({ task, env, fetchImpl }) => {
    const systemPrompt = `${ADVISORY_PROMPTS[promptKey]} Return a concise structured answer with headings: Assessment, Plan, Risks, Verification. Do not invent results.`;
    try {
      const result = await generateText({
        message: task.request,
        systemPrompt,
        env,
        fetchImpl,
        timeoutMs: 20_000,
        maxOutputTokens: 900,
      });
      if (!result.reply || !result.reply.trim()) {
        return {
          ok: false,
          error: {
            code: "PROVIDER_EMPTY_RESPONSE",
            category: "provider_empty_response",
            message: "The AI provider returned an empty response.",
          },
        };
      }
      return {
        ok: true,
        summary: clip(result.reply),
        data: {
          provider: result.provider,
          model: result.model,
          externalActionsPerformed: false,
          advisoryOnly: true,
        },
      };
    } catch (error) {
      return failureFromProvider(error);
    }
  };
}

async function memoryExecutor({ task }) {
  const match = task.request.match(
    /^(?:remember|yaad rakho|yaad rakhna)[:,\s]+([\s\S]+)$/i,
  );
  const text = (match?.[1] || task.request).trim();
  const category = /\bgoal\b/i.test(text)
    ? "goal"
    : /\bproject\b/i.test(text)
      ? "project"
      : /\b(rule|instruction|always|never)\b/i.test(text)
        ? "instruction"
        : "preference";
  try {
    const { item, duplicate } = await memoryStore.create({
      text,
      category,
      source: "memory-agent",
    });
    const storage = memoryStore.status();
    const durability = storage.durable
      ? "durable server storage"
      : storage.ephemeral
        ? "ephemeral server storage (not durable across instances)"
        : "process memory only (not durable)";
    return {
      ok: true,
      summary: duplicate
        ? `An identical memory already exists in ${durability}.`
        : `Saved to ${durability}.`,
      data: {
        memoryId: item.id,
        category: item.category,
        duplicate,
        storage: storage.mode,
        durable: storage.durable,
      },
    };
  } catch (error) {
    return {
      ok: false,
      error: {
        code: error.code || "MEMORY_SAVE_FAILED",
        category: "memory",
        message: error.message || "Memory could not be saved.",
      },
    };
  }
}

async function tasksExecutor() {
  const stats = taskStore.stats();
  const openApprovals = taskStore.list({ status: "AWAITING_APPROVAL", limit: 10 });
  return {
    ok: true,
    summary: `Tasks: ${stats.total} total, ${stats.completed} completed, ${stats.failed} failed, ${stats.awaitingApproval} awaiting approval.`,
    data: {
      stats,
      awaitingApproval: openApprovals.map((task) => ({
        id: task.id,
        agentId: task.agentId,
        request: task.request.slice(0, 160),
      })),
      recursiveTaskCreation: false,
    },
  };
}

async function analyticsExecutor() {
  const tasks = taskStore.stats();
  const memory = memoryStore.stats();
  const audit = auditStore.stats();
  const byAgent = {};
  for (const item of taskStore.list({ limit: 200 })) {
    byAgent[item.agentId] = (byAgent[item.agentId] || 0) + 1;
  }
  return {
    ok: true,
    summary: `Reporting ${tasks.total} tasks, ${memory.total} memories and ${audit.total} audit events from stored state.`,
    data: {
      tasks,
      memory,
      audit,
      byAgent,
      agentsRegistered: AGENT_REGISTRY.length,
      source: "local durable store",
    },
  };
}

async function securityExecutor({ env }) {
  const posture = getSecurityPosture(env, { storage: taskStore.status() });
  return {
    ok: true,
    summary: `Security posture: ${posture.lockedActions.length} locked actions, control authority ${posture.controlAuthorityConfigured ? "configured" : "NOT configured"}, ${posture.audit.total} audit events.`,
    data: posture,
  };
}

async function notificationsExecutor() {
  const notifications = getNotifications({ limit: 10 });
  return {
    ok: true,
    summary: `In-app notifications available: ${notifications.length}. Email and push are NOT CONNECTED.`,
    data: { notifications, externalDelivery: false },
  };
}

async function qaExecutor({ task }) {
  const history = Array.isArray(task.history) ? task.history : [];
  const checks = [
    { check: "history-recorded", passed: history.length > 0 },
    { check: "known-status", passed: Boolean(task.status) },
    {
      check: "completed-has-result",
      passed: task.status !== "COMPLETED" || Boolean(task.result?.summary),
    },
  ];
  const passed = checks.filter((item) => item.passed).length;
  return {
    ok: true,
    summary: `Validated the stored task record: ${passed}/${checks.length} checks passed. This does not execute the repository test suite.`,
    data: { checks, executedRepositoryTests: false },
  };
}

async function mastermindExecutor({ task }) {
  return {
    ok: true,
    summary:
      "Mastermind received the task. Deterministic planning and routing are available at POST /api/v1/mastermind/plan; no external action was performed.",
    data: { externalActionsPerformed: false, planEndpoint: "/api/v1/mastermind/plan" },
  };
}

export const EXECUTORS = {
  mastermind: mastermindExecutor,
  advisory: advisoryExecutor,
  memory: memoryExecutor,
  tasks: tasksExecutor,
  analytics: analyticsExecutor,
  security: securityExecutor,
  notifications: notificationsExecutor,
  qa: qaExecutor,
};

export function resolveExecutor(agent) {
  if (!agent || !agent.executor) return null;
  if (agent.executor === "advisory") {
    return advisoryExecutor(agent.promptKey || "research");
  }
  return EXECUTORS[agent.executor] || null;
}
