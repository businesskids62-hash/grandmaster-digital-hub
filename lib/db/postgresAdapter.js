import { Pool } from "@neondatabase/serverless";

export function isPostgresUrl(value) {
  return /^postgres(ql)?:\/\//i.test(String(value || "").trim());
}

export function resolveDatabaseUrl(env = process.env) {
  const url = String(env?.DATABASE_URL || "").trim();
  return isPostgresUrl(url) ? url : null;
}

export function openDatabase({ env = process.env } = {}) {
  const connectionString = resolveDatabaseUrl(env);
  if (!connectionString) throw new Error("DATABASE_URL must be a postgres:// or postgresql:// URL");
  const pool = new Pool({ connectionString });
  return { db: pool, dbPath: connectionString };
}

export function createQueryApi(pool, { initialize = null } = {}) {
  let initPromise = null;
  function ready() {
    if (!initPromise) {
      initPromise = (async () => {
        if (typeof initialize === "function") await initialize(sync);
      })().catch((error) => { initPromise = null; throw error; });
    }
    return initPromise;
  }
  const sync = {
    async exec(sql) { await pool.query(sql); },
    async run(sql, params = []) { const r = await pool.query(sql, params); return { changes: r.rowCount || 0, lastInsertRowid: null }; },
    async get(sql, params = []) { const r = await pool.query(sql, params); return r.rows[0]; },
    async all(sql, params = []) { const r = await pool.query(sql, params); return r.rows; },
    async transaction(fn) {
      await ready();
      const client = await pool.connect();
      const tx = {
        async exec(sql) { await client.query(sql); },
        async run(sql, params = []) { const r = await client.query(sql, params); return { changes: r.rowCount || 0, lastInsertRowid: null }; },
        async get(sql, params = []) { const r = await client.query(sql, params); return r.rows[0]; },
        async all(sql, params = []) { const r = await client.query(sql, params); return r.rows; },
        transaction() { throw new Error("NESTED_TRANSACTION_UNSUPPORTED"); },
      };
      await client.query("BEGIN");
      try {
        const result = fn(tx);
        if (result && typeof result.then === "function") await result;
        await client.query("COMMIT");
        return result;
      } catch (error) {
        try { await client.query("ROLLBACK"); } catch {}
        throw error;
      } finally { client.release(); }
    },
  };
  return {
    ready,
    async exec(sql) { await ready(); return sync.exec(sql); },
    async run(sql, params = []) { await ready(); return sync.run(sql, params); },
    async get(sql, params = []) { await ready(); return sync.get(sql, params); },
    async all(sql, params = []) { await ready(); return sync.all(sql, params); },
    async transaction(fn) {
      await ready();
      if (typeof fn !== "function") throw new Error("TRANSACTION_CALLBACK_REQUIRED");
      return sync.transaction(fn);
    },
    async close() { try { await pool.end(); } catch {} },
  };
}
