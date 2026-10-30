import { createQueryApi, openDatabase, resolveDbPath } from "./sqliteAdapter.js";
import { migrate } from "./migrations.js";
import { seedDatabase } from "./seed.js";

let cached = null;

/**
 * Process-wide async handle. The schema migration and seed run once per open
 * handle, lazily on the first query (see `createQueryApi`), so callers must
 * await their database calls.
 */
export function getDatabase(env = process.env) {
  const target = resolveDbPath(env);
  if (cached && cached.path === target) return cached.api;

  if (cached) {
    const previous = cached.api;
    cached = null;
    previous.close().catch(() => {});
  }

  const { db, dbPath } = openDatabase({ env });
  const api = createQueryApi(db, {
    initialize: async (sync) => {
      await migrate(sync);
      await seedDatabase(sync, env);
    },
  });
  cached = { path: dbPath, api };
  return api;
}

export function closeDatabase() {
  if (!cached) return Promise.resolve();
  const { api } = cached;
  cached = null;
  return api.close().catch(() => {});
}

export function resetDatabaseForTests() {
  return closeDatabase();
}

export async function databaseStatus(env = process.env) {
  try {
    const api = getDatabase(env);
    const path = resolveDbPath(env);
    const migrations = await api.get("SELECT COUNT(*) AS count FROM schema_migrations");
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
