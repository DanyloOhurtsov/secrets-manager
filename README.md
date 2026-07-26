# Secrets Manager

A self-hosted secrets manager: store your app's secrets encrypted, manage them in a
web UI, and inject them into your processes with a CLI — without ever writing them to
disk. Backend is the source of truth (NestJS + Postgres, envelope encryption); the UI
is a React SPA; the CLI runs your app with secrets as environment variables.

This is an open-source MVP focused on a clean first-run experience for a single
developer. Multi-user orgs, roles, and grants exist under the hood but you can ignore
most of that when self-hosting for yourself.

---

## Quickstart (≈5 minutes)

You need **Docker** + **Docker Compose**, and **Node 20+** (only for the CLI step).

### 1. Generate your master encryption key

This is the key that wraps every secret you will store, so it has to be yours and
it has to exist before anything starts. There is no default — the stack refuses to
boot without it, on purpose.

```bash
git clone https://github.com/DanyloOhurtsov/secrets-manager.git
cd secrets-manager

echo "MASTER_KEYS=v1:$(openssl rand -hex 32)" >> .env
echo "ACTIVE_KEY_VERSION=v1" >> .env
```

`.env` is gitignored. Back this key up somewhere safe: **lose it and every stored
secret is unrecoverable**, since the values are only ever stored encrypted.

> Never reuse a key you found in a repository, this one included. See
> [SECURITY.md](SECURITY.md) — a real key was published in this repo's history
> before 2026-07-26 and must never be used.

### 2. Bring up the whole stack

```bash
docker compose up -d
```

That command pulls the prebuilt backend and frontend images from GitHub Container
Registry, then starts Postgres, Redis, the backend (which runs DB migrations on boot),
and the frontend. No local application build is required. When it settles you have:

- **UI** → http://localhost:8080
- **API landing page** → http://localhost:3000
- **API health** → http://localhost:3000/health
- **API metadata (JSON)** → http://localhost:3000/info

If you skipped step 1, compose stops immediately with
`required — generate with echo "v1:$(openssl rand -hex 32)"`. That is the guard
working, not a bug.

By default Compose uses the newest stable images. To pin an exact release, add its
version without the leading `v` to the root `.env` file:

```dotenv
SECRETS_MANAGER_VERSION=0.2.0
```

> **This compose file requires `0.2.0` or newer.** In `0.2.0` the frontend
> container's listen port moved from 80 to 8080, and `docker-compose.yml` maps
> `8080:8080` to match. Pinning an older image with this file publishes a port
> nothing is bound to and the dashboard is simply unreachable. Compose cannot
> enforce a minimum, so to run `0.1.x` check out that tag and use its compose
> file: `git checkout v0.1.2`. See [Breaking changes](#breaking-changes-in-020).

To run unreleased code from the current checkout instead, build it locally:

```bash
docker compose up --build
```

### 3. Sign up and create a place for your secrets

1. Open **http://localhost:8080** and **Sign up** with an email + password. A personal
   workspace is created for you automatically.
2. Go to the **Projects** tab → **New project** (e.g. `my-app`) → open it.
3. **New environment** (e.g. `dev`).

> **Single user?** Ignore the org switcher in the top bar, the **Platform** button
> (superadmin tooling), and the _Members/roles_ parts of the **Access** tab. You only
> need **Projects** — plus the **Access** tab for the CLI/CI step below.

### 4. Import your existing `.env`

In the environment you just created, click **Import .env**, then paste your `.env`
contents (or upload the file) and **Import**. Existing keys get a new version; new keys
are created. You can now reveal, edit, roll back, or soft-delete any secret.

That's the migration hook — your real `.env` is now managed here.

### 5. Install the CLI

```bash
cd cli
npm install
npm run build
npm link          # puts `secrets` on your PATH (undo later with `npm unlink -g`)
```

Verify the global command:

```bash
secrets --version
```

On Windows, `npm link` creates both PowerShell (`secrets.ps1`) and Command Prompt
(`secrets.cmd`) shims. The current CLI supports either one.

### 6. Create a service account token

Secret **values** are only readable through an explicit grant — even for you. To let a
local process or CI job read them, create a service account and grant it access:

1. In the UI, open your workspace → **Access** tab.
2. Under **Service accounts**, create one (e.g. `local-dev` or `ci`).
3. Under **Project & environment access**, click **Grant access** → pick the new
   service account, your project, the required environment (recommended) or
   **whole project**, and role **reader** (list + reveal) → **Grant**.
4. Back under **Service accounts**, click **Tokens** on the new account. Optionally
   enter a label, click **Issue**, then copy the `sm_…` token (shown once).
   **Issue** creates a token; it is not a separate page.

For local development, save the token in the CLI config:

```bash
secrets login --token sm_xxxxxxxx     # API defaults to http://localhost:3000
```

The token is a credential: do not commit it, paste it into logs, or expose it to
browser code. For CI, use `SECRETS_TOKEN` instead of `secrets login`; see
[CI and deployment](#8-ci-and-deployment).

### 7. Run your app with secrets injected

`secrets run` starts another process and adds the selected environment's secrets to
that process. Your application keeps reading configuration normally:

```js
const databaseUrl = process.env.DATABASE_URL;
```

The CLI does not create a `.env` file. Secrets exist only in the started process and
its child processes. Values from Secrets Manager override existing variables with the
same names.

#### 7.1 Find the environment ID

Use the service account token to list only the projects and environments it can
access.

macOS/Linux:

```bash
curl -s http://localhost:3000/projects \
  -H "Authorization: Bearer sm_xxxxxxxx" \
  | jq '.[] | {project: .name, environments: [.environments[] | {name, id}]}'
```

PowerShell (reads the token already saved by `secrets login` without printing it):

```powershell
$config = Get-Content "$HOME\.secrets-manager\config.json" | ConvertFrom-Json
$api = if ($env:SECRETS_API_URL) {
  $env:SECRETS_API_URL
} elseif ($config.apiUrl) {
  $config.apiUrl
} else {
  "http://localhost:3000"
}
$token = if ($env:SECRETS_TOKEN) { $env:SECRETS_TOKEN } else { $config.token }

Invoke-RestMethod "$api/projects" -Headers @{
  Authorization = "Bearer $token"
} | ConvertTo-Json -Depth 6
```

Copy the required value from `environments[].id`. Do not use the project `id`.

#### 7.2 Start the application from its own directory

Change to the application directory — not the Secrets Manager `cli` directory — and
wrap its normal start command:

```bash
cd /path/to/your-application
secrets run -e <environmentId> -- npm run dev
```

Any executable works:

```bash
secrets run -e <environmentId> -- node dist/main.js
secrets run -e <environmentId> -- python app.py
secrets run -e <environmentId> -- npm start
```

To verify injection without revealing a value:

```bash
secrets run -e <environmentId> -- node -e "console.log('DATABASE_URL present:', Boolean(process.env.DATABASE_URL))"
```

The CLI reports the number of injected secrets and forwards the child process's exit
code. The CLI itself never prints secret values, but the application can — do not log
`process.env` or individual credentials.

#### Next.js example

The Secrets Manager API already uses port `3000`. If Next.js runs on the same machine,
choose another port:

```bash
# Development (does not require a production build)
secrets run -e <environmentId> -- npm run dev -- -p 3001

# Production
secrets run -e <environmentId> -- npm run build
secrets run -e <environmentId> -- npm start -- -p 3001
```

Do not store `NODE_ENV` in Secrets Manager; let Next.js set it. Never put private
values in `NEXT_PUBLIC_*` variables because Next.js includes those in the browser
bundle.

#### Windows PowerShell

The same `secrets run ... -- ...` syntax works in PowerShell. The CLI forwards child
flags such as `node -e` correctly and launches Windows package-manager shims (`npm`,
`npx`, `pnpm`, and `yarn`) through `cmd.exe`:

```powershell
secrets run -e <environmentId> -- npm start
```

After pulling CLI changes, rebuild and relink from the `cli` directory:

```powershell
cd C:\path\to\secrets-manager\cli
npm install
npm run build
npm link
```

If an older build returns `spawn npm ENOENT`, invoke npm's native Windows shim while
you update:

```powershell
secrets.cmd run -e <environmentId> -- npm.cmd start
```

### 8. CI and deployment

Do not run `secrets login` in CI. Store these as protected variables in the CI
platform:

```dotenv
SECRETS_API_URL=https://secrets.example.com
SECRETS_TOKEN=sm_xxxxxxxx
ENVIRONMENT_ID=<environmentId>
```

Then wrap the application command:

```bash
secrets run -e "$ENVIRONMENT_ID" -- npm start
```

Use a dedicated service account per application or deployment context, grant only the
required environment, and rotate/revoke its tokens independently. The application
receives a snapshot at startup, so restart it after changing or rotating secrets.

### Troubleshooting `secrets run`

| Symptom                        | Meaning                                                        | Fix                                                                                    |
| ------------------------------ | -------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `401`                          | Token is invalid or revoked.                                   | Issue a new token and run `secrets login` again (or update `SECRETS_TOKEN` in CI).     |
| `404` while fetching secrets   | Wrong environment ID, or the service account cannot access it. | Use an `environments[].id` returned by `GET /projects` and check the grant.            |
| `Injected 0 secrets`           | The environment is empty, or the grant cannot reveal values.   | Add secrets and use a `reader` grant or another role with reveal permission.           |
| `spawn npm ENOENT` on Windows  | An old CLI build tried to execute the `npm.cmd` shim directly. | Pull the current CLI, run `npm install`, `npm run build`, and `npm link` from `cli/`.  |
| `UV_HANDLE_CLOSING` on Windows | An old CLI forced Node to exit while handles were closing.     | Rebuild/relink the current CLI; diagnose the preceding error, which is the root cause. |
| `EADDRINUSE ... :3000`         | The app and Secrets Manager API both want port `3000`.         | Start the app on another port, such as `3001`.                                         |
| Next.js cannot find `.next`    | `next start` was used before a production build.               | Run `secrets run -e <id> -- npm run build`, then start the app.                        |
| `ECONNREFUSED` for Postgres    | Nothing is listening at the host/port in `DATABASE_URL`.       | Start the application's database or correct `DATABASE_URL`, then restart the app.      |
| Next.js warns about `NODE_ENV` | A non-standard value was injected.                             | Remove `NODE_ENV` from Secrets Manager and let Next.js manage it.                      |

`DATABASE_URL` is passed to the application exactly as stored. Secrets Manager does
not start the application's database. If the application runs on the host, a URL with
`localhost:<published-port>` can be correct; inside Docker, use the database service
hostname and its internal port instead.

Done — you went from clone to a running app with injected secrets.

---

## Configuration

Configuration lives in a `.env` next to `docker-compose.yml`. `MASTER_KEYS` is the
only required value and has **no default** — the stack refuses to start without one
(step 1 of the quickstart):

```bash
# Generate a real master key:
echo "v1:$(openssl rand -hex 32)"
```

```dotenv
MASTER_KEYS=v1:<64 hex chars>
ACTIVE_KEY_VERSION=v1
```

| Variable                  | Where   | Notes                                                                    |
| ------------------------- | ------- | ------------------------------------------------------------------------ |
| `SECRETS_MANAGER_VERSION` | compose | Container tag to run; defaults to `latest`.                              |
| `MASTER_KEYS`             | backend | `version:hex` entries, each 64 hex chars. **Required, no default.**      |
| `ACTIVE_KEY_VERSION`      | backend | Which key version new secrets are wrapped with. Defaults to `v1`.        |
| `DATABASE_URL`            | backend | Postgres connection. Set by compose; only needed for local dev.       |
| `REDIS_URL`               | backend | Token cache + rate-limit store. Degrades gracefully if down.          |
| `TRUST_PROXY`             | backend | Set only behind a trusted reverse proxy (real client IP). See below.  |
| `SECRETS_API_URL`         | CLI     | Defaults to `http://localhost:3000`.                                  |
| `SECRETS_TOKEN`           | CLI     | Overrides the saved login token (handy in CI).                        |

See `backend/.env.example` for the full list with comments.

**Production notes:** use a `MASTER_KEYS` value you generated yourself and have never
published — see [SECURITY.md](SECURITY.md) for the key that was leaked in this repo's
history and the rotation path; put the stack behind HTTPS; set `TRUST_PROXY` to the
number of proxy hops if you run behind an ingress. The `dev:dev` Postgres credentials
in `docker-compose.yml` are local-development values, not production ones.

---

## Repository layout

Three independent npm packages (no root workspace):

- `backend/` — NestJS API. Owns the DB, envelope encryption, auth, and authorization.
- `frontend/` — React + Vite + Tailwind admin UI (served by nginx in Docker).
- `cli/` — the `secrets` command-line tool.

## Local development (without Docker)

**First, enable the git hooks — one line, do it once per clone:**

```bash
git config core.hooksPath .githooks
```

That installs a `pre-commit` hook which blocks a commit containing master key
material, so a key never leaves your machine. It runs `scripts/secret-scan.sh`,
the same scan CI runs — CI is the backstop for anyone who skips this or commits
with `--no-verify`. See [SECURITY.md](SECURITY.md) for why this exists.

Then bring up just the infra and run each package in watch mode:

```bash
docker compose up -d db redis          # Postgres on :5433, Redis on :6379

cd backend
cp .env.example .env                   # then generate MASTER_KEYS (it ships empty)
npm install
npx prisma migrate dev
npm run start:dev                      # API on :3000

cd ../frontend
npm install
npm run dev                            # UI on :5173, proxies /api -> :3000
```

To build and run the full stack from the current checkout instead of pulling its
published images:

```bash
docker compose up --build
```

## Breaking changes in 0.2.0

### Read this first if you ever ran 0.1.x

`0.1.x` shipped a **real, working master key** as the example value in
`backend/.env.example`, and for part of that period `docker-compose.yml` used the
same key as a silent shell default. If you followed the quickstart without
setting `MASTER_KEYS` yourself, **every secret you stored is encrypted under a key
that is published in this repository and readable by anyone who clones it.**

**Upgrading does not fix this.** One of the changes below is "`MASTER_KEYS` is now
required" — it is easy to read that, generate a fresh key, and conclude you are
done. You are not. A new key protects only what you write *afterwards*. It does
not re-encrypt what is already in the database, and it does nothing about backups
or dumps taken while the leaked key was active: whoever holds one can still
decrypt it, because both the ciphertext and its wrapped data key are unchanged.

If this describes you, the recovery path in **[SECURITY.md](SECURITY.md) is
required, not optional** — and it ends with rotating the underlying credentials
(database passwords, API keys, tokens), because those are what was actually
disclosed. Rotating only the master key leaves them exposed.

Check whether you are affected — the leaked key begins `ec03de45`:

```bash
grep -r 'ec03de45' .env backend/.env deploy/k8s/02-secret.yaml 2>/dev/null
docker compose exec backend printenv MASTER_KEYS | cut -c1-12
```

### Everything else that breaks

| Change | Symptom if you do nothing | Fix |
| --- | --- | --- |
| **`MASTER_KEYS` has no default.** The compose file uses `${MASTER_KEYS:?…}` instead of a committed fallback. | `docker compose up` aborts immediately with `required — generate with echo "v1:$(openssl rand -hex 32)"`. | Generate a key into `.env` — step 1 of the [Quickstart](#1-generate-your-master-encryption-key). |
| **Stricter key validation.** Malformed `MASTER_KEYS` values that used to be silently accepted (non-hex characters, trailing junk after 64 valid chars, a version listed twice) now fail at startup. | The API refuses to start, naming the offending entry. | Correct the value. A key is exactly 64 hex characters. |
| **Frontend container port 80 → 8080.** The image is `nginxinc/nginx-unprivileged`, running as uid 101. | The dashboard is unreachable if anything still targets container port 80 — your own reverse proxy, a compose override, or an old pinned image with the new compose file. | Target 8080. This repo's `docker-compose.yml` maps `8080:8080`. |
| **The backend image no longer contains build tooling.** It is multi-stage and production-only: no `.ts` sources, no `typescript`, no `ts-node`. | Anything that shelled into the container to run TypeScript directly fails with "not found". | Run the compiled output (`node dist/src/…`). The Prisma CLI is still present for migrations. |

### Not a breaking change, but new: local Kubernetes

`deploy/k8s/` plus `kind-config.yaml` and the `Makefile` bring up the stack on a
local [kind](https://kind.sigs.k8s.io/) cluster. It is **not part of a release**:
those manifests reference locally built `:dev` images (`make build-images`), not
the published GHCR tags, so they track the source tree rather than
`SECRETS_MANAGER_VERSION`. It also uses host ports **8081/3001**, precisely so it
can run alongside the compose stack on 8080/3000. See
[deploy/k8s/README.md](deploy/k8s/README.md).

## Releases and container images

Pushing a semantic-version tag such as `v0.2.0` runs the `Publish container images`
workflow. It publishes Linux `amd64` and `arm64` images to:

- `ghcr.io/danyloohurtsov/secrets-manager-backend`
- `ghcr.io/danyloohurtsov/secrets-manager-frontend`

Stable tags publish the full version, the major/minor version, and `latest`. For
example, `v0.2.0` publishes `0.2.0`, `0.2`, and `latest`. Pre-release tags such as
`v0.2.1-alpha.1` do not replace `latest`.

**Tagging is the only thing that publishes.** The workflow triggers on
`push: tags: v*` — merging to `main` publishes nothing, and `latest` keeps
pointing at the previously tagged build. That matters whenever a change to
`docker-compose.yml` depends on a change inside an image: until the tag is
pushed, a fresh clone pulls the old image and gets the new compose file. Ship
both in the same tag.

GitHub creates new container packages as private. After the first successful publish,
an organization owner must open each package's settings and change its visibility to
**Public** so that `docker compose up -d` works without GitHub authentication.

## Tests

```bash
cd backend && npm test                 # unit tests
cd frontend && npm run build           # type-check + bundle
cd cli && npm test                     # CLI unit tests
```
