import { gateForAgent, GATES } from "../security/approval.js";

function providerConfigured(env = process.env) {
  const key = String(env?.GEMINI_API_KEY || env?.AI_API_KEY || "").trim();
  return Boolean(key && key !== "your_gemini_api_key_here");
}

function agent(definition) {
  return {
    ...definition,
    permissions: {
      level: "read",
      externalActions: false,
      financialActions: false,
      notes: "",
      ...definition.permissions,
    },
    lockedActions: definition.lockedActions || [],
    connections: (definition.connections || []).map((connection) =>
      typeof connection === "string"
        ? { envVar: connection, configured: false, implemented: false }
        : connection,
    ),
  };
}

const GEMINI_CONNECTION = {
  envVar: "GEMINI_API_KEY",
  configured: false,
  implemented: true,
  label: "AI provider key",
};

export const AGENT_REGISTRY = [
  agent({
    id: "mastermind",
    name: "Mastermind / Orchestrator",
    responsibility:
      "Classifies requests, plans work, routes to specialists, validates results and reports honest status.",
    capabilities: [
      { id: "classify", label: "Request classification", kind: "compute" },
      { id: "plan", label: "Task planning", kind: "compute" },
      { id: "route", label: "Specialist routing", kind: "compute" },
      { id: "validate", label: "Result validation", kind: "compute" },
    ],
    risk: "low",
    approval: "none",
    implementation: "operational",
    executor: "mastermind",
    inputContract: "{ request: string (1..2000) }",
    outputContract: "{ plan: step[], agentId, risk, approvalRequired, locked }",
    connections: [GEMINI_CONNECTION],
    notes: "Planning and routing are deterministic; AI advice is delegated to specialists.",
  }),
  agent({
    id: "risk_manager",
    name: "Independent Risk Manager",
    responsibility:
      "Reviews requests and stored task state, then recommends ALLOW, APPROVAL REQUIRED or BLOCK. It cannot trade or move funds.",
    capabilities: [
      { id: "risk_review", label: "Risk review", kind: "compute" },
      { id: "policy_block", label: "Policy block recommendation", kind: "compute" },
    ],
    risk: "high",
    approval: "none",
    implementation: "operational",
    executor: "risk",
    inputContract: "{ request: string }",
    outputContract:
      "{ ok, summary, data.verdict: ALLOW|APPROVAL_REQUIRED|BLOCK, data.execution: false }",
    permissions: {
      level: "read",
      externalActions: false,
      financialActions: false,
      notes: "BLOCK-only. It never places trades, transfers funds or changes accounts.",
    },
    lockedActions: ["trade_execution", "withdraw_funds", "transfer_funds"],
    notes:
      "Independent of trading agents. Uses deterministic policy checks and stored state only; no live market feed.",
  }),
  agent({
    id: "coding",
    name: "Coding Agent",
    responsibility:
      "Produces implementation guidance, review checklists and test plans for code tasks.",
    capabilities: [
      { id: "implementation_guidance", label: "Implementation guidance", kind: "advisory" },
      { id: "code_review_checklist", label: "Code review checklist", kind: "advisory" },
      { id: "test_plan", label: "Test plan drafting", kind: "advisory" },
    ],
    risk: "medium",
    approval: "none",
    implementation: "advisory",
    executor: "advisory",
    promptKey: "coding",
    inputContract: "{ request: string }",
    outputContract: "{ ok, summary, data.externalActionsPerformed: false }",
    connections: [GEMINI_CONNECTION],
    notes: "Advisory only. It does not write files, run commands or deploy.",
  }),
  agent({
    id: "business",
    name: "Business Agent",
    responsibility: "Business planning, offer design and opportunity analysis.",
    capabilities: [
      { id: "business_plan", label: "Business plan drafting", kind: "advisory" },
      { id: "offer_design", label: "Offer and pricing ideas", kind: "advisory" },
    ],
    risk: "medium",
    approval: "none",
    implementation: "advisory",
    executor: "advisory",
    promptKey: "business",
    inputContract: "{ request: string }",
    outputContract: "{ ok, summary, data.externalActionsPerformed: false }",
    connections: [GEMINI_CONNECTION],
    notes: "Advisory only; no contracts, payments or account changes.",
  }),
  agent({
    id: "content",
    name: "Content Creation Agent",
    responsibility: "Drafts content briefs, outlines and copy for review.",
    capabilities: [
      { id: "content_brief", label: "Content brief", kind: "advisory" },
      { id: "copy_draft", label: "Copy draft", kind: "advisory" },
    ],
    risk: "low",
    approval: "none",
    implementation: "advisory",
    executor: "advisory",
    promptKey: "content",
    inputContract: "{ request: string }",
    outputContract: "{ ok, summary, data.externalActionsPerformed: false }",
    connections: [GEMINI_CONNECTION],
    notes: "Drafts only; publishing is handled by gated social/YouTube agents.",
  }),
  agent({
    id: "finance",
    name: "Finance Education and Budgeting Agent",
    responsibility: "Budget education, expense categorisation and savings planning.",
    capabilities: [
      { id: "budget_guidance", label: "Budget guidance", kind: "advisory" },
      { id: "expense_review", label: "Expense review", kind: "advisory" },
    ],
    risk: "medium",
    approval: "none",
    implementation: "advisory",
    executor: "advisory",
    promptKey: "finance",
    inputContract: "{ request: string }",
    outputContract: "{ ok, summary, data.externalActionsPerformed: false }",
    connections: [GEMINI_CONNECTION],
    permissions: {
      level: "advisory",
      externalActions: false,
      financialActions: false,
      notes: "Money movement and transactions are LOCKED by policy.",
    },
    lockedActions: ["transfer_funds", "execute_payment", "trade"],
    notes: "Education and budgeting only. No account access.",
  }),
  agent({
    id: "trading_monitor",
    name: "Trading Monitor Agent",
    responsibility: "Read-only market monitoring when a bridge is configured.",
    capabilities: [
      { id: "monitor_market", label: "Read-only market monitoring", kind: "monitor" },
      { id: "trade_execution", label: "Trade execution", kind: "financial" },
    ],
    risk: "high",
    approval: "none",
    implementation: "not_connected",
    executor: null,
    inputContract: "{ request: string }",
    outputContract: "NOT CONNECTED: no MT5 bridge is configured.",
    connections: [
      { envVar: "MT5_BRIDGE_URL", configured: false, implemented: false, label: "MT5 read-only bridge" },
    ],
    permissions: {
      level: "monitor",
      externalActions: false,
      financialActions: false,
      notes: "MT5 is MONITOR ONLY. Trade execution is LOCKED.",
    },
    lockedActions: ["trade_execution", "position_close", "withdraw_funds"],
    notes: "No market feed is connected; no trades can be placed.",
  }),
  agent({
    id: "binance_research",
    name: "Binance Research Agent",
    responsibility: "Research-only analysis of public market information.",
    capabilities: [
      { id: "market_research", label: "Market research", kind: "read" },
      { id: "order_execution", label: "Order execution", kind: "financial" },
    ],
    risk: "high",
    approval: "none",
    implementation: "not_connected",
    executor: null,
    inputContract: "{ request: string }",
    outputContract: "NOT CONNECTED: no Binance data source is configured.",
    connections: [
      { envVar: "BINANCE_API_KEY", configured: false, implemented: false, label: "Binance read-only API" },
    ],
    permissions: {
      level: "research",
      externalActions: false,
      financialActions: false,
      notes: "Binance is RESEARCH ONLY. Order execution is LOCKED.",
    },
    lockedActions: ["order_execution", "withdraw_funds"],
    notes: "No credentials configured and no trading is implemented.",
  }),
  agent({
    id: "social_media",
    name: "Social Media Agent",
    responsibility: "Drafts authorized social posts; publishing requires approval and is not implemented.",
    capabilities: [
      { id: "draft_post", label: "Post drafting", kind: "advisory" },
      { id: "publish_post", label: "Publish post", kind: "external" },
    ],
    risk: "high",
    approval: "external_only",
    implementation: "advisory",
    executor: "advisory",
    promptKey: "social_media",
    inputContract: "{ request: string }",
    outputContract: "{ ok, summary, data.externalActionsPerformed: false }",
    connections: [
      { envVar: "META_GRAPH_TOKEN", configured: false, implemented: false, label: "Meta publishing" },
    ],
    permissions: {
      level: "draft",
      externalActions: true,
      financialActions: false,
      notes: "Publishing is APPROVAL REQUIRED and not connected.",
    },
    lockedActions: ["publish_without_approval"],
    notes: "Drafts are advisory; external publishing is never automatic.",
  }),
  agent({
    id: "youtube_creator",
    name: "YouTube Creator Agent",
    responsibility: "Plans videos, titles and scripts; publishing requires approval and is not implemented.",
    capabilities: [
      { id: "video_plan", label: "Video plan and script", kind: "advisory" },
      { id: "publish_video", label: "Publish video", kind: "external" },
    ],
    risk: "high",
    approval: "external_only",
    implementation: "advisory",
    executor: "advisory",
    promptKey: "youtube_creator",
    inputContract: "{ request: string }",
    outputContract: "{ ok, summary, data.externalActionsPerformed: false }",
    connections: [
      { envVar: "YOUTUBE_DATA_API_KEY", configured: false, implemented: false, label: "YouTube publishing" },
    ],
    permissions: {
      level: "draft",
      externalActions: true,
      financialActions: false,
      notes: "Uploads and channel changes are APPROVAL REQUIRED and not connected.",
    },
    lockedActions: ["publish_without_approval"],
    notes: "Planning only; no uploads or channel changes.",
  }),
  agent({
    id: "fiverr_business",
    name: "Fiverr Business Agent",
    responsibility: "Assists with gig planning and client workflow drafts.",
    capabilities: [
      { id: "gig_plan", label: "Gig planning", kind: "advisory" },
      { id: "account_action", label: "Account actions", kind: "external" },
    ],
    risk: "medium",
    approval: "external_only",
    implementation: "not_connected",
    executor: null,
    inputContract: "{ request: string }",
    outputContract: "NOT CONNECTED: no Fiverr integration is configured.",
    connections: [
      { envVar: "FIVERR_SESSION", configured: false, implemented: false, label: "Fiverr workflow" },
    ],
    permissions: {
      level: "draft",
      externalActions: true,
      financialActions: false,
      notes: "Account changes and messaging require approval and are not implemented.",
    },
    notes: "No Fiverr account access exists.",
  }),
  agent({
    id: "whatsapp_assistant",
    name: "WhatsApp Assistant Agent",
    responsibility: "Drafts replies and support flows for WhatsApp Business.",
    capabilities: [
      { id: "draft_reply", label: "Draft reply", kind: "advisory" },
      { id: "send_message", label: "Send message", kind: "external" },
    ],
    risk: "high",
    approval: "external_only",
    implementation: "not_connected",
    executor: null,
    inputContract: "{ request: string }",
    outputContract: "NOT CONNECTED: WhatsApp Business is not configured.",
    connections: [
      { envVar: "WHATSAPP_BUSINESS_TOKEN", configured: false, implemented: false, label: "WhatsApp Business API" },
    ],
    permissions: {
      level: "draft",
      externalActions: true,
      financialActions: false,
      notes: "Sending messages requires approval; delivery is not implemented.",
    },
    notes: "No messages are sent from this system.",
  }),
  agent({
    id: "memory",
    name: "Memory Agent",
    responsibility: "Stores, searches, corrects and deletes approved durable memories.",
    capabilities: [
      { id: "save_memory", label: "Save memory", kind: "compute" },
      { id: "search_memory", label: "Search memory", kind: "read" },
      { id: "delete_memory", label: "Delete memory (authorized)", kind: "compute" },
    ],
    risk: "low",
    approval: "none",
    implementation: "operational",
    executor: "memory",
    inputContract: "{ request: string, text?, category? }",
    outputContract: "{ ok, summary, data.memoryId? }",
    permissions: {
      level: "write",
      externalActions: false,
      financialActions: false,
      notes: "Secrets are rejected. Update/delete require control authorization.",
    },
    notes: "Server-side storage; durable locally, ephemeral on serverless /tmp.",
  }),
  agent({
    id: "security",
    name: "Security Agent",
    responsibility: "Reports security posture, locked actions and audit status.",
    capabilities: [
      { id: "posture_report", label: "Security posture", kind: "read" },
      { id: "audit_review", label: "Audit review (authorized)", kind: "read" },
    ],
    risk: "low",
    approval: "none",
    implementation: "operational",
    executor: "security",
    inputContract: "{ request: string }",
    outputContract: "{ ok, summary, data.posture }",
    permissions: {
      level: "read",
      externalActions: false,
      financialActions: false,
      notes: "Audit export requires control authorization.",
    },
    notes: "Read-only reporting. It does not change permissions.",
  }),
  agent({
    id: "research",
    name: "Research Agent",
    responsibility: "Synthesizes background knowledge into a structured research plan.",
    capabilities: [
      { id: "synthesis", label: "Knowledge synthesis", kind: "advisory" },
      { id: "source_plan", label: "Source verification plan", kind: "advisory" },
    ],
    risk: "medium",
    approval: "none",
    implementation: "advisory",
    executor: "advisory",
    promptKey: "research",
    inputContract: "{ request: string }",
    outputContract: "{ ok, summary, data.externalActionsPerformed: false }",
    connections: [GEMINI_CONNECTION],
    notes: "No live web browsing or source fetching is implemented.",
  }),
  agent({
    id: "education",
    name: "Education / Kids Academy Agent",
    responsibility: "Creates age-appropriate lesson plans and learning paths.",
    capabilities: [
      { id: "lesson_plan", label: "Lesson plan", kind: "advisory" },
      { id: "learning_path", label: "Learning path", kind: "advisory" },
    ],
    risk: "low",
    approval: "none",
    implementation: "advisory",
    executor: "advisory",
    promptKey: "education",
    inputContract: "{ request: string }",
    outputContract: "{ ok, summary, data.externalActionsPerformed: false }",
    connections: [GEMINI_CONNECTION],
    notes: "Advisory only; no student accounts or payments.",
  }),
  agent({
    id: "website_app_builder",
    name: "Website and App Builder Agent",
    responsibility: "Produces architecture and build plans for websites and apps.",
    capabilities: [
      { id: "architecture_plan", label: "Architecture plan", kind: "advisory" },
      { id: "build_checklist", label: "Build checklist", kind: "advisory" },
      { id: "deploy", label: "Deploy application", kind: "external" },
    ],
    risk: "medium",
    approval: "external_only",
    implementation: "advisory",
    executor: "advisory",
    promptKey: "website_app_builder",
    inputContract: "{ request: string }",
    outputContract: "{ ok, summary, data.externalActionsPerformed: false }",
    connections: [GEMINI_CONNECTION],
    permissions: {
      level: "advisory",
      externalActions: true,
      financialActions: false,
      notes: "It does not write files or deploy; deployment requires approval and is not implemented.",
    },
    lockedActions: ["deploy_without_approval"],
    notes: "Guidance only. No files are created or deployed.",
  }),
  agent({
    id: "task_tracker",
    name: "Task and Challenge Tracker",
    responsibility: "Summarises open tasks, milestones and challenge progress.",
    capabilities: [
      { id: "task_summary", label: "Task summary", kind: "read" },
      { id: "milestone_plan", label: "Milestone plan", kind: "compute" },
    ],
    risk: "low",
    approval: "none",
    implementation: "operational",
    executor: "tasks",
    inputContract: "{ request: string }",
    outputContract: "{ ok, summary, data.openTaskCount }",
    permissions: {
      level: "read",
      externalActions: false,
      financialActions: false,
      notes: "Reads task state; it does not create nested tasks.",
    },
    notes: "No recursive task creation.",
  }),
  agent({
    id: "analytics",
    name: "Analytics and Reporting Agent",
    responsibility: "Builds reports from real task, memory and audit counters.",
    capabilities: [
      { id: "task_metrics", label: "Task metrics", kind: "compute" },
      { id: "agent_metrics", label: "Agent metrics", kind: "compute" },
    ],
    risk: "low",
    approval: "none",
    implementation: "operational",
    executor: "analytics",
    inputContract: "{ request: string }",
    outputContract: "{ ok, summary, data.stats }",
    permissions: {
      level: "read",
      externalActions: false,
      financialActions: false,
      notes: "Aggregates local counters only; no third-party analytics.",
    },
    notes: "Reports only real stored data; empty datasets are reported as zero.",
  }),
  agent({
    id: "notification",
    name: "Notification Agent",
    responsibility: "Emits in-app notifications for task completion, failure and approvals.",
    capabilities: [
      { id: "in_app", label: "In-app notifications", kind: "compute" },
      { id: "email", label: "Email delivery", kind: "external" },
      { id: "push", label: "Browser push delivery", kind: "external" },
    ],
    risk: "low",
    approval: "none",
    implementation: "operational",
    executor: "notifications",
    inputContract: "{ request: string }",
    outputContract: "{ ok, summary, data.notifications[] }",
    permissions: {
      level: "write",
      externalActions: false,
      financialActions: false,
      notes: "Only in-app notifications are implemented. Email/push are NOT CONNECTED.",
    },
    notes: "Does not promise SMS, WhatsApp delivery or mobile alarms.",
  }),
  agent({
    id: "qa_testing",
    name: "QA and Testing Agent",
    responsibility: "Validates task results and reports the automated test inventory.",
    capabilities: [
      { id: "result_validation", label: "Result validation", kind: "compute" },
      { id: "test_inventory", label: "Test inventory", kind: "read" },
    ],
    risk: "low",
    approval: "none",
    implementation: "operational",
    executor: "qa",
    inputContract: "{ request: string }",
    outputContract: "{ ok, summary, data.validation }",
    permissions: {
      level: "read",
      externalActions: false,
      financialActions: false,
      notes: "Validates stored results; it does not execute arbitrary test code.",
    },
    notes: "Contract validation is implemented; arbitrary test execution is not.",
  }),
];

export const AGENT_IDS = AGENT_REGISTRY.map((item) => item.id);

export function getAgent(id) {
  return AGENT_REGISTRY.find((item) => item.id === id) || null;
}

function addConnectionStatus(agentDefinition, env) {
  const aiConfigured = providerConfigured(env);
  return {
    ...agentDefinition,
    connections: agentDefinition.connections.map((connection) => {
      if (connection.envVar === "GEMINI_API_KEY") {
        return { ...connection, configured: aiConfigured };
      }
      return { ...connection };
    }),
    missingConfiguration: agentDefinition.connections
      .filter(
        (connection) =>
          !connection.implemented ||
          (connection.envVar === "GEMINI_API_KEY" && !aiConfigured),
      )
      .map((connection) => connection.envVar),
  };
}

export const EVIDENCE_LABELS = {
  LIVE_VERIFIED: "LIVE VERIFIED",
  LOCALLY_TESTED: "LOCALLY TESTED",
  VERIFIED_IN_CODE: "VERIFIED IN CODE",
  APPROVAL_REQUIRED: "APPROVAL REQUIRED",
  NOT_CONNECTED: "NOT CONNECTED",
  NOT_IMPLEMENTED: "NOT IMPLEMENTED",
  MOCK_SIMULATED: "MOCK/SIMULATED",
};

function evidenceFor(definition, context, statusReason) {
  if (definition.implementation === "not_connected") {
    return {
      label: EVIDENCE_LABELS.NOT_CONNECTED,
      detail: statusReason || "Required integration is not configured.",
    };
  }
  if (definition.approval === "external_only") {
    return {
      label: EVIDENCE_LABELS.APPROVAL_REQUIRED,
      detail: `${statusReason} Drafting and planning are advisory; external execution is NOT IMPLEMENTED.`,
    };
  }
  if (definition.implementation === "advisory") {
    if (!context.providerConfigured) {
      return {
        label: EVIDENCE_LABELS.NOT_CONNECTED,
        detail:
          "The advisory implementation exists, but no AI provider is configured on the server.",
      };
    }
    if (!context.providerVerified) {
      return {
        label: EVIDENCE_LABELS.VERIFIED_IN_CODE,
        detail:
          "The implementation and its automated tests exist, but the AI provider has not passed a real verification call in this process.",
      };
    }
    return {
      label: EVIDENCE_LABELS.LIVE_VERIFIED,
      detail:
        "A real AI provider verification call succeeded in this process. External actions remain gated.",
    };
  }
  if (definition.implementation === "operational") {
    if (context.storageAvailable === false) {
      return {
        label: EVIDENCE_LABELS.VERIFIED_IN_CODE,
        detail:
          "Implemented and tested, but storage is unavailable so runtime state is degraded.",
      };
    }
    return {
      label: EVIDENCE_LABELS.LOCALLY_TESTED,
      detail:
        "Exercised by the automated test suite. This label does not claim production or live verification.",
    };
  }
  return {
    label: EVIDENCE_LABELS.NOT_IMPLEMENTED,
    detail: "No verified implementation is available.",
  };
}

export function getRuntimeAgents(env = process.env, context = {}) {
  const aiConfigured = providerConfigured(env);
  const enrichedContext = {
    providerConfigured: aiConfigured,
    ...context,
    providerVerified: context.providerVerified === true,
  };

  return AGENT_REGISTRY.map((definition) => {
    const withConnections = addConnectionStatus(definition, env);
    const gate = gateForAgent(definition, enrichedContext);
    let status = definition.implementation;
    let statusReason = "";

    if (definition.implementation === "advisory") {
      if (!aiConfigured) {
        status = "requires_configuration";
        statusReason = "GEMINI_API_KEY is not configured on the server.";
      } else if (!enrichedContext.providerVerified) {
        status = "requires_verification";
        statusReason =
          "The AI provider is configured but has not completed a real verification call. Run the AI provider verification; configuration alone is not proof of health.";
      } else {
        status = "advisory_ready";
        statusReason =
          "The AI provider passed a real verification call. External actions remain gated.";
      }
    } else if (definition.implementation === "not_connected") {
      statusReason =
        definition.id === "trading_monitor"
          ? "MONITOR ONLY: trade execution is LOCKED; no MT5 bridge is configured."
          : definition.id === "binance_research"
            ? "RESEARCH ONLY: order execution and withdrawals are LOCKED; no data source is configured."
            : "Required integration is not configured; no external action is attempted.";
    } else if (definition.implementation === "operational") {
      if (withConnections.missingConfiguration.includes("GEMINI_API_KEY") &&
          definition.id === "mastermind") {
        statusReason = "Routing works without AI; advisory steps need a provider.";
      } else {
        statusReason = "Implemented and exercised by the automated test suite.";
      }
      if (enrichedContext.storageAvailable === false) {
        status = "degraded";
        statusReason = "Storage is unavailable; state is process-only and not durable.";
      }
    }

    return {
      ...withConnections,
      status,
      gate,
      statusReason,
      evidence: evidenceFor(definition, enrichedContext, statusReason),
      interface: {
        read: `/api/v1/agents/${definition.id}`,
        execute: definition.executor ? "POST /api/v1/tasks" : null,
      },
    };
  });
}

export function getRuntimeAgent(id, env = process.env, context = {}) {
  return getRuntimeAgents(env, context).find((item) => item.id === id) || null;
}

export const DESK_REGISTRY = [
  {
    id: "mastermind",
    name: "Mastermind Command Center",
    agentIds: ["mastermind"],
    integrationIds: [],
    boundary:
      "Deterministic planning and routing. No external action is performed by this desk.",
  },
  {
    id: "mt5_monitor",
    name: "MT5 / Exness Monitor",
    agentIds: ["trading_monitor"],
    integrationIds: ["mt5_monitor"],
    boundary:
      "MONITOR ONLY. Trade execution, position changes and withdrawals are LOCKED.",
  },
  {
    id: "risk_manager",
    name: "Independent Risk Manager",
    agentIds: ["risk_manager"],
    integrationIds: [],
    boundary:
      "BLOCK-only risk review. It cannot place trades, transfer funds or change accounts.",
  },
  {
    id: "communications",
    name: "Email + WhatsApp Assistant",
    agentIds: ["whatsapp_assistant", "notification"],
    integrationIds: ["whatsapp_business", "notifications_email"],
    boundary:
      "Drafting only. Sending email or WhatsApp messages requires approval and is NOT CONNECTED.",
  },
  {
    id: "social",
    name: "Social Media Manager",
    agentIds: ["social_media", "youtube_creator"],
    integrationIds: ["social_publishing", "youtube"],
    boundary:
      "Planning and drafts only. Publishing requires approval and is NOT IMPLEMENTED.",
  },
];

export function getDeskSummaries(env = process.env, context = {}, options = {}) {
  const runtimeAgents = options.agents || getRuntimeAgents(env, context);
  const integrations = Array.isArray(options.integrations) ? options.integrations : [];
  const taskStatsByAgent = options.taskStatsByAgent || {};
  const agentMap = new Map(runtimeAgents.map((item) => [item.id, item]));
  const integrationMap = new Map(integrations.map((item) => [item.id, item]));

  return DESK_REGISTRY.map((desk) => {
    const deskAgents = desk.agentIds
      .map((id) => agentMap.get(id))
      .filter(Boolean);
    const deskIntegrations = desk.integrationIds
      .map((id) => integrationMap.get(id))
      .filter(Boolean);
    const primary = deskAgents[0] || null;
    const missingConfiguration = [
      ...new Set([
        ...deskAgents.flatMap((agentItem) => agentItem.missingConfiguration || []),
        ...deskIntegrations.flatMap((integration) => integration.missingConfiguration || []),
      ]),
    ];
    const taskCount = desk.agentIds.reduce(
      (sum, id) => sum + (Number(taskStatsByAgent[id]) || 0),
      0,
    );
    // A desk is live-verified only when every mapped agent and integration has
    // real evidence. A configured value alone is never enough.
    const liveVerified = Boolean(
      deskAgents.length > 0 &&
        deskAgents.every(
          (agentItem) => agentItem.evidence?.label === EVIDENCE_LABELS.LIVE_VERIFIED,
        ) &&
        deskIntegrations.every((integration) => integration.status === "connected"),
    );

    return {
      id: desk.id,
      name: desk.name,
      boundary: desk.boundary,
      statusLabel: primary?.evidence?.label || EVIDENCE_LABELS.NOT_IMPLEMENTED,
      statusDetail: primary?.evidence?.detail || "",
      gate: primary?.gate || "NOT CONNECTED",
      approvalRequired: deskAgents.some(
        (agentItem) =>
          agentItem.approval === "external_only" ||
          agentItem.gate === "APPROVAL REQUIRED",
      ),
      liveVerified,
      externalExecutionEnabled: false,
      taskCount,
      metricsSource: "local task store",
      missingConfiguration,
      agents: deskAgents.map((agentItem) => ({
        id: agentItem.id,
        name: agentItem.name,
        status: agentItem.status,
        gate: agentItem.gate,
        statusLabel: agentItem.evidence?.label || "NOT VERIFIED",
      })),
      integrations: deskIntegrations.map((integration) => ({
        id: integration.id,
        name: integration.name,
        status: integration.status,
        missingConfiguration: integration.missingConfiguration || [],
      })),
    };
  });
}

export { GATES };
