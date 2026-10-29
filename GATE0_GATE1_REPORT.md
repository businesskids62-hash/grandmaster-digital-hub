# Gate 0 / Gate 1 Report — Phase 1 Academy

Date: 2026-10-29
Branch: `phase1-academy`
Base commit: `8afb50d` (working tree had 47 uncommitted changes)
Backup branch: `backup/before-phase1` (local commit `fcda68a`; not pushed)

No push, no deploy, no production env changes, no real email, no payment and no
trading/MT5 change was made in this phase.

## Gate 0 — preserved baseline

| Check | Result |
| --- | --- |
| Existing working tree preserved (backup branch before work) | pass |
| `npm test` before changes | 159/159 pass |
| `npm run build` before changes | pass |
| Secrets committed | none (`.env` remains ignored) |
| Education-only and MT5-hidden rules | kept in every academy screen |

## What was built

### STEP 2 — Per-user accounts

- Email + password accounts with bcrypt hashes (`lib/auth/passwords.js`);
  minimum password length 10; plaintext is never stored or logged.
- Signed HttpOnly session cookie (`gm_session`, SameSite=Strict, Secure in
  production). v2 tokens carry user id + `session_version`; password change,
  reset and account deletion bump the version and kill old sessions.
- Roles `admin` and `student`. Server gates:
  - `sessionGate` / `requireSession` default to **admin only** (403
    `ROLE_FORBIDDEN`).
  - `academyGate` / `requireSession({role:"any"})` allows any account.
- Signup, login, logout, change password, forgot/reset password (single-use,
  30-minute, sha256-at-rest token; `devResetToken` returned only outside
  production), account delete (password re-check, personal data removed, audit
  rows detached from identity).
- Login rate limiting per client (env-tunable) plus per-account backoff:
  5 failures → 5-minute lock doubling to 30 minutes. Unknown emails run a dummy
  bcrypt compare and return the same generic error as a wrong password.
- Owner migration: the legacy shared password still works **only while
  `ADMIN_EMAIL` is unset**; existing v1 admin sessions stay valid until expiry.
  No lockout path for the owner.

### STEP 3 — Persistent database

- `node:sqlite` (built in, no native build) with a thin `lib/db` adapter so a
  hosted Postgres/Supabase driver can replace it later.
- Versioned migrations (`schema_migrations`): `users`, `password_resets`,
  `courses`, `lessons`, `quizzes`, `questions`, `quiz_attempts`, `progress`,
  `audit_log`, indexes, foreign keys with `ON DELETE CASCADE`.
- Idempotent seed: admin from `ADMIN_EMAIL` / `ADMIN_PASSWORD`; course
  "Trading Basics" with 3 lessons and 1 quiz of 5 questions + explanations.
- All queries are parameterized. DB path: `GRANDMASTER_DB_PATH` →
  `GRANDMASTER_DATA_DIR/academy.db` → `/tmp/grandmaster-data/academy.db` on
  Vercel → `./data/academy.db` locally.

### STEP 4 — Academy features

- Course list, course detail, lesson viewer with "Mark complete", quiz engine
  with **server-side scoring**, per-question explanation, attempt history,
  progress page (percent, streak, last activity) and profile page.
- Quiz answers are never sent before submission; correct index and explanation
  appear only in the attempt result.
- All academy text lives in `src/academy/strings.js` (single locale now;
  Urdu/Roman Urdu can be added as more keys).

### STEP 5 — Mobile-first and PWA

- 390–430px-first layout, 44px+ targets (measured 51px inputs, 53px nav items),
  no horizontal scroll, safe-area insets, bottom nav (Courses, Progress,
  Profile), light/dark/system theme, API base from `VITE_API_URL` (no
  localhost dependency for Capacitor wrapping).
- `public/manifest.webmanifest`, `public/sw.js` (never caches `/api/`),
  `public/offline.html`, PNG icons (192/512/maskable/apple-touch), manifest and
  theme-color in `index.html`. Service worker registers in production builds
  only.

### STEP 6 — Safety and privacy surfaces

- Disclaimer on landing, courses, lessons and quiz results:
  "Educational content only. Not financial advice. Trading involves risk of
  loss."
- Privacy Policy, Terms of Use, Support and Delete Account info pages at
  `/privacy`, `/terms`, `/support` (text is clearly marked placeholder).
- CSRF double-submit cookie (`gm_csrf` + `X-CSRF-Token`) on academy/account
  mutations for v2 sessions; SameSite=Strict retained.
- Audit log for signup, login, failed login, logout, password change/reset,
  lesson completion, quiz attempt and account deletion; only allow-listed
  detail keys, never passwords or tokens.
- Existing security headers and CORS allow-list unchanged.

### STEP 7 — Tests

| Suite | Before | After |
| --- | --- | --- |
| `npm test` total | 159 | **175** (all pass) |
| `npm run build` | pass | **pass** |
| 390×844 browser checks | — | **20/20 pass** |

`tests/academy.test.js` (16 tests) covers: migrations/seed, bcrypt hashing and
minimum length, signup (duplicate leak, weak password, invalid email),
login/session/logout, generic credential errors, token tamper/expiry/secret
swap, student blocked from admin routes (unit + Express end to end), rate limits
and lockout, reset single-use/expiry/session invalidation, password change,
account deletion with cascade and detached audit, server quiz scoring, progress
and streak, and CSRF enforcement.

Additional fix found during mobile verification: Vite watched the SQLite WAL
file and reloaded the page during signup. `vite.config.js` now ignores
`**/data/**`, `**/*.db`, `**/*.db-wal`, `**/*.db-shm`.

## Files

Added (backend): `lib/db/{sqliteAdapter,migrations,seed,index}.js`,
`lib/auth/{passwords,accounts,guards,csrf,audit}.js`,
`lib/academy/service.js`, `lib/api/academy.js`,
`api/auth/{signup,forgot-password,reset-password,change-password,account}.js`,
`api/academy/[...path].js`.

Added (frontend/PWA): `src/academy/{AcademyApp,AuthScreens,CourseScreens,AccountScreens}.jsx`,
`src/academy/{components.jsx,api.js,strings.js,academy.css}`,
`public/manifest.webmanifest`, `public/sw.js`, `public/offline.html`,
`public/icons/*.png`.

Changed: `server/server.js`, `lib/auth/{session,routes}.js`, `lib/vercelHttp.js`,
`api/auth/{login,logout}.js`, `src/{main,App}.jsx`, `index.html`,
`vite.config.js`, `package.json`, `package-lock.json`, `.env.example`,
`PROJECT_CONTEXT.md`.

Added (tests/docs): `tests/academy.test.js`, `GATE0_GATE1_REPORT.md`,
`STORE_READINESS.md`.

## New environment variable names

`ADMIN_EMAIL`, `ADMIN_PASSWORD`, `BCRYPT_ROUNDS`, `GRANDMASTER_DB_PATH`
(existing: `GRANDMASTER_SESSION_SECRET`, `GRANDMASTER_UI_PASSWORD` legacy,
`GRANDMASTER_DATA_DIR`, `AUTH_RATE_LIMIT_PER_MINUTE`, `VITE_API_URL`,
`VITE_API_TARGET`). Names only; no values are in the repository.

## Remaining risks

1. SQLite on Vercel `/tmp` is ephemeral per instance — a hosted database is
   required before real students use production.
2. Reset email is mocked; there is no mail provider yet.
3. In-memory rate limits are per instance, not a durable quota.
4. Policy/support text is placeholder and needs legal review before store
   submission.
5. Capacitor wrapping is not implemented yet; the app is PWA-ready only.
6. Legacy v1 owner sessions (and the legacy password while `ADMIN_EMAIL` is
   unset) remain valid by design for migration.

## Manual tasks before launch

- Provision a hosted database and set `GRANDMASTER_DB_PATH` (or plug a
  Postgres driver into `lib/db`).
- Set `GRANDMASTER_SESSION_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`,
  `CORS_ALLOWED_ORIGINS` in Vercel (values only in the dashboard).
- Replace placeholder Privacy/Terms/Support text and publish public URLs.
- Connect an email provider for password resets.
- Add Capacitor projects and store listings when packaging for Google Play /
  App Store.
