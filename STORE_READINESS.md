# Store Readiness — Grandmaster Academy (Phase 1)

Last updated: 2026-10-29
Status: **not ready for submission** — PWA-ready, hosted persistence and policy
text still pending.

## App identity

- [x] Name, short name, description, categories in `public/manifest.webmanifest`
- [x] 192px, 512px and maskable 512px PNG icons (`public/icons/`)
- [x] Apple touch icon and theme-color in `index.html`
- [x] `start_url` is `/academy`; standalone display; portrait orientation
- [x] Offline page (`public/offline.html`) and service worker shell cache
- [ ] Capacitor iOS/Android projects (not created yet)
- [ ] Store screenshots, feature graphic, age rating questionnaire

## Education-only compliance

- [x] Disclaimer on landing, courses, lessons and quiz results
- [x] No signals, no "buy/sell this", no profit or win-rate promises
- [x] MT5/live trading hidden and disabled in every academy screen
- [x] Quiz explanations describe concepts, not trade recommendations
- [ ] Final wording review by the owner

## Accounts and privacy

- [x] Email + bcrypt password accounts; no plaintext passwords stored
- [x] Signed HttpOnly session cookie (SameSite=Strict, Secure in production)
- [x] Roles enforced server-side; students only reach academy APIs
- [x] Forgot/reset password with single-use, 30-minute expiring token
- [x] In-app account deletion with password confirmation
      (required by Google Play and Apple 5.1.1(v))
- [x] Privacy Policy, Terms of Use and Support pages exist in-app
- [ ] Public Privacy Policy URL and Support URL (placeholders must be replaced)
- [ ] Data safety / privacy nutrition labels completed in each store console
- [ ] Email provider for reset links (currently mocked outside production)

## Security

- [x] CSRF double-submit token on account/academy mutations
- [x] Login rate limit and per-account lockout backoff
- [x] Generic auth errors, no account-enumeration text
- [x] Audit log with allow-listed fields only
- [x] Security headers and CORS allow-list retained
- [x] `/api/` responses never cached by the service worker
- [x] No secrets in client code or repository; env names only in `.env.example`
- [ ] Penetration test / abuse review before public launch

## Platform and hosting

- [x] PWA installable over HTTPS
- [x] `VITE_API_URL` allows a non-localhost API base for Capacitor builds
- [ ] Durable hosted database (Vercel `/tmp` SQLite is ephemeral)
- [ ] Backups and restore drill for the hosted database
- [ ] Production env vars configured in Vercel dashboard (names only):
      `GRANDMASTER_SESSION_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`,
      `CORS_ALLOWED_ORIGINS`, `GRANDMASTER_DB_PATH` (or hosted DB credentials)
- [ ] Domain, HTTPS and app-store deep links finalized

## Content

- [x] One course, 3 lessons, 1 quiz with 5 explained questions
- [ ] Localization (Urdu / Roman Urdu) beyond the single English strings file
- [ ] Content review for accuracy and jurisdiction-specific rules

## Verification evidence

- `npm test`: 175/175 pass
- `npm run build`: pass
- 390×844 browser walkthrough: 20/20 checks pass (no horizontal scroll,
  44px+ targets, quiz 5/5, progress 33%, dark theme, privacy page)
