import { getMt5Status } from "./mt5Bridge.js";
import { getOperatorSummary } from "../operator/service.js";

function geminiConfigured(env) {
  const key = String(env?.GEMINI_API_KEY || env?.AI_API_KEY || "").trim();
  return Boolean(key && key !== "your_gemini_api_key_here");
}

export function getIntegrations(env = process.env, { storage } = {}) {
  const aiConfigured = geminiConfigured(env);
  const mt5 = getMt5Status(env);
  const operator = getOperatorSummary(env);
  const storageStatus = storage || {
    mode: "unknown",
    durable: false,
    ephemeral: false,
    writable: false,
  };

  return [
    {
      id: "ai_provider",
      name: "AI Provider (Gemini)",
      status: aiConfigured ? "connected" : "not_connected",
      supportedOperations: ["generate_text"],
      missingConfiguration: aiConfigured ? [] : ["GEMINI_API_KEY"],
      permissionRequirements: "Server-side key only; never exposed to the browser.",
      lastVerifiedAt: null,
      error: aiConfigured ? null : "API key is not configured.",
      safeTest: "GET /api/ai/status performs a real verification call.",
    },
    {
      id: "database_storage",
      name: "Task and Memory Storage",
      status: storageStatus.writable
        ? storageStatus.durable
          ? "connected"
          : "degraded"
        : "not_connected",
      supportedOperations: ["tasks", "memories", "audit"],
      missingConfiguration: [],
      permissionRequirements: "Authorized token required for destructive memory and audit operations.",
      lastVerifiedAt: null,
      error: storageStatus.mode === "memory" ? "Filesystem is unavailable; state is process-only." : null,
      safeTest: "GET /api/v1/status reports the current storage mode.",
      detail: storageStatus,
    },
    {
      id: "mt5_monitor",
      name: "MetaTrader 5 (monitor only)",
      status:
        mt5.status === "blocked"
          ? "not_connected"
          : mt5.configured
            ? "degraded"
            : "not_connected",
      supportedOperations: ["read_positions"],
      missingConfiguration: mt5.configured ? [] : ["MT5_BRIDGE_URL"],
      permissionRequirements: "MONITOR ONLY. Trade execution is LOCKED.",
      lastVerifiedAt: null,
      error:
        mt5.status === "blocked"
          ? mt5.message
          : mt5.configured
            ? "A bridge is configured but not verified. Load a read-only snapshot in MT5 Monitor."
            : "No MT5 bridge is configured.",
      safeTest:
        "GET /api/v1/mt5/status reports configuration only; GET /api/v1/mt5/snapshot requires the control token and is read-only.",
      detail: {
        configured: mt5.configured,
        reasonCode: mt5.reasonCode,
        readOnly: mt5.readOnly,
        tradingLocked: mt5.tradingLocked,
      },
    },
    {
      id: "browser_operator",
      name: "Local Browser Operator",
      // "connected" requires configuration AND a passed local connector test.
      status:
        operator.configured && operator.realConnectorVerified && !operator.serverless
          ? "connected"
          : "not_connected",
      supportedOperations: ["navigate", "read", "click_with_approval", "fill_with_approval"],
      missingConfiguration: [
        ...(operator.authConfigured ? [] : ["GRANDMASTER_OPERATOR_USERS"]),
        ...(operator.policyConfigured ? [] : ["GRANDMASTER_OPERATOR_ALLOWED_HOSTS"]),
      ],
      permissionRequirements:
        "Local-only. Every run requires a separate control-token approval. OS control, CAPTCHA solving, stealth, proxies, file transfer, payments and trading are LOCKED.",
      lastVerifiedAt: operator.lastVerifiedAt || null,
      error: operator.serverless
        ? "Serverless hosting cannot run a local browser session."
        : !operator.configured
          ? "Operator credentials or the host allowlist are not configured."
          : !operator.realConnectorVerified
            ? "The guarded core exists, but the opt-in real connector test has not passed on this server."
            : null,
      safeTest:
        "GET /api/v1/operator/status reports configuration only. Run GRANDMASTER_OPERATOR_REAL_TEST=1 npm run test:operator:real locally.",
      detail: {
        operatorConfigured: operator.configured,
        allowedHostCount: operator.allowedHostCount,
        loopbackAllowed: operator.loopbackAllowed,
        browserChannel: operator.verifiedBrowser || operator.browserChannel,
        browserVersion: operator.verifiedBrowserVersion || null,
        realConnectorVerified: operator.realConnectorVerified,
        lastVerifiedAt: operator.lastVerifiedAt,
      },
    },
    {
      id: "binance_research",
      name: "Binance Research (read-only)",
      status: "not_connected",
      supportedOperations: ["public_market_research"],
      missingConfiguration: ["BINANCE_API_KEY"],
      permissionRequirements: "RESEARCH ONLY. Orders and withdrawals are LOCKED.",
      lastVerifiedAt: null,
      error: "No Binance data source is configured.",
      safeTest: "Connection test reports not_connected without contacting Binance.",
    },
    {
      id: "whatsapp_business",
      name: "WhatsApp Business",
      status: "not_connected",
      supportedOperations: ["send_message"],
      missingConfiguration: ["WHATSAPP_BUSINESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID"],
      permissionRequirements: "External messages require explicit approval.",
      lastVerifiedAt: null,
      error: "WhatsApp Business is not configured; no messages are sent.",
      safeTest: "Connection test reports not_connected without sending anything.",
    },
    {
      id: "youtube",
      name: "YouTube Publishing",
      status: "not_connected",
      supportedOperations: ["upload_video", "update_metadata"],
      missingConfiguration: ["YOUTUBE_OAUTH_REFRESH_TOKEN"],
      permissionRequirements: "Publishing requires explicit approval.",
      lastVerifiedAt: null,
      error: "YouTube publishing is not configured.",
      safeTest: "Connection test reports not_connected without uploading anything.",
    },
    {
      id: "social_publishing",
      name: "Social Publishing",
      status: "not_connected",
      supportedOperations: ["publish_post"],
      missingConfiguration: ["META_GRAPH_TOKEN"],
      permissionRequirements: "Publishing requires explicit approval.",
      lastVerifiedAt: null,
      error: "Social publishing is not configured.",
      safeTest: "Connection test reports not_connected without publishing anything.",
    },
    {
      id: "fiverr",
      name: "Fiverr Workflow",
      status: "not_connected",
      supportedOperations: ["gig_planning"],
      missingConfiguration: ["FIVERR_SESSION"],
      permissionRequirements: "Account actions require approval and are not implemented.",
      lastVerifiedAt: null,
      error: "Fiverr access is not configured.",
      safeTest: "Connection test reports not_connected.",
    },
    {
      id: "notifications_in_app",
      name: "In-App Notifications",
      status: "connected",
      supportedOperations: ["in_app"],
      missingConfiguration: [],
      permissionRequirements: "No external channel is contacted.",
      lastVerifiedAt: null,
      error: null,
      safeTest: "Local event stream; a test confirms no external request is made.",
    },
    {
      id: "notifications_email",
      name: "Email Notifications",
      status: "not_connected",
      supportedOperations: ["send_email"],
      missingConfiguration: ["SMTP_URL"],
      permissionRequirements: "Email requires approval and a configured provider.",
      lastVerifiedAt: null,
      error: "No email provider is configured.",
      safeTest: "Connection test reports not_connected without sending email.",
    },
    {
      id: "notifications_push",
      name: "Browser Push Notifications",
      status: "not_connected",
      supportedOperations: ["browser_push"],
      missingConfiguration: ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY"],
      permissionRequirements: "Requires browser permission and a push service.",
      lastVerifiedAt: null,
      error: "Browser push is not implemented.",
      safeTest: "Connection test reports not_connected; no alarm or vibration is promised.",
    },
  ];
}

export function getIntegration(id, env = process.env, options = {}) {
  return getIntegrations(env, options).find((item) => item.id === id) || null;
}
