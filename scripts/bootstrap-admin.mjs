#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { resolveDbPath } from "../lib/db/sqliteAdapter.js";
import { isPostgresUrl } from "../lib/db/postgresAdapter.js";
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
 * - "Live" is decided by the file's identity, not by the spelling. A junction,
 *   a short name, a case variant, a `..` detour or a hardlink sibling of a
 *   protected database is that database, and needs `--allow-live` plus the word
 *   LIVE typed at an interactive terminal. Creating a new database inside one of
 *   the protected directories is a live operation too. Nothing but
 *   `TARGET=live` or `TARGET=custom` is said about a target; the path itself
 *   never reaches the output.
 * - Windows namespaces that bypass the path parser (`\\?\`, `\\.\`, UNC) are
 *   answered as unsupported targets, from the operator's own string, before the
 *   filesystem is consulted. The rule never looks at a resolved path: it filters
 *   input, not output.
 * - A target whose identity cannot be read is treated as live, never as safe.
 * - The identity is read again after the database handle opens, and a change
 *   aborts before any credential write. That narrows the window between deciding
 *   and opening; it does not close it, and no atomicity is claimed here.
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
  TARGET_UNSUPPORTED: "BOOTSTRAP_TARGET_UNSUPPORTED",
  IDENTITY_UNRELIABLE: "BOOTSTRAP_TARGET_IDENTITY_UNRELIABLE",
  IDENTITY_CHANGED: "BOOTSTRAP_TARGET_IDENTITY_CHANGED",
  LIVE_NOT_CONFIRMED: "BOOTSTRAP_LIVE_TARGET_NOT_CONFIRMED",
  DATABASE_NOT_FOUND: "BOOTSTRAP_DATABASE_NOT_FOUND",
});

const COMMANDS = new Set(["bootstrap", "reset-password"]);
const VALUE_FLAGS = new Set(["--email", "--database"]);
const SWITCH_FLAGS = new Set(["--allow-live", "--create-new"]);
const LIVE_CONFIRMATION = "LIVE";

const repoRoot = path.resolve(import.meta.dirname, "..");
const liveDatabasePath = path.join(repoRoot, "data", "academy.db");
const liveDatabaseDirectory = path.dirname(liveDatabasePath);

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

/**
 * Three prefixes are how Windows addresses a device, an extended-length path or
 * another machine, and none of them is a normal file the operator means to
 * edit. They are refused from the typed string, before any filesystem call,
 * rather than reinterpreted. Separators are folded first because the Windows
 * parser does the same, so the slash form of the extended prefix is caught too.
 *
 * This is a filter on input only. It is never applied to a resolved path, which
 * would put the guard in the position of rejecting the very database it exists
 * to protect.
 */
function isUnsupportedNamespace(rawTarget) {
  if (process.platform !== "win32") return false;
  const value = String(rawTarget).replace(/\//g, "\\");
  if (value.startsWith("\\\\?\\")) return true;
  if (value.startsWith("\\\\.\\")) return true;
  return value.startsWith("\\\\");
}

function foldCase(value) {
  if (typeof value !== "string") return null;
  return process.platform === "win32" ? value.toLowerCase() : value;
}

// Windows compares paths case-insensitively and operators type either form, so
// a miss here would present a protected database as an ordinary scratch target.
function samePath(candidate, other) {
  if (typeof candidate !== "string" || typeof other !== "string") return false;
  return foldCase(path.resolve(candidate)) === foldCase(path.resolve(other));
}

/**
 * The identity of a path the way the filesystem sees it: the target every
 * reparse point resolves to, plus the device and file index behind it.
 *
 * Both halves are BigInts and both are compared. A Windows file index passes the
 * largest integer a double represents exactly, and half a pair - or a rounded
 * one - would match the wrong file. A hardlink answers to the same pair as its
 * sibling while presenting its own resolved path, which is precisely the alias
 * that resolution alone cannot see.
 *
 * Returns null when the path cannot be resolved or stat'd, and marks the
 * identity unreliable when the volume reports a zero or missing pair, because a
 * volume that does not answer cannot be compared against.
 */
function readIdentity(target) {
  let canonical;
  try {
    canonical = fs.realpathSync.native(target);
  } catch {
    return null;
  }
  let stats;
  try {
    stats = fs.statSync(canonical, { bigint: true });
  } catch {
    return null;
  }
  if (typeof stats.dev !== "bigint" || typeof stats.ino !== "bigint") {
    return { canonical, folded: foldCase(canonical), dev: null, ino: null, unreliable: true };
  }
  return {
    canonical,
    folded: foldCase(canonical),
    dev: stats.dev,
    ino: stats.ino,
    unreliable: stats.dev === 0n || stats.ino === 0n,
  };
}

function sameIdentity(first, second) {
  if (!first || !second) return false;
  if (first.unreliable || second.unreliable) return false;
  return first.dev === second.dev && first.ino === second.ino;
}

/**
 * The canonical path of a target that does not exist yet: the directory it would
 * be created in, resolved, with the typed name appended. Answers null when the
 * directory is missing (there is nothing to alias yet) or unresolvable.
 */
function foldedPathOf(target) {
  const identity = readIdentity(target);
  if (identity) return identity.folded;
  let directory;
  try {
    directory = fs.realpathSync.native(path.dirname(target));
  } catch {
    return null;
  }
  return foldCase(path.join(directory, path.basename(target)));
}

function protectedFiles(env) {
  return [
    liveDatabasePath,
    resolveDbPath(env),
    resolveDbPath({ ...env, GRANDMASTER_DB_PATH: "" }),
  ];
}

function protectedDirectories(env) {
  const directories = new Set([liveDatabaseDirectory]);
  for (const file of protectedFiles(env)) {
    if (typeof file === "string" && file) directories.add(path.dirname(path.resolve(file)));
  }
  return [...directories];
}

/**
 * Decides whether the target is a protected database, and returns what the open
 * step has to compare itself against afterwards.
 *
 * The live answer comes before the missing-file answer on purpose: an operator
 * probing a protected path gets a refusal, not a hint about what is in it.
 */
function classifyTarget({ command, resolvedTarget, options, env }) {
  const exists = fs.existsSync(resolvedTarget);
  const mayCreate = command === "bootstrap" && Boolean(options["create-new"]);
  const identity = exists ? readIdentity(resolvedTarget) : null;
  const parentExists = !exists && fs.existsSync(path.dirname(resolvedTarget));
  const directory = !exists && parentExists ? readIdentity(path.dirname(resolvedTarget)) : null;

  if (identity?.unreliable || directory?.unreliable) {
    return { failure: CLI_CODES.IDENTITY_UNRELIABLE };
  }

  // Fail closed on anything that exists but cannot be resolved. A directory that
  // is not there yet is the one exception: it cannot alias anything, and the
  // only way to reach it is to create it, which the open step does.
  const folded = exists ? identity?.folded ?? null : foldedPathOf(resolvedTarget);
  const unreadable = exists ? identity === null : parentExists && directory === null;

  let live = unreadable;
  if (!live) {
    for (const protectedFile of protectedFiles(env)) {
      if (samePath(resolvedTarget, protectedFile)) {
        live = true;
        break;
      }
      if (identity && sameIdentity(identity, readIdentity(protectedFile))) {
        live = true;
        break;
      }
      if (folded !== null && foldedPathOf(protectedFile) === folded) {
        live = true;
        break;
      }
    }
  }

  // A brand-new database inside a protected directory writes into that
  // directory's live storage, even though its own name matches nothing yet.
  if (!live && !exists) {
    for (const protectedDirectory of protectedDirectories(env)) {
      if (sameIdentity(readIdentity(path.dirname(resolvedTarget)), readIdentity(protectedDirectory))) {
        live = true;
        break;
      }
    }
  }

  if (!live && !exists && !mayCreate) {
    return { failure: CLI_CODES.DATABASE_NOT_FOUND };
  }

  return {
    baseline: {
      live,
      exists,
      parentExisted: exists || parentExists,
      folded,
      dev: identity?.dev ?? null,
      ino: identity?.ino ?? null,
      directoryDev: directory?.dev ?? null,
      directoryIno: directory?.ino ?? null,
    },
  };
}

/**
 * Re-reads the identity once the handle is open and before anything is written.
 * A path that resolves elsewhere, whose file index moved, whose directory was
 * swapped for a protected one, or whose new file turns out to be a protected
 * database is not the target the operator approved.
 *
 * This is a residual limitation rather than a fix: between the validation above
 * and the open in `getDatabase` another process can still move the path, and no
 * Node API makes the two reads atomic.
 */
function identityDriftedAfterOpen({ baseline, resolvedTarget, env }) {
  const now = readIdentity(resolvedTarget);
  if (!now || now.unreliable) return true;

  if (baseline.exists) {
    if (now.dev !== baseline.dev || now.ino !== baseline.ino) return true;
  } else if (baseline.parentExisted) {
    const directory = readIdentity(path.dirname(resolvedTarget));
    if (!directory) return true;
    if (directory.dev !== baseline.directoryDev || directory.ino !== baseline.directoryIno) {
      return true;
    }
  } else {
    // The whole parent chain was created by this open; it must not have landed
    // in, or become, a protected directory.
    const directory = readIdentity(path.dirname(resolvedTarget));
    if (!directory) return true;
    for (const protectedDirectory of protectedDirectories(env)) {
      if (sameIdentity(directory, readIdentity(protectedDirectory))) return true;
    }
  }

  if (baseline.folded !== null && now.folded !== baseline.folded) return true;

  // A target that was custom at validation must still be custom now; this is
  // what catches an alias planted between the two reads.
  if (!baseline.live) {
    for (const protectedFile of protectedFiles(env)) {
      if (sameIdentity(now, readIdentity(protectedFile))) return true;
    }
  }
  return false;
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
  const classified = classifyTarget({ command, resolvedTarget, options, env });
  if (classified.failure) return { exit: fail(classified.failure) };

  const { baseline } = classified;
  if (baseline.live && !(await confirmLiveTarget({ options, stdin, stdout }))) {
    return { exit: fail(CLI_CODES.LIVE_NOT_CONFIRMED) };
  }

  emit(`TARGET=${baseline.live ? "live" : "custom"}`);
  return { baseline };
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

  const postgres = isPostgresUrl(env?.DATABASE_URL);

  const email = String(parsed.options.email || env?.ADMIN_EMAIL || "").trim();
  if (!email) return fail(CLI_CODES.USAGE_INVALID);

  if (!postgres && !parsed.options.database) return fail(CLI_CODES.TARGET_REQUIRED);

  if (!postgres && isUnsupportedNamespace(parsed.options.database)) {
    return fail(CLI_CODES.TARGET_UNSUPPORTED);
  }

  const resolvedTarget = postgres ? null : path.resolve(parsed.options.database);

  const scope = postgres ? { ...env } : { ...env, GRANDMASTER_DB_PATH: resolvedTarget };

  const password = await resolvePassword({ env: scope, stdin, stdout });
  if (!password) return fail(CLI_CODES.PASSWORD_UNAVAILABLE);

  if (passwordProblem(password)) return fail(ADMIN_BOOTSTRAP_CODES.WEAK_PASSWORD);

  let baseline = null;
  if (!postgres) {
    const target = await targetIsAcceptable({
      command: parsed.command,
      resolvedTarget,
      options: parsed.options,
      env,
      stdin,
      stdout,
      emit,
      fail,
    });
    if (target.exit) return target.exit;
    baseline = target.baseline;
  } else {
    emit("TARGET=postgres");
  }

  let result;
  try {
    const db = getDatabase(scope);
    try {
      if (!postgres && identityDriftedAfterOpen({ baseline, resolvedTarget, env })) {
        return fail(CLI_CODES.IDENTITY_CHANGED);
      }
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
