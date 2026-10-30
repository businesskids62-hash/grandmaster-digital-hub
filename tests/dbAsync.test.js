import { test, after } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createQueryApi } from "../lib/db/sqliteAdapter.js";
import { MIGRATIONS, migrate } from "../lib/db/migrations.js";

const open = () => {
  const db = new DatabaseSync(":memory:");
  return createQueryApi(db);
};

after(() => {
  /* every adapter below owns its own in-memory database */
});

test("adapter methods return promises and resolve with the same rows", async () => {
  const api = open();
  await api.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT NOT NULL)");

  const insert = api.run("INSERT INTO t (name) VALUES (?)", ["alpha"]);
  assert.ok(insert instanceof Promise);
  const result = await insert;
  assert.equal(Number(result.changes), 1);

  const row = api.get("SELECT name FROM t WHERE id = ?", [1]);
  assert.ok(row instanceof Promise);
  assert.equal((await row).name, "alpha");

  const rows = api.all("SELECT name FROM t ORDER BY id");
  assert.ok(rows instanceof Promise);
  assert.deepEqual(
    (await rows).map((entry) => entry.name),
    ["alpha"],
  );

  await api.close();
});

test("lazy initialization runs exactly once for concurrent first calls", async () => {
  let calls = 0;
  const db = new DatabaseSync(":memory:");
  const api = createQueryApi(db, {
    initialize: async (sync) => {
      calls += 1;
      sync.exec("CREATE TABLE only_once (id INTEGER PRIMARY KEY)");
    },
  });

  await Promise.all([api.get("SELECT 1 AS one"), api.run("INSERT INTO only_once DEFAULT VALUES"), api.all("SELECT * FROM only_once")]);
  assert.equal(calls, 1);

  await api.close();
});

test("transaction commits all writes together", async () => {
  const api = open();
  await api.exec("CREATE TABLE ledger (id INTEGER PRIMARY KEY, amount INTEGER NOT NULL)");

  const returned = await api.transaction((tx) => {
    tx.run("INSERT INTO ledger (amount) VALUES (?)", [10]);
    tx.run("INSERT INTO ledger (amount) VALUES (?)", [20]);
    return "done";
  });

  assert.equal(returned, "done");
  assert.equal((await api.get("SELECT COUNT(*) AS c FROM ledger")).c, 2);
  await api.close();
});

test("transaction rolls back every write when the callback throws", async () => {
  const api = open();
  await api.exec("CREATE TABLE ledger (id INTEGER PRIMARY KEY, amount INTEGER NOT NULL)");

  await assert.rejects(
    api.transaction((tx) => {
      tx.run("INSERT INTO ledger (amount) VALUES (?)", [10]);
      throw new Error("boom");
    }),
    /boom/,
  );

  assert.equal((await api.get("SELECT COUNT(*) AS c FROM ledger")).c, 0);
  await api.close();
});

test("an async transaction callback is rejected and rolled back", async () => {
  const api = open();
  await api.exec("CREATE TABLE ledger (id INTEGER PRIMARY KEY, amount INTEGER NOT NULL)");

  await assert.rejects(
    api.transaction(async (tx) => {
      tx.run("INSERT INTO ledger (amount) VALUES (?)", [10]);
    }),
    /TRANSACTION_CALLBACK_MUST_BE_SYNC/,
  );

  assert.equal((await api.get("SELECT COUNT(*) AS c FROM ledger")).c, 0);
  await api.close();
});

test("nested transactions are rejected before they open", async () => {
  const api = open();
  await api.exec("CREATE TABLE ledger (id INTEGER PRIMARY KEY, amount INTEGER NOT NULL)");

  let nested = null;
  await api.transaction((tx) => {
    tx.run("INSERT INTO ledger (amount) VALUES (?)", [1]);
    nested = api.transaction(() => {
      throw new Error("must not run");
    });
  });

  await assert.rejects(nested, /NESTED_TRANSACTION_UNSUPPORTED/);
  assert.equal((await api.get("SELECT COUNT(*) AS c FROM ledger")).c, 1);
  await api.close();
});

test("unrelated calls cannot run SQL inside an open transaction", async () => {
  const api = open();
  await api.exec("CREATE TABLE ledger (id INTEGER PRIMARY KEY, amount INTEGER NOT NULL)");
  await api.exec("CREATE TABLE counter (id INTEGER PRIMARY KEY, value INTEGER NOT NULL)");
  await api.run("INSERT INTO counter (id, value) VALUES (1, 0)");

  // A concurrent writer plus a concurrent reader are started while the
  // transaction is in flight. The callback is synchronous, so it owns the
  // connection until COMMIT and neither task can touch it mid-transaction.
  const outsider = (async () => {
    for (let i = 0; i < 25; i += 1) {
      await api.run("UPDATE counter SET value = value + 1 WHERE id = 1");
    }
  })();
  const reader = (async () => {
    const seen = [];
    for (let i = 0; i < 25; i += 1) {
      seen.push((await api.get("SELECT COUNT(*) AS c FROM ledger")).c);
    }
    return seen;
  })();

  await api.transaction((tx) => {
    for (let i = 0; i < 10; i += 1) {
      tx.run("INSERT INTO ledger (amount) VALUES (?)", [i]);
    }
    tx.run("UPDATE counter SET value = value + 1000 WHERE id = 1");
  });

  await Promise.all([outsider, reader]);
  assert.equal((await api.get("SELECT COUNT(*) AS c FROM ledger")).c, 10);
  assert.equal((await api.get("SELECT value FROM counter WHERE id = 1")).value, 1025);
  await api.close();
});

test("concurrent transactions serialize without lost updates", async () => {
  const api = open();
  await api.exec("CREATE TABLE counter (id INTEGER PRIMARY KEY, value INTEGER NOT NULL)");
  await api.run("INSERT INTO counter (id, value) VALUES (1, 0)");

  await Promise.all(
    Array.from({ length: 40 }, () =>
      api.transaction((tx) => {
        const current = tx.get("SELECT value FROM counter WHERE id = 1").value;
        tx.run("UPDATE counter SET value = ? WHERE id = 1", [current + 1]);
      }),
    ),
  );

  assert.equal((await api.get("SELECT value FROM counter WHERE id = 1")).value, 40);
  await api.close();
});

test("migrations are idempotent when the initializer runs twice", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  const api = createQueryApi(db, {
    initialize: async (sync) => {
      await migrate(sync);
      await migrate(sync);
    },
  });

  const versions = (await api.all("SELECT version FROM schema_migrations")).map(
    (row) => row.version,
  );
  assert.deepEqual(versions, MIGRATIONS.map((entry) => entry.version));
  await api.close();
});

test("a rejected initialization is retried on the next call", async () => {
  const db = new DatabaseSync(":memory:");
  let calls = 0;
  const api = createQueryApi(db, {
    initialize: (sync) => {
      calls += 1;
      if (calls === 1) throw new Error("INIT_BOOM");
      sync.exec("CREATE TABLE retry_ok (id INTEGER PRIMARY KEY)");
    },
  });

  await assert.rejects(api.get("SELECT COUNT(*) AS c FROM retry_ok"), /INIT_BOOM/);
  assert.equal(calls, 1);

  assert.equal((await api.get("SELECT COUNT(*) AS c FROM retry_ok")).c, 0);
  assert.equal(calls, 2);
  await api.close();
});

test("a failed concurrent initialization is retried exactly once", async () => {
  const db = new DatabaseSync(":memory:");
  let calls = 0;
  const api = createQueryApi(db, {
    initialize: async (sync) => {
      calls += 1;
      if (calls === 1) throw new Error("INIT_BOOM");
      sync.exec("CREATE TABLE retry_wave (id INTEGER PRIMARY KEY)");
    },
  });

  const firstWave = await Promise.allSettled(
    Array.from({ length: 3 }, () => api.get("SELECT COUNT(*) AS c FROM retry_wave")),
  );
  assert.deepEqual(
    firstWave.map((entry) => entry.status),
    ["rejected", "rejected", "rejected"],
  );
  assert.equal(calls, 1);

  await Promise.all(
    Array.from({ length: 3 }, () => api.get("SELECT COUNT(*) AS c FROM retry_wave")),
  );
  assert.equal(calls, 2);
  await api.close();
});

test("a persistent initialization failure rejects every attempt", async () => {
  const db = new DatabaseSync(":memory:");
  let calls = 0;
  const api = createQueryApi(db, {
    initialize: () => {
      calls += 1;
      throw new Error("INIT_DOWN");
    },
  });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await assert.rejects(api.get("SELECT 1 AS one"), /INIT_DOWN/);
  }
  assert.equal(calls, 3);
  await api.close();
});
