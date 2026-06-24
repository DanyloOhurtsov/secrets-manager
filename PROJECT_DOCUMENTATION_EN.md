# Secrets Manager - Project Documentation

Ukrainian version: [PROJECT_DOCUMENTATION.md](PROJECT_DOCUMENTATION.md)

## 1. Overview

Secrets Manager is a local/internal secrets management system for team projects. The system supports:

- creating organizations, projects, and environments;
- storing secrets in encrypted form;
- keeping secret versions and rolling back to earlier versions;
- granting access to users and service accounts;
- viewing an audit log;
- injecting secrets into processes through the CLI.

The repository contains three independent npm packages. There is no root workspace, so dependencies and commands must be handled inside each package directory.

```text
backend/   NestJS API, Prisma, PostgreSQL, Redis, authorization, encryption
frontend/  React + Vite SPA for organizations, projects, and secrets
cli/       `secrets` CLI for fetching secrets and running commands with env vars
```

## 2. Tech Stack

Backend:

- NestJS 11;
- Prisma 7;
- PostgreSQL 16;
- Redis 7 for short-lived token cache;
- AES-256-GCM envelope encryption;
- Jest for unit/e2e tests.

Frontend:

- React 19;
- Vite;
- TypeScript;
- Tailwind CSS v4;
- shadcn/Radix UI primitives;
- lucide-react icons.

CLI:

- TypeScript;
- commander;
- Node.js child_process for launching child commands.

## 3. Infrastructure

For local development, the project root contains `docker-compose.yml`:

```bash
docker compose up -d
```

It starts:

- PostgreSQL: `localhost:5433`, database `secrets_manager`, user `dev`, password `dev`;
- Redis: `localhost:6379`.

Stop the services:

```bash
docker compose down
```

Remove local PostgreSQL data:

```bash
docker compose down -v
```

## 4. Backend Configuration

The backend reads `.env` from the `backend/` directory.

Minimal `backend/.env` example:

```env
DATABASE_URL="postgresql://dev:dev@localhost:5433/secrets_manager"
REDIS_URL="redis://localhost:6379"
PORT=3000

MASTER_KEYS="v1:<64_hex_chars>"
ACTIVE_KEY_VERSION="v1"
```

Variables:

- `DATABASE_URL` - PostgreSQL URL for Prisma.
- `REDIS_URL` - Redis URL. If omitted, the backend uses `redis://localhost:6379`.
- `PORT` - API port. Defaults to `3000`.
- `MASTER_KEYS` - comma-separated list of master keys in `version:hex` format. Each key must be 32 bytes, which means 64 hex characters.
- `ACTIVE_KEY_VERSION` - the key version from `MASTER_KEYS` used to encrypt new secrets.

Generate a master key:

```bash
openssl rand -hex 32
```

Example with two keys:

```env
MASTER_KEYS="v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa,v2:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
ACTIVE_KEY_VERSION="v2"
```

Important: do not remove old keys from `MASTER_KEYS` while the database still contains secrets whose data keys are wrapped with those versions.

## 5. First Run

1. Start infrastructure:

```bash
docker compose up -d
```

2. Install backend dependencies:

```bash
cd backend
npm install
```

3. Create `backend/.env` using the example above.

4. Apply migrations:

```bash
npx prisma migrate dev
```

5. Create the first superadmin:

```bash
npx ts-node src/bootstrap.ts
```

The command creates the `bootstrap-admin` identity and prints an API token with the `sm_` prefix. The token is shown once and must be saved.

6. Start the backend:

```bash
npm run start:dev
```

7. Start the frontend in another terminal:

```bash
cd frontend
npm install
npm run dev
```

Vite proxies `/api/*` requests to `http://localhost:3000/*`.

8. Build the CLI if needed:

```bash
cd cli
npm install
npm run build
```

## 6. Common Commands

Backend (`backend/`):

```bash
npm run start:dev      # NestJS dev server
npm run build          # production build
npm run start:prod     # run dist/main
npm run lint           # ESLint with autofix
npm run test           # unit tests
npm run test:e2e       # e2e tests
npm run test:cov       # coverage
npx prisma migrate dev # migrations
npx prisma generate    # generate Prisma client
```

Frontend (`frontend/`):

```bash
npm run dev      # Vite dev server
npm run build    # TypeScript build + Vite build
npm run lint     # ESLint
npm run preview  # preview production build
```

CLI (`cli/`):

```bash
npm run dev    # run through tsx
npm run build  # compile to dist/
```

## 7. Backend Architecture

The main module `backend/src/app.module.ts` wires:

- `AuthModule` - token/session authentication;
- `SignupModule` - user registration and personal workspace creation;
- `OrganizationsModule` - organizations and membership;
- `ProjectsModule` - projects;
- `EnvironmentsModule` - environments;
- `SecretsModule` - secrets, versions, rollback;
- `GrantsModule` - access to projects/environments;
- `ServiceAccountsModule` - service accounts and their tokens;
- `AccountModule` - personal tokens and active organization;
- `AdminModule` - platform admin API;
- `AuditModule` - audit log;
- `CryptoModule` - encryption;
- `CacheModule` - Redis cache.

Global behavior:

- `ValidationPipe` with `whitelist`, `forbidNonWhitelisted`, and `transform`;
- `ThrottlerGuard`, default limit `100` requests per minute, backed by Redis (`RedisThrottlerStorage`) so limits are shared across all backend instances;
- `AuthGuard`, which requires `Authorization: Bearer ...` for every route except `@Public()` routes.
- `helmet` with a narrow Content-Security-Policy and baseline security headers.

## 8. Data Model

Main entities from `backend/prisma/schema.prisma`:

- `Organization` - workspace of type `personal` or `team`.
- `OrganizationMembership` - link between an identity and an organization with role `owner`, `admin`, or `member`.
- `Identity` - user or service account (`type: human | service`).
- `Project` - project inside an organization.
- `Environment` - environment inside a project.
- `Secret` - secret key inside an environment. Uses `deletedAt` for soft delete.
- `SecretVersion` - immutable version of a secret value.
- `Grant` - access granted to an identity for a project or a specific environment.
- `Token` - API token with hash, expiry, revoke, and `lastUsedAt`.
- `Session` - browser session token.
- `AuditLog` - action log.

Data hierarchy:

```text
Organization
  Project
    Environment
      Secret
        SecretVersion
```

`Secret.currentVersionId` points to the active version. Older versions remain available for history and rollback.

## 9. Authentication

There are two bearer credential types:

- `sess_...` - browser session, created through signup/login;
- `sm_...` - API token, created for a user, service account, or bootstrap superadmin.

`AuthGuard` reads `Authorization: Bearer <token>`:

- if the token starts with `sess_`, it is verified by `SessionService`;
- otherwise it is verified by `TokenService`.

Tokens are not stored in plaintext. The database stores a SHA-256 hash.

Public routes:

- `POST /signup`;
- `POST /auth/login`.

All other routes require a bearer token.

## 10. Authorization and Roles

There are two access layers:

1. Organization role (`OrganizationMembership`):
   - `owner`;
   - `admin`;
   - `member`.

2. Grant (`Grant`) scoped to:
   - the whole project (`scopeType = project`);
   - a specific environment (`scopeType = environment`).

Grant roles:

- `viewer`;
- `reader`;
- `readonly`;
- `developer`;
- `admin`.

Additional capability flags:

- `canRevealSecrets`;
- `canCreateSecrets`;
- `canUpdateSecrets`;
- `canDeleteSecrets`;
- `canRollbackSecrets`;
- `canManageGrants` - legacy compatibility field; in the current authorization logic it does not allow managing grants or projects.

Important security rule:

- an organization `owner`/`admin` can manage project structure, environments, and grants;
- an organization `owner`/`admin` does not automatically get access to secret values;
- revealing, creating, updating, deleting, or rolling back secret values requires an explicit grant with the required permissions.
- creating, updating, and revoking grants is available only to organization `owner`/`admin` members;
- a project/environment grant with role `admin` grants full data-plane access and `manageProject`, but it does not grant `manageGrants`.

This is intentional: ownership does not imply universal secret reveal.

A service account can work only inside its own organization (`serviceOrganizationId`).

By default, `developer` can see metadata/list secret keys, but cannot see plaintext values and cannot create, update, delete, or roll back secrets without explicit capability flags.

Platform admin (`Identity.isSuperadmin`) is the instance owner. It can perform platform-level operations (`/admin/*`), but it does not automatically get tenant secret values and is not a bypass around tenant grants.

## 11. Secret Encryption

The backend uses envelope encryption:

1. A random 32-byte data key is generated for every secret value.
2. The secret value is encrypted with the data key using AES-256-GCM.
3. The data key is encrypted with the active master key.
4. The database stores:
   - value ciphertext;
   - value IV and auth tag;
   - encrypted data key;
   - data key IV and auth tag;
   - `keyVersion`.

Plaintext secret values are never stored in the database.

Master key rotation:

- endpoint: `POST /admin/rotate-keys`;
- access: superadmin only;
- the operation re-wraps encrypted data keys to the active master key version;
- the secret ciphertext itself is not re-encrypted;
- if a record is already on the active version, it is skipped.

If AES-GCM integrity verification fails, the backend returns an error indicating possible corruption or tampering.

## 12. API

All protected endpoints expect:

```http
Authorization: Bearer <sess_or_sm_token>
Content-Type: application/json
```

### Auth

```http
POST /signup
POST /auth/login
DELETE /auth/session
GET  /auth/me
```

`POST /signup` creates a human identity, a personal organization, and an owner membership.

`POST /auth/login` returns `sessionToken`.

`DELETE /auth/session` revokes the current browser session. The endpoint is session-only for `sess_...`; API tokens `sm_...` are not revoked through it.

### Account

```http
GET    /me/active-org
PUT    /me/active-org
GET    /me/tokens
POST   /me/tokens
DELETE /me/tokens/:tokenId
```

Used for the active organization in the UI and personal API tokens.

### Organizations

```http
POST   /organizations
GET    /organizations
GET    /organizations/:id
PATCH  /organizations/:id
DELETE /organizations/:id

POST   /organizations/:id/members
PATCH  /organizations/:id/members/:identityId
DELETE /organizations/:id/members/:identityId
POST   /organizations/:id/transfer-ownership
```

### Projects

```http
POST   /projects
GET    /projects
GET    /projects/:id
GET    /projects/:id/capabilities
POST   /projects/:id/transfer
DELETE /projects/:id
```

If `organizationId` is not provided when creating a project, the backend creates the project in the actor's personal workspace where they have the `owner` role.

### Environments

```http
POST   /projects/:projectId/environments
GET    /projects/:projectId/environments
PATCH  /projects/:projectId/environments/:id
DELETE /projects/:projectId/environments/:id
```

### Secrets

```http
POST   /environments/:environmentId/secrets
GET    /environments/:environmentId/secrets
GET    /environments/:environmentId/secrets?reveal=true
GET    /environments/:environmentId/secrets/capabilities
GET    /environments/:environmentId/secrets/:id/reveal
PATCH  /environments/:environmentId/secrets/:id
GET    /environments/:environmentId/secrets/:id/versions
POST   /environments/:environmentId/secrets/:id/rollback
DELETE /environments/:environmentId/secrets/:id
```

`GET /secrets?reveal=true` and `GET /:id/reveal` require the `revealSecrets` permission.

Rate limits:

- secrets list: `60/min` (per IP);
- reveal a single secret: `30/min` (per IP);
- signup: `5/min` per IP **and** `5/min` per normalized email;
- login: `5/min` per IP **and** `5/min` per normalized email.

**Two-dimensional limiting for auth routes.** Login and signup are limited both by
IP (`@Throttle`, the global `ThrottlerGuard`) and by a separate account dimension —
`AccountThrottlerGuard` increments a bucket keyed by the SHA-256 of the normalized
(`trim` + `lowercase`) submitted email. The email value (not the DB record) is
counted, so unknown and known emails fall into the same bucket and the 429 response
never reveals whether an account exists. The two dimensions are independent: a single
email is throttled even when attempts come from many IPs (NAT / proxy / botnet), and
the per-IP route limit still applies when the email varies. Login and signup use
separate per-route buckets (the route name is part of the key).

**Shared storage (Redis) + safe degradation.** All throttling — IP and account — runs
through `RedisThrottlerStorage`, an atomic fixed-window counter implemented with a
single Redis `EVAL` (Lua) so limits are shared across backend instances. If Redis is
unavailable, throttling is **not** silently disabled: the storage fails open only to
the built-in in-memory counter (per process) and logs a one-time warning, so the
limits stay enforced (just not cluster-wide) until Redis recovers.

**Production proxy / `req.ip`.** The IP dimension relies on `req.ip`. Behind a reverse
proxy / ingress, set the `TRUST_PROXY` env var so Express resolves the real client IP
from `X-Forwarded-For` (e.g. `TRUST_PROXY=1` to trust one proxy hop). Enable it **only**
when a trusted proxy sets/overwrites `X-Forwarded-For`; never set `TRUST_PROXY=true` on
an open network, or clients could spoof the header and bypass IP-based limits. When
`TRUST_PROXY` is unset the default (no trust) applies.

### Grants

```http
POST   /organizations/:organizationId/grants
GET    /organizations/:organizationId/grants
PATCH  /organizations/:organizationId/grants/:grantId
DELETE /organizations/:organizationId/grants/:grantId
```

Only organization `owner` or `admin` members can manage grants.

### Service Accounts

```http
POST   /organizations/:organizationId/service-accounts
GET    /organizations/:organizationId/service-accounts
DELETE /organizations/:organizationId/service-accounts/:identityId

POST   /organizations/:organizationId/service-accounts/:identityId/tokens
GET    /organizations/:organizationId/service-accounts/:identityId/tokens
DELETE /organizations/:organizationId/service-accounts/:identityId/tokens/:tokenId
```

### Audit

Tenant-level audit:

```http
GET /audit
GET /audit/actions
```

Filters:

- `action`;
- `organizationId`;
- `projectId`;
- `environmentId`;
- `actorId`;
- `targetType`;
- `from`;
- `to`.

### Platform Admin

Routes under `/admin/*` require `Identity.isSuperadmin = true`.

```http
GET  /admin/organizations
POST /admin/organizations/:id/suspend
POST /admin/organizations/:id/unsuspend

GET  /admin/audit
GET  /admin/audit/actions
GET  /admin/health
POST /admin/rotate-keys
```

A suspended organization blocks access to its resources even for owner/admin members. Only a platform admin can unsuspend it.

For users with no relationship to a project, the backend returns `404` regardless of the organization's status. This prevents outsiders from inferring that a project exists inside a suspended organization.

## 13. Security Headers

The backend applies `helmet` to every response.

Content-Security-Policy is explicit and narrow:

```text
default-src 'self';
base-uri 'self';
object-src 'none';
frame-ancestors 'none';
form-action 'self';
script-src 'self';
script-src-attr 'none';
style-src 'self';
img-src 'self' data:;
connect-src 'self';
```

The policy does not include `default-src *` or `unsafe-inline`. `upgrade-insecure-requests` is intentionally not enabled so local HTTP development keeps working. CORS is not expanded; in development the frontend reaches the API through the Vite proxy.

## 14. Frontend

The frontend is an SPA without a separate routing library. Routes are handled in `frontend/src/lib/router.tsx` through the History API.

Main screens:

- `/login` - login;
- `/signup` - registration;
- `/orgs/:orgId/projects` - organization workspace;
- `/orgs/:orgId/projects/:projectId` - project details;
- `/admin` - platform admin UI for superadmins.

API requests go through `frontend/src/lib/api.ts`:

- `/api` is prefixed automatically;
- bearer token is read from `localStorage`;
- API errors are converted to `Error(message)`.

Browser-session logout calls `DELETE /auth/session` and then clears `localStorage`. If the revoke request fails, the frontend still clears local state; the backend remains the source of truth for `revokedAt`.

Vite proxy:

```text
/api/* -> http://localhost:3000/*
```

## 15. CLI

The CLI package is named `@secrets-manager/cli`, and the binary is `secrets`.

Commands:

```bash
secrets ping
secrets login --token <sm_token> --url http://localhost:3000
secrets whoami
secrets run -e <environmentId> -- <command...>
```

CLI configuration:

- `SECRETS_API_URL` - API URL;
- `SECRETS_TOKEN` - API token;
- if env vars are not present, the CLI reads `~/.secrets-manager/config.json`.

`secrets login` writes config to:

```text
~/.secrets-manager/config.json
```

The file is created with `0600` permissions.

After every write, the CLI explicitly applies `chmod 0600`, so the file is tightened to safe permissions even if it already existed with broader permissions.

Example command with injected secrets:

```bash
secrets login --token sm_xxx --url http://localhost:3000
secrets run -e <environmentId> -- npm run start
```

The CLI calls:

```http
GET /environments/:environmentId/secrets?reveal=true
```

Then it adds each `{ key, value }` pair to the child process environment and returns that process exit code.

If the API returns `value: null` for a secret without reveal permission, the CLI does not inject the string `"null"` or `"undefined"` into the process env. Those secrets are skipped, and a short warning is printed to `stderr` without secret values.

## 16. Tests

Backend unit tests:

```bash
cd backend
npm run test
```

E2E tests:

```bash
cd backend
TEST_DATABASE_URL="postgresql://dev:dev@localhost:5433/secrets_manager_test" npm run test:e2e
```

E2E tests require a separate disposable database. The test code protects against accidental use of a production/dev database: the database name must contain `test`.

Frontend build check:

```bash
cd frontend
npm run build
```

CLI build check:

```bash
cd cli
npm run build
```

## 17. Audit

The backend writes `AuditLog` rows for important actions:

- signup and login;
- organization creation;
- project, environment, and secret actions;
- secret reveal;
- grant management;
- service accounts and tokens;
- platform admin actions.

Secret reveal is logged separately from ordinary list operations.

There are two audit modes:

- `logRequired` - fail-closed: if the audit row cannot be written, the action fails with `503 Audit log unavailable`;
- `logBestEffort` - best-effort: the audit write error is logged server-side, but the request is not failed.

Fail-closed audit is used for security-critical actions: secret reveal, secret mutations, grant CRUD, token issue/revoke, service account actions, membership/ownership changes, project/environment mutations, and platform-admin mutations. For most critical mutations, the audit write runs in the same Prisma transaction as the mutation, so audit failure rolls back the change.

`secret.reveal` is audited before decrypt/return. If audit is unavailable, plaintext secret values are not decrypted or returned.

`secret.list` remains best-effort because it is read-only metadata without plaintext values.

## 18. Typical Workflow

1. Superadmin is created through `src/bootstrap.ts`.
2. A user signs up through `/signup` and receives a personal workspace.
3. The user creates a team organization or works in the personal organization.
4. A project is created inside the organization.
5. Environments are created inside the project, for example `dev`, `staging`, and `prod`.
6. Organization owner/admin members add users or service accounts.
7. Organization owner/admin members issue grants for a project or environment.
8. Users with matching grants create, update, or reveal secrets.
9. The CLI uses a service account token to run processes with secrets from an environment.

## 19. Security Rules

- Do not commit `.env`, real tokens, master keys, or database dumps.
- Do not remove old master keys without full rotation and data verification.
- Use a service account token for automation/CI instead of a human token.
- Grant `revealSecrets` only to identities that truly need plaintext access.
- Do not use `canManageGrants` as an effective permission. In the MVP, access management is only for organization `owner`/`admin` members.
- Use separate PostgreSQL/Redis instances and a separate master key set in production.
- When a token is revoked, the backend invalidates Redis cache, so the token should stop working immediately.
- Browser logout revokes the server-side session. If a session is stolen, server-side revocation is required; clearing localStorage alone is not enough.
- Critical audit failures must block security-sensitive actions; plaintext secrets must not be returned without an audit record.

## 20. Next Security Work

This is a roadmap, not the current system guarantee:

- AES-GCM AAD: bind ciphertext/encrypted data keys to context (`secretId`, `version`, `keyVersion`) and add backward-compatible decrypt for existing records.
- Browser auth cookies: move `sess_...` out of `localStorage` and into an `httpOnly`, `Secure`, `SameSite` cookie.
- Soft-delete policy: define the difference between recoverable delete/version history and compliance hard purge.
- Redis hardening: enable authentication/TLS/network isolation for production Redis, because Redis backs token cache and rate-limit storage.
- Security e2e suite: add dedicated e2e coverage for tenant isolation, audit scoping, service account isolation, session revoke, and rate limiting on a test database.

## 21. Troubleshooting

Backend fails with `MASTER_KEYS is not configured`:

- check `backend/.env`;
- make sure the command runs from the `backend` directory;
- check the `MASTER_KEYS` format.

Backend fails with `ACTIVE_KEY_VERSION is missing or unknown`:

- `ACTIVE_KEY_VERSION` must match one of the versions in `MASTER_KEYS`.

Prisma cannot reach the database:

- check that `docker compose up -d` is running;
- check port `5433`;
- check `DATABASE_URL`.

Frontend receives 401:

- check that a token exists in `localStorage`;
- login/signup again;
- make sure the backend is running on `localhost:3000`.

CLI cannot connect to the API:

- run `secrets ping`;
- check `SECRETS_API_URL` or `~/.secrets-manager/config.json`;
- make sure the backend listens on the expected port.

A user can see a project but cannot reveal secrets:

- this is the expected security model;
- issue a grant with `reader`, `readonly`, `admin`, or `canRevealSecrets=true`.
