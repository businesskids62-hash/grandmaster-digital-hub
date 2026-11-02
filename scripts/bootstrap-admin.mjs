#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { resolveDbPath } from "../lib/db/sqliteAdapter.js";
import { getDatabase, closeDatabase } from "../lib/db/index.js";
import {
  ADMIN_BOOTSTRAP_CODES,
  provisionAdmin,
  resetAdminPassword,
} from "../lib/auth/adminBootstrap.js";
import { passwordProblem } from "../lib/auth/passwords.js";

/**
 * Operator CLI for the admin credential. This is the only entry point that can
 * create an admin or change an admin password; startup and the HTTP surface
 * cannot.
 *
 * Rules this file exists to enforce:
 * - The password never travels in argv. It comes from `ADMIN_PASSWORD` or from
 *   a masked interactive prompt, and a `--password` flag is refused outright.
 * - Output is limited to fixed codes. Nothing from a database error, a
 *   credential, or the filesystem reaches stdout or stderr.
 * - It refuses to run where the storage is ephemeral or the process claims to
 *   be production, because a written admin there is lost on the next request.
 * - The target is always named with `--database`. There is no default, so a
 *   write can never land on a path the operator did not type.
 * - A target that is the repository's live database, or one the ambient
 *   configuration resolves to, needs `--allow-live` plus the word LIVE typed at
 *   an interactive terminal. Nothing but `TARGET=live` or `TARGET=custom` is
 *   said about it; the path itself never reaches the output.
 * - A missing file is created only by `bootstrap --create-new`, and
 *   `reset-password` never creates one, so a mistyped path cannot leave behind
 *   an empty database that reads as a working site.
 *
 * Usage:
 *   node scripts/bootstrap-admin.mjs bootstrap --database <path>
 *     [--email <email>] [--create-new] [--allow-live]
 *   node scripts/bootstrap-admin.mjs reset-password --database <path>
 *     [--email <email>] [--allow-live]
 */

const CLI_CODES = Object.freeze({
  USAGE_INVALID: "BOOTSTRAP_USAGE_INVALID",
  SECRET_ARGUMENT_FORBIDDEN: "BOOTSTRAP_SECRET_ARGUMENT_FORBIDDEN",
  ENVIRONMENT_FORBIDDEN: "BOOTSTRAP_ENVIRONMENT_FORBIDDEN",
  PASSWORD_UNAVAILABLE: "BOOTSTRAP_PASSWORD_UNAVAILABLE",
  STORAGE_UNAVAILABLE: "BOOTSTRAP_STORAGE_UNAVAILABLE",
  TARGET_REQUIRED: "BOOTSTRAP_TARGET_REQUIRED",
  LIVE_NOT_CONFIRMED: "BOOTSTRAP_LIVE_TARGET_NOT_CONFIRMED",
  DATABASE_NOT_FOUND: "BOOTSTRAP_DATABASE_NOT_FOUND",
});

const COMMANDS = new Set(["bootstrap", "reset-password"]);
const VALUE_FLAGS = new Set(["--email", "--database"]);
const SWITCH_FLAGS = new Set(["--allow-live", "--create-new"]);
const LIVE_CONFIRMATION = "LIVE";

const repoRoot = path.resolve(import.meta.dirname, "..");
const liveDatabasePath = path.join(repoRoot, "data", "academy.db");

function writerFor(stdout) {
  const emit = (text) => stdout.write(`${text}\n`);
  return {
    emit,
    fail(code) {
      emit(`ERROR=${code}`);
      return 1;
    },
  };
}

function readEnv(env) {
  return String(env?.ADMIN_PASSWORD || "").trim();
}

function parseArgv(argv) {
  const tokens = [...argv];
  if (tokens.some((token) => token === "--password" || token.startsWith("--password="))) {
    return { error: CLI_CODES.SECRET_ARGUMENT_FORBIDDEN };
  }
  const command = tokens.shift();
  if (!COMMANDS.has(command)) return { error: CLI_CODES.USAGE_INVALID };

  const options = {};
  while (tokens.length) {
    const token = tokens.shift();
    if (SWITCH_FLAGS.has(token)) {
      options[token.slice(2)] = true;
      continue;
    }
    if (!VALUE_FLAGS.has(token)) return { error: CLI_CODES.USAGE_INVALID };
    const value = tokens.shift();
    if (typeof value !== "string" || !value.trim()) return { error: CLI_CODES.USAGE_INVALID };
    options[token.slice(2)] = value.trim();
  }
  return { command, options };
}

// Windows compares paths case-insensitively and operators type either form, so
// a miss here would present the live database as an ordinary scratch target.
function samePath(candidate, other) {
  if (typeof candidate !== "string" || typeof other !== "string") return false;
  const key = (value) => {
    const resolved = path.resolve(value);
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  };
  return key(candidate) === key(other);
}

function isLiveTarget(resolvedTarget, env) {
  return (
    samePath(resolvedTarget, liveDatabasePath) ||
    samePath(resolvedTarget, resolveDbPath(env)) ||
    samePath(resolvedTarget, resolveDbPath({ ...env, GRANDMASTER_DB_PATH: "" }))
  );
}

/**
 * Reads one line in raw mode. With `mask` the typed characters stay hidden and
 * are answered with asterisks; otherwise they are echoed, so the operator can
 * see the confirmation word they are giving. Returns null when the operator
 * aborts with Ctrl-C or the stream cannot be read interactively.
 */
function readLine(stdin, stdout, { question, mask = false }) {
  return new Promise((resolve) => {
    if (typeof stdin.setRawMode !== "function") {
      resolve(null);
      return;
    }
    let value = "";
    stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    const onData = (chunk) => {
      for (const char of chunk.toString("utf8")) {
        if (char === "\r" || char === "\n") {
          stdin.setRawMode(false);
          stdin.removeListener("data", onData);
          stdout.write("\n");
          resolve(value);
          return;
        }
        if (char === "\u0003") {
          stdin.setRawMode(false);
          stdin.removeListener("data", onData);
          stdout.write("\n");
          resolve(null);
          return;
        }
        if (char === "\u007f" || char === "\b") {
          value = value.slice(0, -1);
          if (mask) stdout.write("\b \b");
          continue;
        }
        if (char >= " ") {
          value += char;
          stdout.write(mask ? "*" : char);
        }
      }
    };
    stdin.on("data", onData);
  });
}

async function resolvePassword({ env, stdin, stdout }) {
  const fromEnv = readEnv(env);
  if (fromEnv) return fromEnv;
  if (!stdin.isTTY) return null;
  const typed = await readLine(stdin, stdout, {
    question: "ADMIN_PASSWORD: ",
    mask: true,
  });
  return typed && typed.trim() ? typed : null;
}

/**
 * The live database needs two independent acts of will: the `--allow-live`
 * flag in the command line and the word LIVE typed at a real terminal. A
 * non-interactive caller can satisfy the first but never the second, which is
 * what keeps automation and CI from reaching a production store.
 */
async function confirmLiveTarget({ options, stdin, stdout }) {
  if (!options["allow-live"]) return false;
  if (!stdin.isTTY) return false;
  const typed = await readLine(stdin, stdout, {
    question: `Type ${LIVE_CONFIRMATION} to write to the live database: `,
    mask: false,
  });
  return typed !== null && typed.trim() === LIVE_CONFIRMATION;
}

async function targetIsAcceptable({
  command,
  resolvedTarget,
  options,
  env,
  stdin,
  stdout,
  emit,
  fail,
}) {
  const live = isLiveTarget(resolvedTarget, env);
  if (live && !(await confirmLiveTarget({ options, stdin, stdout }))) {
    return fail(CLI_CODES.LIVE_NOT_CONFIRMED);
  }

  // The file is only ever created by an explicit `bootstrap --create-new`;
  // every other missing target is refused before storage is opened.
  if (!fs.existsSync(resolvedTarget) && !(command === "bootstrap" && options["create-new"])) {
    return fail(CLI_CODES.DATABASE_NOT_FOUND);
  }

  emit(`TARGET=${live ? "live" : "custom"}`);
  return null;
}

export async function run({
  argv = process.argv.slice(2),
  env = process.env,
  stdin = process.stdin,
  stdout = process.stdout,
} = {}) {
  const { emit, fail } = writerFor(stdout);
  const parsed = parseArgv(argv);
  if (parsed.error) return fail(parsed.error);

  // A serverless or production-labelled process has no durable place for this
  // row; refusing here is what keeps an operator write from silently vanishing.
  if (env?.VERCEL || env?.NODE_ENV === "production") {
    return fail(CLI_CODES.ENVIRONMENT_FORBIDDEN);
  }

  const email = String(parsed.options.email || env?.ADMIN_EMAIL || "").trim();
  if (!email) return fail(CLI_CODES.USAGE_INVALID);

  // There is deliberately no default target. An operator write must name the
  // file it means, because the ambient configuration can point at the live
  // database and a bare command would then edit it by accident.
  if (!parsed.options.database) return fail(CLI_CODES.TARGET_REQUIRED);
  const resolvedTarget = path.resolve(parsed.options.database);

  const scope = { ...env, GRANDMASTER_DB_PATH: resolvedTarget };

  const password = await resolvePassword({ env: scope, stdin, stdout });
  if (!password) return fail(CLI_CODES.PASSWORD_UNAVAILABLE);

  // Checked before storage is opened, so a mistyped password never leaves an
  // empty database behind. The module repeats this rule and stays the authority.
  if (passwordProblem(password)) return fail(ADMIN_BOOTSTRAP_CODES.WEAK_PASSWORD);

  const targetFailure = await targetIsAcceptable({
    command: parsed.command,
    resolvedTarget,
    options: parsed.options,
    env,
    stdin,
    stdout,
    emit,
    fail,
  });
  if (targetFailure) return targetFailure;

  let result;
  try {
    const db = getDatabase(scope);
    try {
      result = parsed.command === "bootstrap"
        ? await provisionAdmin(db, { email, password, env: scope })
        : await resetAdminPassword(db, { email, password, env: scope });
    } finally {
      await closeDatabase();
    }
  } catch {
    return fail(CLI_CODES.STORAGE_UNAVAILABLE);
  }

  if (!result.ok) return fail(result.code);
  emit(`RESULT=${result.code}`);
  return 0;
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  process.exitCode = await run();
}
