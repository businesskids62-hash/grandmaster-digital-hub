import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("../", import.meta.url);
const read = (relative) => fs.readFileSync(new URL(relative, root), "utf8");
const ORIGIN = "https://grandmaster.test";
const ACADEMY_HTML = "<title>Grandmaster Academy</title>";
const OFFLINE_HTML = "<title>offline</title>";

const manifest = JSON.parse(read("public/manifest.webmanifest"));

test("manifest identifies the Hub, so an installed shortcut opens /", () => {
  assert.equal(manifest.id, "/");
  assert.equal(manifest.start_url, "/");
  assert.equal(manifest.scope, "/");
  assert.equal(manifest.name, "Grandmaster Digital Hub");
});

test("manifest keeps the installable shell settings and icons", () => {
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.theme_color, "#0b1220");
  assert.ok(manifest.icons.length >= 3);
  assert.ok(manifest.icons.some((icon) => icon.purpose === "maskable"));
});

test("router sends / to the Hub and /academy to the Academy", () => {
  const main = read("src/main.jsx");
  assert.match(main, /const academyPaths = \[[^\]]*["']\/academy["']/);
  assert.doesNotMatch(main, /const academyPaths = \[[^\]]*["']\/["']/);
  assert.match(main, /isAcademy \? <AcademyApp \/> : <App \/>/);
});

test("academy registers the worker with an /academy scope", () => {
  const src = read("src/academy/AcademyApp.jsx");
  assert.match(src, /register\("\/sw\.js",\s*\{\s*scope:\s*"\/academy"\s*\}\)/);
});

test("worker never keys cached navigations on a fixed academy URL", () => {
  const sw = read("public/sw.js");
  assert.doesNotMatch(sw, /cache\.put\("\/academy"/);
  assert.doesNotMatch(sw, /caches\.match\("\/academy"\)/);
  assert.equal(sw.includes('CACHE_NAME = "gm-academy-v2"'), true);
  assert.equal(sw.includes('OFFLINE_URL = "/offline.html"'), true);
});

function harness(scope) {
  const listeners = new Map();
  const stores = new Map();
  const calls = { put: [], addAll: [], unregister: 0, claim: 0 };
  const normalized = (key) => new URL(String(key), ORIGIN).href;

  const open = async (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const store = stores.get(name);
    return {
      put: async (key, value) => {
        calls.put.push(String(key));
        store.set(normalized(key), value);
      },
      addAll: async (urls) => {
        calls.addAll.push([...urls]);
      },
      match: async (key) => store.get(normalized(key)),
    };
  };

  const caches = {
    open,
    keys: async () => [...stores.keys()],
    delete: async (name) => stores.delete(name),
    match: async (key) => {
      for (const store of stores.values()) {
        if (store.has(normalized(key))) return store.get(normalized(key));
      }
      return undefined;
    },
  };

  const self = {
    location: { origin: ORIGIN },
    registration: {
      scope,
      unregister: async () => {
        calls.unregister += 1;
      },
    },
    skipWaiting: async () => {},
    clients: {
      claim: async () => {
        calls.claim += 1;
      },
    },
    addEventListener: (type, handler) => listeners.set(type, handler),
  };

  return { listeners, stores, calls, self, caches };
}

const original = { self: globalThis.self, caches: globalThis.caches, fetch: globalThis.fetch };

async function loadWorker(t, scope) {
  const h = harness(scope);
  globalThis.self = h.self;
  globalThis.caches = h.caches;
  const swUrl = new URL("public/sw.js", root);
  await import(`${swUrl.href}?case=${scope}-${Math.random()}`);
  t.after(() => {
    globalThis.self = original.self;
    globalThis.caches = original.caches;
    globalThis.fetch = original.fetch;
  });
  return h;
}

function preload(h, entries) {
  const store = new Map();
  for (const [key, html] of Object.entries(entries)) {
    store.set(
      new URL(key, ORIGIN).href,
      new Response(html, { headers: { "content-type": "text/html" } }),
    );
  }
  h.stores.set("gm-academy-v2", store);
}

function navigate(h, pathname) {
  const state = { responded: false, response: undefined };
  h.listeners.get("fetch")({
    request: { method: "GET", mode: "navigate", url: `${ORIGIN}${pathname}` },
    respondWith(promise) {
      state.responded = true;
      state.response = promise;
    },
  });
  return state;
}

test("hub navigation is not intercepted, even with an academy cache present", async (t) => {
  const h = await loadWorker(t, `${ORIGIN}/academy`);
  preload(h, { "/academy": ACADEMY_HTML, "/offline.html": OFFLINE_HTML });
  globalThis.fetch = async () => {
    throw new Error("offline");
  };

  for (const pathname of ["/", "/health", "/privacy"]) {
    const state = navigate(h, pathname);
    assert.equal(state.responded, false, `${pathname} must stay on the network`);
  }
  assert.deepEqual(h.calls.put, []);
});

test("offline academy navigation falls back to offline.html, not a cached shell", async (t) => {
  const h = await loadWorker(t, `${ORIGIN}/academy`);
  preload(h, { "/academy": ACADEMY_HTML, "/offline.html": OFFLINE_HTML });
  globalThis.fetch = async () => {
    throw new Error("offline");
  };

  const state = navigate(h, "/academy/courses/42");
  assert.equal(state.responded, true);
  const body = await (await state.response).text();
  assert.equal(body, OFFLINE_HTML);
});

test("offline academy navigation reuses only its own cached page", async (t) => {
  const h = await loadWorker(t, `${ORIGIN}/academy`);
  preload(h, { "/academy": ACADEMY_HTML, "/offline.html": OFFLINE_HTML });
  globalThis.fetch = async () => {
    throw new Error("offline");
  };

  const body = await (await navigate(h, "/academy").response).text();
  assert.equal(body, ACADEMY_HTML);
});

test("online academy navigation is returned and cached under its own URL", async (t) => {
  const h = await loadWorker(t, `${ORIGIN}/academy`);
  globalThis.fetch = async () =>
    new Response(ACADEMY_HTML, { headers: { "content-type": "text/html" } });

  const body = await (await navigate(h, "/academy/progress").response).text();
  assert.equal(body, ACADEMY_HTML);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(h.calls.put, [`${ORIGIN}/academy/progress`]);
});

test("api traffic is never intercepted or cached", async (t) => {
  const h = await loadWorker(t, `${ORIGIN}/academy`);
  const state = { responded: false };
  h.listeners.get("fetch")({
    request: { method: "GET", mode: "cors", url: `${ORIGIN}/api/academy/courses` },
    respondWith() {
      state.responded = true;
    },
  });
  assert.equal(state.responded, false);
  assert.deepEqual(h.calls.put, []);
});

test("worker running at root scope removes itself instead of claiming the Hub", async (t) => {
  const h = await loadWorker(t, `${ORIGIN}/`);
  const pending = [];
  h.listeners.get("activate")({ waitUntil: (promise) => pending.push(promise) });
  await Promise.all(pending);

  assert.equal(h.calls.unregister, 1);
  assert.equal(h.calls.claim, 0);
});

test("academy-scoped activation purges old caches and claims clients", async (t) => {
  const h = await loadWorker(t, `${ORIGIN}/academy`);
  h.stores.set("gm-academy-v1", new Map());
  const pending = [];
  h.listeners.get("activate")({ waitUntil: (promise) => pending.push(promise) });
  await Promise.all(pending);

  assert.equal(h.stores.has("gm-academy-v1"), false);
  assert.equal(h.calls.unregister, 0);
  assert.equal(h.calls.claim, 1);
});

test("install pre-caches the academy shell and the offline page", async (t) => {
  const h = await loadWorker(t, `${ORIGIN}/academy`);
  const pending = [];
  h.listeners.get("install")({ waitUntil: (promise) => pending.push(promise) });
  await Promise.all(pending);

  assert.equal(h.calls.addAll.length, 1);
  assert.ok(h.calls.addAll[0].includes("/academy"));
  assert.ok(h.calls.addAll[0].includes("/offline.html"));
});
