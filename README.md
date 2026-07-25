# Secrets Manager

A self-hosted secrets manager: store your app's secrets encrypted, manage them in a
web UI, and inject them into your processes with a CLI — without ever writing them to
disk. Backend is the source of truth (NestJS + Postgres, envelope encryption); the UI
is a React SPA; the CLI runs your app with secrets as environment variables.

This is an open-source MVP focused on a clean first-run experience for a single
developer. Multi-user orgs, roles, and grants exist under the hood but you can ignore
most of that when self-hosting for yourself.

---

## Quickstart (≈5 minutes, one command to boot)

You need **Docker** + **Docker Compose**, and **Node 20+** (only for the CLI step).

### 1. Bring up the whole stack

```bash
git clone https://github.com/DanyloOhurtsov/secrets-manager.git
cd secrets-manager
docker compose up -d
```

That command pulls the prebuilt backend and frontend images from GitHub Container
Registry, then starts Postgres, Redis, the backend (which runs DB migrations on boot),
and the frontend. No local application build is required. When it settles you have:

- **UI** → http://localhost:8080
- **API** → http://localhost:3000 (this is what the CLI talks to)

> The compose file ships a **dev-only** default encryption key so it boots with zero
> setup. Before using this for anything real, override `MASTER_KEYS` — see
> [Configuration](#configuration).

By default Compose uses the newest stable images. To pin an exact release, add its
version without the leading `v` to the root `.env` file:

```dotenv
SECRETS_MANAGER_VERSION=0.1.1
```

To run unreleased code from the current checkout instead, build it locally:

```bash
docker compose up --build
```

### 2. Sign up and create a place for your secrets

1. Open **http://localhost:8080** and **Sign up** with an email + password. A personal
   workspace is created for you automatically.
2. Go to the **Projects** tab → **New project** (e.g. `my-app`) → open it.
3. **New environment** (e.g. `dev`).

> **Single user?** Ignore the org switcher in the top bar, the **Platform** button
> (superadmin tooling), and the _Members/roles_ parts of the **Access** tab. You only
> need **Projects** — plus the **Access** tab for the CLI/CI step below.

### 3. Import your existing `.env`

In the environment you just created, click **Import .env**, then paste your `.env`
contents (or upload the file) and **Import**. Existing keys get a new version; new keys
are created. You can now reveal, edit, roll back, or soft-delete any secret.

That's the migration hook — your real `.env` is now managed here.

### 4. Install the CLI

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

### 5. Create a service account token

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
[CI and deployment](#ci-and-deployment).

### 6. Run your app with secrets injected

`secrets run` starts another process and adds the selected environment's secrets to
that process. Your application keeps reading configuration normally:

```js
const databaseUrl = process.env.DATABASE_URL;
```

The CLI does not create a `.env` file. Secrets exist only in the started process and
its child processes. Values from Secrets Manager override existing variables with the
same names.

#### 6.1 Find the environment ID

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

#### 6.2 Start the application from its own directory

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

### 7. CI and deployment

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

The compose file works out of the box with dev defaults. To override, create a `.env`
next to `docker-compose.yml`:

```bash
# Generate a real master key:
node -e "console.log('v1:' + require('crypto').randomBytes(32).toString('hex'))"
```

```dotenv
MASTER_KEYS=v1:<64 hex chars>
ACTIVE_KEY_VERSION=v1
```

| Variable                  | Where   | Notes                                                                 |
| ------------------------- | ------- | --------------------------------------------------------------------- |
| `SECRETS_MANAGER_VERSION` | compose | Container tag to run; defaults to `latest`.                           |
| `MASTER_KEYS`             | backend | `version:hex` entries, each 32 bytes hex. **Change the dev default.** |
| `ACTIVE_KEY_VERSION`      | backend | Which key version new secrets are wrapped with.                       |
| `DATABASE_URL`            | backend | Postgres connection. Set by compose; only needed for local dev.       |
| `REDIS_URL`               | backend | Token cache + rate-limit store. Degrades gracefully if down.          |
| `TRUST_PROXY`             | backend | Set only behind a trusted reverse proxy (real client IP). See below.  |
| `SECRETS_API_URL`         | CLI     | Defaults to `http://localhost:3000`.                                  |
| `SECRETS_TOKEN`           | CLI     | Overrides the saved login token (handy in CI).                        |

See `backend/.env.example` for the full list with comments.

**Production notes:** override `MASTER_KEYS` with your own key; put the stack behind
HTTPS; set `TRUST_PROXY` to the number of proxy hops if you run behind an ingress.

---

## Repository layout

Three independent npm packages (no root workspace):

- `backend/` — NestJS API. Owns the DB, envelope encryption, auth, and authorization.
- `frontend/` — React + Vite + Tailwind admin UI (served by nginx in Docker).
- `cli/` — the `secrets` command-line tool.

## Local development (without Docker)

Bring up just the infra, then run each package in watch mode:

```bash
docker compose up -d db redis          # Postgres on :5433, Redis on :6379

cd backend
cp .env.example .env                   # then edit MASTER_KEYS if you like
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

## Releases and container images

Pushing a semantic-version tag such as `v0.1.1` runs the `Publish container images`
workflow. It publishes Linux `amd64` and `arm64` images to:

- `ghcr.io/danyloohurtsov/secrets-manager-backend`
- `ghcr.io/danyloohurtsov/secrets-manager-frontend`

Stable tags publish the full version, the major/minor version, and `latest`. For
example, `v0.1.1` publishes `0.1.1`, `0.1`, and `latest`. Pre-release tags such as
`v0.2.0-alpha.1` do not replace `latest`.

GitHub creates new container packages as private. After the first successful publish,
an organization owner must open each package's settings and change its visibility to
**Public** so that `docker compose up -d` works without GitHub authentication.

## Tests

```bash
cd backend && npm test                 # unit tests
cd frontend && npm run build           # type-check + bundle
cd cli && npm test                     # CLI unit tests
```
