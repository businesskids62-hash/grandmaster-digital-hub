/**
 * Development-mode authentication and notification email helper.
 * No SMTP needed - logs emails to console with clear delimiters.
 */

export const WELCOME_MESSAGE_TEMPLATE =
  "Assalam-o-Alaikum [Name]! Hub Me Welcome! Hub Kya Hai, Academy Kya Hai, Bots Kya Hai, Roz Ka Kaam Kya Hai, Rules Kya Hain - Real Trading BANNED, Roz MAX 10 Token";

export function formatWelcomeMessage(displayName = "Learner") {
  const name = displayName?.trim() || "Learner";
  return WELCOME_MESSAGE_TEMPLATE.replace("[Name]", name);
}

/**
 * Logs confirmation email containing token / link.
 */
export async function sendConfirm(email, token, user = {}, env = process.env) {
  const baseUrl = env?.APP_BASE_URL || env?.VITE_API_TARGET || "http://127.0.0.1:8000";
  const confirmUrl = `${baseUrl}/api/auth/verify-email?token=${encodeURIComponent(token)}`;
  const message = [
    "================ EMAIL: CONFIRM ADDRESS ================",
    `To: ${email}`,
    `Subject: Confirm your Grandmaster Hub account`,
    `Confirmation Link: ${confirmUrl}`,
    `Token: ${token}`,
    `Status: PENDING_APPROVAL`,
    "========================================================",
  ].join("\n");

  if (!env?.GRANDMASTER_LOG_SILENT) {
    console.log(message);
  }
  return { ok: true, email, token, confirmUrl };
}

/**
 * Logs welcome message once user is approved / active.
 */
export async function sendWelcome(email, user = {}, env = process.env) {
  const text = formatWelcomeMessage(user?.displayName || user?.name || user?.email);
  const message = [
    "================ EMAIL: WELCOME TO HUB =================",
    `To: ${email}`,
    `Subject: Assalam-o-Alaikum! Welcome to Grandmaster Digital Hub`,
    text,
    "========================================================",
  ].join("\n");

  if (!env?.GRANDMASTER_LOG_SILENT) {
    console.log(message);
  }
  return { ok: true, email, message: text };
}

/**
 * Logs alert to the hub owner when actions require attention.
 */
export async function sendOwnerAlert(action, user = {}, env = process.env) {
  const ownerEmail = env?.ADMIN_EMAIL || "owner@example.com";
  const message = [
    "================ OWNER ALERT: USER ACTION ==============",
    `To Owner: ${ownerEmail}`,
    `Action: ${action}`,
    `User ID: ${user?.id || "N/A"}`,
    `Email: ${user?.email || "N/A"}`,
    `Status: ${user?.status || "PENDING_APPROVAL"}`,
    "========================================================",
  ].join("\n");

  if (!env?.GRANDMASTER_LOG_SILENT) {
    console.log(message);
  }
  return { ok: true, ownerEmail, action, user };
}
