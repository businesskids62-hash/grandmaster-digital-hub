import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "grandmaster-memory-"));
const restartDir = fs.mkdtempSync(path.join(os.tmpdir(), "grandmaster-memory-restart-"));
const capDir = fs.mkdtempSync(path.join(os.tmpdir(), "grandmaster-memory-cap-"));

process.env.GRANDMASTER_DATA_DIR = dataDir;
process.env.GRANDMASTER_CONTROL_TOKEN = "memory-control-token-1234567890";
process.env.GRANDMASTER_LOG_SILENT = "1";
process.env.GRANDMASTER_RATE_LIMIT_PER_MINUTE = "10000";
process.env.AI_PROVIDERS = "gemini:test-model";
delete process.env.GEMINI_API_KEY;
delete process.env.AI_API_KEY;
delete process.env.GEMINI_MODEL;
delete process.env.GEMINI_FALLBACK_MODEL;

const { handleV1, resetRateLimits } = await import("../lib/api/v1.js");
const { MemoryStore } = await import("../lib/memory/memoryStore.js");
const { JsonStore } = await import("../lib/storage/jsonStore.js");

const TOKEN = "memory-control-token-1234567890";
const authorized = { "x-grandmaster-token": TOKEN };
let sequence = 0;

async function call(method, requestPath, options = {}) {
  sequence += 1;
  return handleV1({
    method,
    path: requestPath,
    query: options.query || {},
    headers: {
      "x-request-id": `memory-request-${sequence}`,
      ...(options.headers || {}),
    },
    body: options.body,
    env: options.env || process.env,
    clientKey: `memory-client-${sequence}`,
  });
}

after(() => {
  for (const dir of [dataDir, restartDir, capDir]) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("memory reads and mutations require authorization and missing updates return 404", async () => {
  resetRateLimits();

  const deniedRead = await call("GET", "/memory");
  assert.equal(deniedRead.status, 403);
  assert.equal(deniedRead.body.error.code, "APPROVAL_REQUIRED");

  const deniedCreate = await call("POST", "/memory", {
    body: { text: "unauthorized-memory-marker", category: "preference" },
  });
  assert.equal(deniedCreate.status, 403);
  assert.equal(deniedCreate.body.error.code, "APPROVAL_REQUIRED");

  const deniedUpdate = await call("PATCH", "/memory/missing-id", {
    body: { text: "changed" },
  });
  assert.equal(deniedUpdate.status, 403);
  assert.equal(deniedUpdate.body.error.code, "APPROVAL_REQUIRED");

  const missingUpdate = await call("PATCH", "/memory/missing-id", {
    headers: authorized,
    body: { text: "changed" },
  });
  assert.equal(missingUpdate.status, 404);
  assert.equal(missingUpdate.body.error.code, "MEMORY_NOT_FOUND");

  const missingDelete = await call("DELETE", "/memory/missing-id", {
    headers: authorized,
  });
  assert.equal(missingDelete.status, 404);
  assert.equal(missingDelete.body.error.code, "MEMORY_NOT_FOUND");
});

test("memory list reads reject missing and invalid tokens without leaking contents", async () => {
  resetRateLimits();
  const text = "leak-check-memory-marker";
  const created = await call("POST", "/memory", {
    headers: authorized,
    body: { text, category: "project", tags: ["leak"] },
  });
  assert.equal(created.status, 201);

  const missing = await call("GET", "/memory", {
    query: { limit: "50", q: "leak-check" },
  });
  assert.equal(missing.status, 403);
  assert.equal(missing.body.error.code, "APPROVAL_REQUIRED");
  assert.equal(JSON.stringify(missing.body).includes(text), false);
  assert.equal(JSON.stringify(missing.body).includes(TOKEN), false);

  const invalid = await call("GET", "/memory", {
    headers: { "x-grandmaster-token": "invalid-memory-token-000000" },
  });
  assert.equal(invalid.status, 403);
  assert.equal(invalid.body.error.code, "INVALID_CONTROL_TOKEN");
  assert.equal(JSON.stringify(invalid.body).includes(text), false);
  assert.equal(JSON.stringify(invalid.body).includes(TOKEN), false);

  const unconfigured = await call("GET", "/memory", {
    headers: authorized,
    env: { ...process.env, GRANDMASTER_CONTROL_TOKEN: "" },
  });
  assert.equal(unconfigured.status, 503);
  assert.equal(
    unconfigured.body.error.code,
    "APPROVAL_AUTHORITY_NOT_CONFIGURED",
  );
  assert.equal(JSON.stringify(unconfigured.body).includes(text), false);

  const allowed = await call("GET", "/memory", {
    headers: authorized,
    query: { limit: "50" },
  });
  assert.equal(allowed.status, 200);
  assert.ok(Array.isArray(allowed.body.data.memories));
  assert.ok(Array.isArray(allowed.body.data.categories));
  assert.ok(allowed.body.data.stats);
  assert.ok(allowed.body.data.storage);
  assert.ok(
    allowed.body.data.memories.some((item) => item.id === created.body.data.memory.id),
  );
});

test("authorized search and category filters return only matching memories", async () => {
  resetRateLimits();
  const preferenceText = "filter-preference-marker-alpha";
  const goalText = "filter-goal-marker-beta";

  const preference = await call("POST", "/memory", {
    headers: authorized,
    body: { text: preferenceText, category: "preference" },
  });
  const goal = await call("POST", "/memory", {
    headers: authorized,
    body: { text: goalText, category: "goal" },
  });
  assert.equal(preference.status, 201);
  assert.equal(goal.status, 201);

  const byQuery = await call("GET", "/memory", {
    headers: authorized,
    query: { q: "filter-goal-marker" },
  });
  assert.equal(byQuery.status, 200);
  const queryIds = byQuery.body.data.memories.map((item) => item.id);
  assert.ok(queryIds.includes(goal.body.data.memory.id));
  assert.equal(queryIds.includes(preference.body.data.memory.id), false);

  const byCategory = await call("GET", "/memory", {
    headers: authorized,
    query: { category: "preference", limit: "100" },
  });
  assert.equal(byCategory.status, 200);
  const categoryIds = byCategory.body.data.memories.map((item) => item.id);
  assert.ok(categoryIds.includes(preference.body.data.memory.id));
  assert.equal(categoryIds.includes(goal.body.data.memory.id), false);
  assert.ok(
    byCategory.body.data.memories.every((item) => item.category === "preference"),
  );

  const deniedSearch = await call("GET", "/memory", {
    query: { q: "filter-preference-marker" },
  });
  assert.equal(deniedSearch.status, 403);
  assert.equal(JSON.stringify(deniedSearch.body).includes(preferenceText), false);
  assert.equal(JSON.stringify(deniedSearch.body).includes(goalText), false);
});

test("invalid categories, secrets and duplicate updates are rejected", async () => {
  const invalidCategory = await call("POST", "/memory", {
    headers: authorized,
    body: { text: "invalid-category-marker", category: "not-a-category" },
  });
  assert.equal(invalidCategory.status, 400);
  assert.equal(invalidCategory.body.error.code, "MEMORY_CATEGORY_INVALID");

  const secret = await call("POST", "/memory", {
    headers: authorized,
    body: {
      text: "api key is AIzaSyMEMORYFAKE123456789012345678901",
      category: "preference",
    },
  });
  assert.equal(secret.status, 400);
  assert.equal(secret.body.error.code, "MEMORY_SECRET_REJECTED");

  const first = await call("POST", "/memory", {
    headers: authorized,
    body: { text: "duplicate-update-marker-one", category: "goal" },
  });
  const second = await call("POST", "/memory", {
    headers: authorized,
    body: { text: "duplicate-update-marker-two", category: "goal" },
  });
  assert.equal(first.status, 201);
  assert.equal(second.status, 201);

  const duplicate = await call("PATCH", `/memory/${second.body.data.memory.id}`, {
    headers: authorized,
    body: {
      text: "duplicate-update-marker-one",
      category: "goal",
    },
  });
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.error.code, "MEMORY_DUPLICATE");
});

test("tag and source limits are enforced on creation", async () => {
  const tags = Array.from({ length: 10 }, (_, index) => `${index}-${"t".repeat(40)}`);
  const source = "s".repeat(200);

  const created = await call("POST", "/memory", {
    headers: authorized,
    body: {
      text: "tag-and-source-limit-marker",
      category: "preference",
      tags,
      source,
    },
  });
  assert.equal(created.status, 201);
  const memory = created.body.data.memory;
  assert.equal(memory.tags.length, 8);
  assert.ok(memory.tags.every((tag) => tag.length <= 30));
  assert.equal(memory.source.length, 120);
});

test("the 300-item limit evicts the oldest memory", async () => {
  const capEnv = { GRANDMASTER_DATA_DIR: capDir };
  const capStore = new MemoryStore(
    capEnv,
    new JsonStore("memory", { env: capEnv }),
  );

  let firstId = null;
  let lastId = null;
  for (let index = 0; index <= 300; index += 1) {
    const result = await capStore.create({
      text: `cap-marker-${index}`,
      category: "project",
    });
    if (index === 0) firstId = result.item.id;
    lastId = result.item.id;
  }

  assert.equal(capStore.stats().total, 300);
  assert.equal(capStore.get(firstId), null);
  assert.equal(capStore.get(lastId).text, "cap-marker-300");
});

test("storage status reports durable mode and safe in-memory fallback", async () => {
  const durableEnv = { GRANDMASTER_DATA_DIR: dataDir };
  const durableStore = new MemoryStore(
    durableEnv,
    new JsonStore("memory", { env: durableEnv }),
  );
  const durableStatus = durableStore.status();
  assert.equal(durableStatus.mode, "durable");
  assert.equal(durableStatus.durable, true);
  assert.equal(durableStatus.writable, true);
  assert.ok(durableStatus.path.endsWith("memory.json"));

  const blockedPath = path.join(dataDir, "blocked-data-directory");
  fs.writeFileSync(blockedPath, "not a directory", "utf8");
  const blockedEnv = { GRANDMASTER_DATA_DIR: blockedPath };
  const fallbackStore = new MemoryStore(
    blockedEnv,
    new JsonStore("memory", { env: blockedEnv }),
  );
  const fallbackStatus = fallbackStore.status();
  assert.equal(fallbackStatus.mode, "memory");
  assert.equal(fallbackStatus.writable, false);
  assert.ok(fallbackStatus.error);

  await fallbackStore.create({
    text: "fallback-marker",
    category: "preference",
  });
  assert.equal(fallbackStore.list({ query: "fallback-marker" }).length, 1);
});

test("memory survives a separate Node process restart", () => {
  const moduleUrl = pathToFileURL(
    path.resolve("lib/memory/memoryStore.js"),
  ).href;
  const childEnv = {
    ...process.env,
    GRANDMASTER_DATA_DIR: restartDir,
    GRANDMASTER_LOG_SILENT: "1",
  };
  const marker = "restart-persistence-marker";

  const createScript = `
    const { memoryStore } = await import(${JSON.stringify(moduleUrl)});
    const result = await memoryStore.create({
      text: ${JSON.stringify(marker)},
      category: "project",
      tags: ["restart"],
    });
    const status = memoryStore.status();
    console.log(JSON.stringify({
      id: result.item.id,
      text: result.item.text,
      mode: status.mode,
      path: status.path,
    }));
  `;
  const first = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", createScript],
    { env: childEnv, encoding: "utf8" },
  );
  assert.equal(first.status, 0, first.stderr || first.stdout);
  const firstPayload = JSON.parse(
    first.stdout.trim().split(/\r?\n/).pop(),
  );
  assert.equal(firstPayload.mode, "durable");
  assert.ok(firstPayload.path.startsWith(restartDir));

  const readScript = `
    const { memoryStore } = await import(${JSON.stringify(moduleUrl)});
    const rows = memoryStore.list({ query: ${JSON.stringify(marker)} });
    const status = memoryStore.status();
    console.log(JSON.stringify({
      count: rows.length,
      id: rows[0]?.id || null,
      text: rows[0]?.text || null,
      mode: status.mode,
    }));
  `;
  const second = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", readScript],
    { env: childEnv, encoding: "utf8" },
  );
  assert.equal(second.status, 0, second.stderr || second.stdout);
  const secondPayload = JSON.parse(
    second.stdout.trim().split(/\r?\n/).pop(),
  );
  assert.equal(secondPayload.count, 1);
  assert.equal(secondPayload.id, firstPayload.id);
  assert.equal(secondPayload.text, marker);
  assert.equal(secondPayload.mode, "durable");
});

test("successful memory mutations are audited without text or tokens", async () => {
  resetRateLimits();
  const text = "audit-memory-marker";

  const created = await call("POST", "/memory", {
    headers: authorized,
    body: { text, category: "instruction" },
  });
  assert.equal(created.status, 201);
  const memoryId = created.body.data.memory.id;

  const patched = await call("PATCH", `/memory/${memoryId}`, {
    headers: authorized,
    body: { text: `${text}-updated` },
  });
  assert.equal(patched.status, 200);

  const deleted = await call("DELETE", `/memory/${memoryId}`, {
    headers: authorized,
  });
  assert.equal(deleted.status, 200);

  const audit = await call("GET", "/audit", {
    headers: authorized,
    query: { limit: "100" },
  });
  assert.equal(audit.status, 200);

  const actions = audit.body.data.events.map((event) => event.action);
  for (const action of [
    "memory.created",
    "memory.updated",
    "memory.deleted",
  ]) {
    assert.ok(actions.includes(action), `audit must contain ${action}`);
  }

  const createdEvent = audit.body.data.events.find(
    (event) =>
      event.action === "memory.created" && event.meta?.memoryId === memoryId,
  );
  assert.ok(createdEvent);
  assert.equal(createdEvent.meta.text, undefined);
  assert.equal(JSON.stringify(audit.body).includes(TOKEN), false);
});
