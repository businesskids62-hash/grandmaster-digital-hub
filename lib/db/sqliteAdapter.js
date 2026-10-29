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

export function createQueryApi(db) {
  return {
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
      db.exec("BEGIN");
      try {
        const result = fn();
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
    close() {
      db.close();
    },
  };
}
