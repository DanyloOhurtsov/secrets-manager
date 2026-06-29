# Baseline — "before" first-run experience

Captured on a clean `git clone` at commit `367f27c` (before the Wave 1 quickstart work),
so we can compare against the final one-command flow.

## What a stranger gets on a clean checkout

- **No root `README.md`** — the only entry points are `CLAUDE.md` (internal) and the stock
  framework READMEs (`backend/README.md` is the NestJS template, `frontend/README.md` is the
  Vite template). Nothing tells a newcomer how to run the project.
- **No `.env` and no `.env.example`** — `backend/.env` is git-ignored, so it is absent after a
  clone, and there is no template to copy.
- **`docker compose up` only starts Postgres + Redis** — there are no Dockerfiles and no
  backend/frontend services, so no application actually runs.

## Exact path-to-first-failure

1. `docker compose up -d` → brings up **only** `db` (Postgres) and `redis`. No app. No hint
   that the app must be started separately.
2. Look for a README → none at the root. `backend/README.md` is boilerplate.
3. Guess the backend: `cd backend && npm install && npm run start:dev`.
4. **Crash during bootstrap**, before the server ever listens:

   ```
   ERROR [ExceptionHandler] Error: MASTER_KEYS is not configured
       at new KeyProvider (src/crypto/key-provider.service.ts:11:13)
   ```

   The app throws in `KeyProvider`'s constructor because `MASTER_KEYS` / `ACTIVE_KEY_VERSION`
   are unset and there is no `.env`. A stranger has no `.env.example` and no docs telling them
   they must hand-generate **two 32-byte hex keys** — most people give up here.

## Even if they push past the crash

- They must hand-write a `.env`, run `npx prisma migrate dev` + `npx prisma generate`, start
  the backend, then in a **second** process `cd frontend && npm install && npm run dev`.
- The UI has **no `.env` import** — migrating an existing `.env` means re-typing every secret
  one key at a time. (This alone fails the 15-minute test by definition.)
- The CLI must be built and linked manually (`cd cli && npm install && npm run build && npm link`),
  and `secrets run -e <environmentId>` needs an **environment ID the UI never displays**.

## Summary

Path-to-first-success on a clean checkout: **4 separate processes**, a hand-crafted `.env` with
self-generated crypto keys, manual migrations, no bulk import, and a hidden environment ID.
Net result: **the 15-minute test is impossible** — a stranger never even reaches the running UI.
