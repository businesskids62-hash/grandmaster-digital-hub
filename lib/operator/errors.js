export function operatorError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

export function sanitizeOperatorMessage(value, fallback = "Operator request failed.") {
  return String(value || fallback)
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/(AIza[0-9A-Za-z_-]{20,}|sk-[A-Za-z0-9]{16,})/g, "[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}
