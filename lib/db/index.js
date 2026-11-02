import { createQueryApi as createSqliteQueryApi, openDatabase as openSqliteDatabase, resolveDbPath as resolveSqliteDbPath } from "./sqliteAdapter.js";
import { createQueryApi as createPostgresQueryApi, openDatabase as openPostgresDatabase, resolveDatabaseUrl, isPostgresUrl } from "./postgresAdapter.js";
import { migrate } from "./migrations.js";
import { seedDatabase } from "./seed.js";

let cached = null;

export function isPostgres(env = process.env) {
  return isPostgresUrl(env?.DATABASE_URL);
}

export function resolveDbPath(env = process.env) {
  if (isPostgres(env)) return resolveDatabaseUrl(env);
  return resolveSqliteDbPath(env);
}

export function getDatabase(env = process.env) {
  const target = resolveDbPath(env);
  if (cached && cached.path === target) return cached.api;

  if (cached) {
    const previous = cached.api;
    cached = null;
    previous.close().catch(() => {});
  }

  const postgres = isPostgres(env);
  const { db, dbPath } = postgres
    ? openPostgresDatabase({ env })
    : openSqliteDatabase({ env });
  const api = postgres
    ? createPostgresQueryApi(db, { initialize: async (sync) => { await migrate(sync); await seedDatabase(sync, env); } })
    : createSqliteQueryApi(db, { initialize: async (sync) => { await migrate(sync); await seedDatabase(sync, env); } });
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
      engine: isPostgres(env) ? "postgres" : "sqlite",
      durable: isPostgres(env) ? true : !env?.VERCEL,
      ephemeral: isPostgres(env) ? false : Boolean(env?.VERCEL),
      path: isPostgres(env) ? null : path,
      migrations: Number(migrations?.count || 0),
    };
  } catch {
    return {
      ok: false,
      engine: isPostgres(env) ? "postgres" : "sqlite",
      durable: false,
      ephemeral: isPostgres(env) ? false : Boolean(env?.VERCEL),
      path: null,
      migrations: 0,
      error: "DATABASE_UNAVAILABLE",
    };
  }
}
