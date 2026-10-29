import { createQueryApi, openDatabase, resolveDbPath } from "./sqliteAdapter.js";
import { migrate } from "./migrations.js";
import { seedDatabase } from "./seed.js";

let cached = null;

/**
 * Process-wide handle. Reopened when the resolved path changes (for example
 * when tests point GRANDMASTER_DB_PATH somewhere else).
 */
export function getDatabase(env = process.env) {
  const target = resolveDbPath(env);
  if (cached && cached.path === target) return cached.api;

  if (cached) {
    try {
      cached.api.close();
    } catch {
      /* already closed */
    }
    cached = null;
  }

  const { db, dbPath } = openDatabase({ env });
  const api = createQueryApi(db);
  try {
    migrate(api);
    seedDatabase(api, env);
  } catch (error) {
    try {
      api.close();
    } catch {
      /* ignore */
    }
    throw error;
  }
  cached = { path: dbPath, api };
  return api;
}

export function closeDatabase() {
  if (!cached) return;
  try {
    cached.api.close();
  } catch {
    /* ignore */
  }
  cached = null;
}

export function resetDatabaseForTests() {
  closeDatabase();
}

export function databaseStatus(env = process.env) {
  try {
    const api = getDatabase(env);
    const path = resolveDbPath(env);
    const migrations = api.get("SELECT COUNT(*) AS count FROM schema_migrations");
    return {
      ok: true,
      engine: "sqlite",
      durable: !env?.VERCEL,
      ephemeral: Boolean(env?.VERCEL),
      path: env?.VERCEL ? null : path,
      migrations: Number(migrations?.count || 0),
    };
  } catch {
    return {
      ok: false,
      engine: "sqlite",
      durable: false,
      ephemeral: Boolean(env?.VERCEL),
      path: null,
      migrations: 0,
      error: "DATABASE_UNAVAILABLE",
    };
  }
}
