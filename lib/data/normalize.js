// SQLite TEXT timestamps ("YYYY-MM-DD HH:MM:SS", UTC) are normalized to
// ISO-8601 so every backend returns the same shape to callers.
const SQLITE_TIMESTAMP = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d+))?$/;
const DATE_ONLY = /^(\d{4}-\d{2}-\d{2})$/;

export function asNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function asIso(value) {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }

  const text = String(value).trim();
  if (!text) return null;

  const sqlite = SQLITE_TIMESTAMP.exec(text);
  if (sqlite) {
    const [, day, time, fraction = "000"] = sqlite;
    return `${day}T${time}.${fraction.slice(0, 3).padEnd(3, "0")}Z`;
  }

  const dateOnly = DATE_ONLY.exec(text);
  if (dateOnly) return `${dateOnly[1]}T00:00:00.000Z`;

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function asChanges(result) {
  return asNumber(result?.changes, 0);
}

export function parseJsonColumn(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}
