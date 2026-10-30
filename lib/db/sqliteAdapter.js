import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * SQLite adapter for local development and single-instance hosting.
 * Vercel /tmp is ephemeral, so production needs a hosted database; only this
 * module plus lib/db/migrations.js would change to move to Postgres.
 */

export function resolveDbPath(env = process.env) {
  const configured = String(env?.GRANDMASTER_DB_PATH || "").trim();
  if (configured) return path.resolve(configured);

  const dataDir = String(env?.GRANDMASTER_DATA_DIR || "").trim();
  const dir = dataDir
    ? path.resolve(dataDir)
    : env?.VERCEL
      ? path.join("/tmp", "grandmaster-data")
      : path.resolve(process.cwd(), "data");
  return path.join(dir, "academy.db");
}

export function openDatabase({ env = process.env, file } = {}) {
  const dbPath = file || resolveDbPath(env);
  if (dbPath !== ":memory:") {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys = ON;");
  if (dbPath !== ":memory:") {
    db.exec("PRAGMA journal_mode = WAL;");
  }
  return { db, dbPath };
}

const transactionScope = new AsyncLocalStorage();

/**
 * Async query surface over the synchronous SQLite engine.
 *
 * Every statement still runs synchronously inside `DatabaseSync`; the promise
 * boundary only marks completion for awaiting callers. Because JavaScript is
 * single-threaded, a statement can never be interrupted mid-flight.
 *
 * Transactions stay fully synchronous on purpose: `transaction(fn)` hands the
 * callback a synchronous handle (`tx.run/get/all/exec`) and rejects callbacks
 * that await. A synchronous callback cannot yield the event loop, so no other
 * request can execute SQL inside an open transaction. Returning a promise from
 * the callback rolls the transaction back instead of committing half of it.
 */
export function createQueryApi(db, { initialize = null } = {}) {
  const sync = {
    exec(sql) {
      db.exec(sql);
    },
    run(sql, params = []) {
      return db.prepare(sql).run(...params);
    },
    get(sql, params = []) {
      return db.prepare(sql).get(...params);
    },
    all(sql, params = []) {
      return db.prepare(sql).all(...params);
    },
    transaction(fn) {
      db.exec("BEGIN IMMEDIATE");
      try {
        const result = fn(sync);
        if (result && typeof result.then === "function") {
          throw new Error("TRANSACTION_CALLBACK_MUST_BE_SYNC");
        }
        db.exec("COMMIT");
        return result;
      } catch (error) {
        try {
          db.exec("ROLLBACK");
        } catch {
          /* rollback failure is secondary */
        }
        throw error;
      }
    },
  };

  let initPromise = null;
  function ready() {
    if (!initPromise) {
      // A failed initialization must not poison the handle: clear the memoized
      // rejection so the next caller retries. Successful results stay cached,
      // and a retry that is already in flight is still shared.
      initPromise = (async () => {
        if (typeof initialize === "function") await initialize(sync);
      })().catch((error) => {
        initPromise = null;
        throw error;
      });
    }
    return initPromise;
  }

  return {
    ready,
    async exec(sql) {
      await ready();
      sync.exec(sql);
    },
    async run(sql, params = []) {
      await ready();
      return sync.run(sql, params);
    },
    async get(sql, params = []) {
      await ready();
      return sync.get(sql, params);
    },
    async all(sql, params = []) {
      await ready();
      return sync.all(sql, params);
    },
    async transaction(fn) {
      await ready();
      if (typeof fn !== "function") {
        throw new Error("TRANSACTION_CALLBACK_REQUIRED");
      }
      if (transactionScope.getStore()) {
        throw new Error("NESTED_TRANSACTION_UNSUPPORTED");
      }
      db.exec("BEGIN IMMEDIATE");
      try {
        const result = transactionScope.run(sync, () => fn(sync));
        if (result && typeof result.then === "function") {
          throw new Error("TRANSACTION_CALLBACK_MUST_BE_SYNC");
        }
        db.exec("COMMIT");
        return result;
      } catch (error) {
        try {
          db.exec("ROLLBACK");
        } catch {
          /* rollback failure is secondary */
        }
        throw error;
      }
    },
    async close() {
      try {
        db.close();
      } catch {
        /* already closed */
      }
    },
  };
}
