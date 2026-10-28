import fs from "node:fs";
import path from "node:path";
import { resolveDataDir } from "../storage/jsonStore.js";

const FILE_NAME = "operator-verification.json";
const CHANNELS = new Set(["msedge", "chrome"]);
const VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z._\- ()]{0,79}$/;

function filePath(env) {
  return path.join(resolveDataDir(env), FILE_NAME);
}

/**
 * Local evidence that the opt-in real connector test passed. Contains only the
 * browser channel/version and a timestamp; never page data or credentials.
 */
export function getConnectorVerification(env = process.env) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath(env), "utf8"));
    if (!parsed || typeof parsed !== "object") return null;
    if (!CHANNELS.has(parsed.browser)) return null;
    if (typeof parsed.browserVersion !== "string" || !VERSION_PATTERN.test(parsed.browserVersion)) {
      return null;
    }
    if (parsed.fixture !== "loopback") return null;
    if (Number.isNaN(new Date(parsed.verifiedAt).getTime())) return null;
    return {
      browser: parsed.browser,
      browserVersion: parsed.browserVersion,
      verifiedAt: new Date(parsed.verifiedAt).toISOString(),
      fixture: "loopback",
    };
  } catch {
    return null;
  }
}

export function recordConnectorVerification({ browser, browserVersion, env = process.env } = {}) {
  if (!CHANNELS.has(browser)) {
    throw new Error("A supported browser channel is required to record verification.");
  }
  if (typeof browserVersion !== "string" || !VERSION_PATTERN.test(browserVersion)) {
    throw new Error("A valid browser version is required to record verification.");
  }
  const directory = resolveDataDir(env);
  fs.mkdirSync(directory, { recursive: true });
  const target = filePath(env);
  const payload = {
    version: 1,
    browser,
    browserVersion,
    verifiedAt: new Date().toISOString(),
    fixture: "loopback",
  };
  const temporary = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(payload, null, 2), "utf8");
  fs.renameSync(temporary, target);
  return payload;
}
