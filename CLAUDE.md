# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository layout

Three independent npm packages, each with its own `package.json` and `node_modules` (there is no root workspace — run `npm install` inside each directory you touch):

- `backend/` — NestJS 11 API (the source of truth; owns the DB, crypto, and authz).
- `frontend/` — React 19 + Vite + Tailwind v4 SPA (admin/UI console).
- `cli/` — `secrets` command-line tool that injects secrets as env vars into a child process.

Most code comments are written in Ukrainian; match the existing language/style of the file you are editing.

## Common commands

Infrastructure (Postgres + Redis) — required for the backend:

```bash
docker compose up -d   # Postgres on host port 5433, Redis on 6379
```

Backend (`cd backend`):

```bash
npm run start:dev                  # watch mode
npm run lint                       # eslint --fix
npm run test                       # Jest unit tests (*.spec.ts, rootDir=src)
npx jest secrets.service           # run a single unit test file by name fragment
npx jest -t "creates a secret"     # run tests matching a name
npm run test:e2e                   # e2e — REQUIRES TEST_DATABASE_URL (see below)
npx prisma migrate dev             # apply/create migrations against DATABASE_URL
npx prisma generate                # regenerate the Prisma client after schema edits
npx ts-node src/bootstrap.ts       # create the first superadmin + print its token (once)
```

e2e tests wipe the database, so they refuse to run unless `TEST_DATABASE_URL` is set **and** its database name contains `test`:

```bash
TEST_DATABASE_URL="postgresql://dev:dev@localhost:5433/secrets_manager_test" npm run test:e2e
```

Frontend (`cd frontend`): `npm run dev` (Vite, proxies `/api` → `localhost:3000`), `npm run build` (`tsc -b && vite build`), `npm run lint`.

CLI (`cd cli`): `npm run dev` (tsx) or `npm run build` (tsc → `dist/`).

## Required backend environment

Set via `.env` in `backend/` (loaded by `dotenv`). Without the key vars the app throws on startup.

- `DATABASE_URL` — Postgres connection (matches docker-compose: `postgresql://dev:dev@localhost:5433/secrets_manager`).
- `MASTER_KEYS` — comma-separated `version:hex` entries, each 32 bytes hex (e.g. `v1:<64 hex chars>,v2:<64 hex chars>`).
- `ACTIVE_KEY_VERSION` — which `MASTER_KEYS` version new secrets are wrapped with.
- `REDIS_URL` — optional, defaults to `redis://localhost:6379` (backs the token cache **and** rate-limit storage; both degrade gracefully if Redis is down — throttling falls back to per-process in-memory counters).
- `PORT` — optional, defaults to 3000.
- `TRUST_PROXY` — optional. Set behind a trusted reverse proxy/ingress so Express resolves the real client IP from `X-Forwarded-For` for IP-based rate limiting (e.g. `1` = trust one hop). Leave unset otherwise; never `true` on an open network (clients could spoof the header).

CLI reads `SECRETS_API_URL` / `SECRETS_TOKEN`, falling back to `~/.secrets-manager/config.json` (written mode 600 via `secrets login`).

## Architecture

### Data model (Prisma, `backend/prisma/schema.prisma`)

`Organization → Project → Environment → Secret → SecretVersion`. Multi-tenant: every Project belongs to an Organization. `Identity` is the actor (`type: "human" | "service"`); humans join orgs through `OrganizationMembership` (`owner|admin|member`), service accounts are pinned to one org via `serviceOrganizationId`.

`SecretVersion` rows are immutable; `Secret.currentVersionId` points at the active version. Secret values are never stored in plaintext — only the envelope-encryption fields (`ciphertext`, `valueIv`, `valueAuthTag`, `encryptedDataKey`, `dataKeyIv`, `dataKeyAuthTag`, `keyVersion`).

### AuthN — two credential types, one guard

`AuthGuard` is a global guard (`app.module.ts`). It branches on the bearer token prefix: `sess_…` → `SessionService` (browser sessions), otherwise `…` → `TokenService` (API tokens, prefix `sm_`). Both hash the credential with SHA-256 before DB lookup. The resolved principal (`AuthPrincipal`) is attached as `request.identity`; controllers read it with the `@CurrentIdentity()` decorator. Mark unauthenticated routes with `@Public()`. Token verification is cached in Redis for 30s; `revoke()` deletes the cache key for instant invalidation. `ThrottlerGuard` runs before `AuthGuard` (global rate limits: 100/min default, 10/min strict).

### AuthZ — org roles + scoped grants (`auth/authorization.service.ts`)

`checkProjectAccess(actor, projectId, permission, environmentId?)` is the gate for all project/secret operations:

1. Org `owner`/`admin` membership ⇒ full access (bypasses grants).
2. Service accounts can only reach projects in their own org.
3. Otherwise a `Grant` scoped to the project or a specific environment must allow the requested `ProjectPermission` (`grantAllows` maps roles + per-action booleans like `canRevealSecrets`).

Missing access throws `NotFoundException` (to hide existence); a found-but-insufficient grant throws `ForbiddenException`. `/admin/*` routes are gated separately by `SuperadminGuard` (the `Identity.isSuperadmin` flag).

### Envelope encryption (`crypto/`)

`CryptoService.encrypt` generates a random per-secret 32-byte data key, encrypts the value with it (AES-256-GCM), then wraps that data key with the active master key. `KeyProvider` loads versioned master keys from `MASTER_KEYS` and tracks `ACTIVE_KEY_VERSION`. Key rotation (`admin/rotation.service.ts`, `POST /admin/rotate-keys`) re-wraps data keys from old master-key versions to the active one — it **never** re-encrypts the secret value/ciphertext, and is idempotent (skips versions already on the active key). Decrypt failures surface as `UnprocessableEntityException` (tamper/corruption signal).

### Auditing

`AuditService.log` writes an `AuditLog` row for essentially every meaningful action. Note that listing vs. revealing secrets are logged as separate actions (`secret.list` and, when values are decrypted, `secret.reveal`).

### Module structure

Domain modules under `backend/src/`: `auth`, `signup` (self-serve: creates identity + personal org + owner membership), `projects`, `environments`, `secrets`, `admin` (superadmin: identities, tokens, grants, key rotation, audit), `audit`, `crypto`, `cache`. Standard NestJS controller/service/`dto.ts` split; DTOs use `class-validator` and a global `ValidationPipe` with `whitelist` + `forbidNonWhitelisted`.

### Frontend

No routing library — `App.tsx` holds a manual `View` union in `useState` and uses `window.history.pushState` for the few real URLs (`/`, `/signup`, `/audit`). All requests go through `lib/api.ts` (`api<T>()`), which prefixes `/api` (Vite rewrites it to the backend, stripping `/api`) and injects the bearer token from `localStorage`. App state lives in React context providers (`AuthProvider`, `ProjectsProvider`, `SecretsProvider`). UI is shadcn/Radix primitives in `components/ui/`; the `@/` import alias maps to `src/`.

### CLI

`secrets run -e <environmentId> -- <command>` fetches `GET /environments/:id/secrets`, merges the returned `{key,value}` pairs into the environment, and spawns the command with `stdio: inherit`, forwarding its exit code. `secrets login --token sm_…` persists credentials to `~/.secrets-manager/config.json`.
