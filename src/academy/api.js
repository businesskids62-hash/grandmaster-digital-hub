export const API_BASE = String(import.meta.env.VITE_API_URL || "").replace(/\/+$/, "");

export class ApiError extends Error {
  constructor(message, { status = 0, code = "" } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export function readCookie(name) {
  if (typeof document === "undefined") return "";
  const prefix = `${name}=`;
  for (const part of document.cookie.split(";")) {
    const value = part.trim();
    if (value.startsWith(prefix)) return decodeURIComponent(value.slice(prefix.length));
  }
  return "";
}

export async function api(path, { method = "GET", body, signal } = {}) {
  const headers = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (method !== "GET" && method !== "HEAD") {
    const csrf = readCookie("gm_csrf");
    if (csrf) headers["X-CSRF-Token"] = csrf;
  }

  let response;
  try {
    response = await fetch(`${API_BASE}/api${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "include",
      cache: "no-store",
      signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    throw new ApiError("Network unavailable.", { status: 0, code: "NETWORK_ERROR" });
  }

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(data?.error || "Request failed.", {
      status: response.status,
      code: data?.code || "REQUEST_FAILED",
    });
  }
  return data;
}

export function statusMessage(error, t) {
  switch (error?.code) {
    case "NETWORK_ERROR":
      return t("networkError");
    case "AUTH_RATE_LIMITED":
    case "AUTH_LOCKED":
      return t("errorRateLimited");
    case "AUTH_INVALID_CREDENTIALS":
      return t("errorInvalidCredentials");
    case "WEAK_PASSWORD":
      return t("errorWeakPassword");
    case "RESET_INVALID":
      return t("errorResetInvalid");
    case "CSRF_INVALID":
      return t("genericError");
    default:
      return error?.message || t("genericError");
  }
}
