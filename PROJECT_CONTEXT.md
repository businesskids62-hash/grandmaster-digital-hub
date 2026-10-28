# Grandmaster Digital Hub — Project Context

Last updated: 2026-10-28

This file is a debugging aid for humans and AI assistants. It lists structure,
ports and environment variable **names only** — never values. It does not grant
access to anything.

## Purpose

Grandmaster Digital Hub is a private AI operations dashboard: chat with a
provider-backed assistant, run agent workflows, inspect a 100-step roadmap,
track tasks and memory, monitor a read-only MT5 bridge, drive an approval-gated
browser operator, and check system health.

Honesty rules baked into the product:

- HTTP 200 from `/api/health` is **liveness only**. It does not prove AI,
  storage, MT5 or control authority works.
- System Doctor (virus scan / disk cleanup) is **simulated in the browser**. It
  has no filesystem or antivirus access and deletes nothing.
- MT5 is **demo-only, loopback-only, read-only**. Trading Safety is **LOCKED**;
  the UI cannot place orders or move money.
- UI status is not proof of backend health or deployment.

## Stack

| Layer | Technology |
| --- | --- |
| Frontend | React 18, Vite 6, single-page app with state-based routing in `src/App.jsx` |
| Local API | Node.js 24 (ESM), Express 5 (`server/server.js`) |
| Serverless API | Vercel Node functions in `api/` sharing logic from `lib/` |
| AI providers | `lib/aiProviders.js` (Gemini-compatible HTTP), retries, fallback model |
| Persistence | JSON stores under `GRANDMASTER_DATA_DIR` (`/tmp` on Vercel = ephemeral) |
| MT5 bridge | Python, standard library only (`mt5_bridge/bridge.py`), loopback |
| Tests | `node --test` suites in `tests/`, plus `scripts/test-suite.js` |
| Auth | Signed HttpOnly session cookie (`gm_session`), server-side control token |

## Ports

| Service | Port | Bind | Notes |
| --- | --- | --- | --- |
| API (Express) | 8000 | `127.0.0.1` | `PORT` / `HOST` override |
| Vite dev server | 5174 | localhost | `strictPort: true`; `/api` proxied to 8000 |
| MT5 bridge | 8765 | loopback | `MT5_BRIDGE_PORT` override |

The Vite app proxies `/api` to `VITE_API_TARGET` (default
`http://127.0.0.1:8000`). The loopback IP avoids the Windows `localhost` → `::1`
resolution mismatch.

## Folder structure

```
api/                  Vercel serverless adapters (thin; session + CORS + JSON)
  ai/, ai-status.js, auth/, chat.js, diagnostics.js,
  health/, health.js, providers.js, v1/
server/server.js      Local Express app; mirrors the api/ routes
lib/                  Shared backend logic
  aiProviders.js      Provider rotation, retries, budget, cached verification
  healthStatus.js     Readiness report, health rate limit
  subsystemHealth.js  AI / MT5 / storage subsystem reports
  logger.js           Structured event logging with codes and root causes
  diagnostics/        logStore.js, stack.js, report.js
  auth/               Signed session, login/logout routes
  operator/           Approval-gated browser operator
  tasks/, memory/, security/, storage/, integrations/, orchestrator/
src/
  App.jsx             Dashboard, navigation, health wiring, debug pack UI
  pages/              HealthPage, AgentDesks, Mt5Monitor, BrowserOperator, ...
  utils/              debugPack.js (masking, copy/download), wakeWord.js
  agents/             Browser-side agent simulations (incl. SystemDoctor)
  main.jsx            React entry
mt5_bridge/bridge.py  Read-only MT5 status bridge
scripts/              test-suite.js, check-health.mjs, load-test.mjs, verify-deployment.js
tests/                node:test regression suites
data/                 Local JSON data when GRANDMASTER_DATA_DIR is unset
dist/                 Production build output (generated)
vercel.json           API passthrough, SPA fallback (supports /health), security headers
```

## Start and stop

All commands run from the repository root.

| Goal | Command | Stop |
| --- | --- | --- |
| API + MT5 bridge + web (recommended) | `npm run dev` | `Ctrl+C` (concurrently kills all) |
| API only | `npm run dev:api` | `Ctrl+C` |
| MT5 bridge only | `npm run dev:mt5` | `Ctrl+C` |
| Web only (waits for API health) | `npm run dev:web` | `Ctrl+C` |
| API without npm wrapper | `npm run server` | `Ctrl+C` |
| Production build | `npm run build` | exits when done |
| Preview build | `npm run preview` | `Ctrl+C` |
| Health probe script | `npm run check` | exits when done |
| Tests | `npm test` | exits when done |
| Load test (opt-in) | `npm run test:load` | exits when done |
| Real operator connector (opt-in) | `npm run test:operator:real` | exits when done |

Startup order matters: `dev:web` waits for `http://127.0.0.1:8000/api/health`
(any 200–599) before starting Vite. `npm run dev` starts all three in parallel.

Prerequisites: Node.js 24+, Python 3 with a local MT5 terminal if the bridge is
used. A terminal that is not logged in leaves positions unavailable while the
bridge itself can still be reachable.

### Main routes

- UI: `http://127.0.0.1:5174/` (deep link `/health` supported by Vite SPA
  fallback and the `vercel.json` rewrite).
- Public liveness: `GET /api/health` (no session).
- Private readiness: `GET /api/health/readiness`.
- Private subsystems: `GET /api/health/ai`, `/api/health/mt5`, `/api/health/storage`.
- Private AI status: `GET /api/ai/status` (`?force=1` runs one bounded live check).
- Private chat: `POST /api/chat`.
- Private Phase 3 API: `/api/v1/*`.
- Private auth: `/api/auth/login`, `/api/auth/session`, `/api/auth/logout`.
- Private diagnostics: `GET /api/diagnostics?limit=50` (masked logs + statuses).

## Debugging tools

- **Health page** (`/health`): backend, AI provider, microphone and simulated
  Doctor status, each with a last-checked time. “Fresh check” re-reads readiness,
  forces one bounded live AI check and probes the read-only MT5 bridge.
- **Debug Pack** (Command Center): “Copy for Claude”, “Download Logs (.txt)” and
  “Download Logs (.json)”. It combines server diagnostics (last 50 log lines,
  active errors with codes, stack/package versions, cached service statuses)
  with browser-only state (mic permission, Doctor snapshot, UI session logs).
- **Log codes**: every server log entry gets `GM-<base36 time>-<seq><rand>`;
  every UI log entry gets `GMUI-<base36 time>-<seq><rand>`, plus `ts` and
  `rootCause`.
- **Masking**: API keys (`AIza…`, `sk-…`), Bearer tokens, `key=value` credential
  pairs, JWTs and 64-char hex digests are replaced before storage, copy or
  download. Secrets are never written to the log ring buffer.
- **Scope honesty**: server logs live in a process-local 500-entry ring buffer.
  Serverless instances are isolated and see only their own entries.

## Environment variables (names only)

Do not paste values into issues, chat or logs.

**Core server**

- `PORT`, `HOST`
- `GRANDMASTER_DATA_DIR`
- `GRANDMASTER_CONTROL_TOKEN`
- `GRANDMASTER_UI_PASSWORD`, `GRANDMASTER_SESSION_SECRET`
- `AUTH_RATE_LIMIT_PER_MINUTE`
- `GRANDMASTER_RATE_LIMIT_PER_MINUTE`, `RATE_LIMIT_PER_MINUTE`
- `GRANDMASTER_LOG_SILENT`
- `CORS_ALLOWED_ORIGINS` (also accepts `CORS_ORIGIN`)

**Health and diagnostics**

- `HEALTH_RATE_LIMIT_PER_MINUTE`

**AI providers**

- `AI_PROVIDERS`
- `AI_MODEL`, `AI_FALLBACK_MODEL`
- `GEMINI_MODEL`, `GEMINI_FALLBACK_MODEL`
- `GEMINI_API_KEY`
- `AI_RATE_LIMIT_PER_MINUTE`
- `AI_RESPONSE_CACHE_TTL_MS`
- `AI_MAX_CONCURRENCY`

**MT5 bridge**

- `MT5_BRIDGE_URL`, `MT5_BRIDGE_PORT`
- `MT5_SYMBOL`, `MT5_STALE_SECONDS`, `MT5_TERMINAL_PATH`

**Browser operator**

- `GRANDMASTER_OPERATOR_USERS`
- `GRANDMASTER_OPERATOR_ALLOWED_HOSTS`
- `GRANDMASTER_OPERATOR_ALLOW_LOOPBACK`
- `GRANDMASTER_OPERATOR_APPROVAL_TTL_MINUTES`
- `GRANDMASTER_OPERATOR_IDLE_TTL_MINUTES`
- `GRANDMASTER_OPERATOR_MAX_RUNS`, `GRANDMASTER_OPERATOR_MAX_SESSIONS`
- `GRANDMASTER_OPERATOR_TIMEOUT_MS`, `GRANDMASTER_OPERATOR_BROWSER_CHANNEL`
- `GRANDMASTER_OPERATOR_REAL_TEST` (opt-in real connector test only)

**Frontend / build**

- `VITE_API_URL` (browser API base; empty means same origin)
- `VITE_API_TARGET` (Vite dev proxy target)
- `VERCEL_GIT_COMMIT_SHA` (build label only)
- `VERCEL` (runtime platform flag, set by Vercel)

**Scripts**

- `API_HEALTH_URL`, `CHECK_TIMEOUT_MS` (health check script)

## Known issues and limits

1. **Production CORS is fail-closed.** If `CORS_ALLOWED_ORIGINS` is unset in
   production, any request with an `Origin` header gets 403. This is the top
   deployment blocker and must be configured per environment.
2. **Serverless storage is ephemeral.** On Vercel the JSON stores use `/tmp`,
   which is per-instance and not durable. Use durable storage before relying on
   task/memory/audit data in production.
3. **System Doctor is simulated.** Virus scan and disk cleanup report simulated
   results; no real scan, deletion or antivirus integration exists.
4. **Microphone needs a secure context.** Wake word and mic status require
   `localhost` or HTTPS, browser permission, and a browser with the Web Speech
   API (Chromium-based browsers). Firefox lacks `SpeechRecognition`.
5. **MT5 is read-only and loopback-only.** The bridge never sends orders. Live
   positions stay unavailable if the MT5 terminal is not authenticated, even
   when the bridge answers. Trading Safety remains LOCKED.
6. **Rate limits are per instance.** In serverless deployments the in-memory
   rate limiters are a safety net, not a durable quota.
7. **Diagnostics logs are process-local.** The 500-entry ring buffer is not
   persisted and does not aggregate across serverless instances.
8. **AI providers can be unavailable.** Quota, auth, model availability and
   timeouts surface as explicit error codes (`AI_QUOTA_EXCEEDED`,
   `AI_AUTH_FAILED`, `AI_MODEL_UNAVAILABLE`, `AI_TIMEOUT`, `ALL_PROVIDERS_FAILED`).
9. **Auth is required for private routes.** Without `GRANDMASTER_UI_PASSWORD`
   and `GRANDMASTER_SESSION_SECRET` the UI shows “auth not configured” (503) and
   private endpoints refuse access.
10. **Roadmap checkboxes are local.** They track intent in `localStorage`; they
    do not inspect source code or verify deployments.

## Verification commands

```bash
npm test            # test-suite preflight + node --test suites
npm run build       # production build
npm run check       # probes the local health endpoint
```
