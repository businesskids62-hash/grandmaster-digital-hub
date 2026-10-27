import { auditStore } from "./auditStore.js";
import { hasControlAuthority } from "./approval.js";

function providerConfigured(env = process.env) {
  const key = String(env?.GEMINI_API_KEY || env?.AI_API_KEY || "").trim();
  return Boolean(key && key !== "your_gemini_api_key_here");
}

export function getSecurityPosture(env = process.env, { storage } = {}) {
  return {
    generatedAt: new Date().toISOString(),
    controlAuthorityConfigured: hasControlAuthority(env),
    providerConfigured: providerConfigured(env),
    storage: storage || null,
    lockedActions: [
      { action: "real_trading", status: "LOCKED", detail: "No live trade submission exists." },
      { action: "money_movement", status: "LOCKED", detail: "Transfers and payments are not implemented." },
      { action: "mt5", status: "MONITOR ONLY", detail: "No MT5 bridge is configured." },
      { action: "binance", status: "RESEARCH ONLY", detail: "Order execution and withdrawals are LOCKED." },
      { action: "external_publishing", status: "APPROVAL REQUIRED", detail: "Publishing and messaging are not implemented." },
      { action: "memory_update_delete", status: "APPROVAL REQUIRED", detail: "Requires GRANDMASTER_CONTROL_TOKEN." },
    ],
    audit: auditStore.stats(),
    notes: [
      "A disabled button is not a security control; every gated action is checked on the server.",
      "API keys and control tokens are never returned by any endpoint.",
      "A task is completed only after result validation, never because an HTTP call returned 200.",
    ],
  };
}
