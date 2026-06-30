# Secrets Manager

A self-hosted secrets manager: store your app's secrets encrypted, manage them in a
web UI, and inject them into your processes with a CLI — without ever writing them to
disk. Backend is the source of truth (NestJS + Postgres, envelope encryption); the UI
is a React SPA; the CLI runs your app with secrets as environment variables.

This is an open-source MVP focused on a clean first-run experience for a single
developer. Multi-user orgs, roles, and grants exist under the hood but you can ignore
most of that when self-hosting for yourself.

---

## Quickstart (≈15 minutes, one command to boot)

You need **Docker** + **Docker Compose**, and **Node 20+** (only for the CLI step).

### 1. Bring up the whole stack

```bash
git clone <this-repo> secrets-manager
cd secrets-manager
docker compose up --build
```

That single command starts Postgres, Redis, the backend (it runs DB migrations on
boot), and the frontend. The first build takes a few minutes; after that it's seconds.
When it settles you have:

- **UI** → http://localhost:8080
- **API** → http://localhost:3000 (this is what the CLI talks to)

> The compose file ships a **dev-only** default encryption key so it boots with zero
> setup. Before using this for anything real, override `MASTER_KEYS` — see
> [Configuration](#configuration).

### 2. Sign up and create a place for your secrets

1. Open **http://localhost:8080** and **Sign up** with an email + password. A personal
   workspace is created for you automatically.
2. Go to the **Projects** tab → **New project** (e.g. `my-app`) → open it.
3. **New environment** (e.g. `dev`).

> **Single user?** Ignore the org switcher in the top bar, the **Platform** button
> (superadmin tooling), and the *Members/roles* parts of the **Access** tab. You only
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

### 5. Create a CI token (service account)

Secret **values** are only readable through an explicit grant — even for you. To let a
machine (CI) read them, create a service account and grant it access:

1. In the UI, open your workspace → **Access** tab.
2. Under **Service accounts**, create one (e.g. `ci`).
3. Under **Project & environment access**, click **Grant access** → pick
   `ci · service`, your project, scope **whole project**, role **reader**
   (list + reveal) → **Grant**.
4. Back under **Service accounts**, click **Tokens** on the `ci` account.
   Optionally enter a label, click **Issue**, then copy the `sm_…` token
   (shown once). **Issue** is the button that creates a new token; it is not a
   separate page.

Log the CLI in with that token:

```bash
secrets login --token sm_xxxxxxxx     # API defaults to http://localhost:3000
```

### 6. Run your app with secrets injected

The `secrets run` command needs the **environment ID**. Your token can list the
projects/environments it can reach:

```bash
curl -s http://localhost:3000/projects \
  -H "Authorization: Bearer sm_xxxxxxxx"
# (with jq:)
curl -s http://localhost:3000/projects -H "Authorization: Bearer sm_xxxxxxxx" \
  | jq '.[] | {project: .name, environments: [.environments[] | {name, id}]}'
```

PowerShell equivalent, using the token already saved by `secrets login` without
printing it:

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

Grab the `id` of your `dev` environment, then:

```bash
secrets run -e <environmentId> -- your-app-command
# e.g.
secrets run -e 1a2b3c4d-... -- node -e "console.log('DATABASE_URL present:', Boolean(process.env.DATABASE_URL))"
```

`secrets run` fetches the secrets, injects them into the child process's environment
(never to disk), and forwards its exit code. The CLI itself never prints secret
values, but the child process can — avoid logging `process.env` or individual secret
values.

#### Windows PowerShell

The same `secrets run ... -- ...` command works in the current CLI. PowerShell may
consume `--` before invoking npm's `secrets.ps1` shim, so the CLI also treats every
argument after the child executable as belonging to the child. This keeps child flags
such as `node -e` from being mistaken for the CLI's `-e, --env` option. The CLI also
launches Windows package-manager shims (`npm`, `npx`, `pnpm`, and `yarn`) through
`cmd.exe`, so commands such as this work unchanged:

```powershell
secrets run -e <environmentId> -- npm start
```

If an older checkout returns `404` when the child command has an `-e` option, or
`spawn npm ENOENT` for an npm script, rebuild and relink the current CLI:

```powershell
npm run build
npm link
```

As a temporary workaround for that older CLI, invoke npm's native Windows shim
explicitly:

```powershell
secrets.cmd run -e <environmentId> -- node -e "console.log('DATABASE_URL present:', Boolean(process.env.DATABASE_URL))"
secrets.cmd run -e <environmentId> -- npm.cmd start
```

#### Troubleshooting `secrets run`

- **404** — use an `environments[].id` returned by `GET /projects`, not the project
  ID, and confirm the token's service account has a grant for that project/environment.
  A **reader** grant can list and reveal values.
- **401** — the saved token is invalid or revoked; issue a new token and run
  `secrets login` again.
- **Injected 0 secrets** — confirm the environment contains secrets and the grant can
  reveal them. The CLI reports how many non-revealable secrets it skipped.

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

| Variable             | Where        | Notes                                                                 |
| -------------------- | ------------ | --------------------------------------------------------------------- |
| `MASTER_KEYS`        | backend      | `version:hex` entries, each 32 bytes hex. **Change the dev default.** |
| `ACTIVE_KEY_VERSION` | backend      | Which key version new secrets are wrapped with.                       |
| `DATABASE_URL`       | backend      | Postgres connection. Set by compose; only needed for local dev.       |
| `REDIS_URL`          | backend      | Token cache + rate-limit store. Degrades gracefully if down.          |
| `TRUST_PROXY`        | backend      | Set only behind a trusted reverse proxy (real client IP). See below.  |
| `SECRETS_API_URL`    | CLI          | Defaults to `http://localhost:3000`.                                  |
| `SECRETS_TOKEN`      | CLI          | Overrides the saved login token (handy in CI).                        |

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

## Tests

```bash
cd backend && npm test                 # unit tests
cd frontend && npm run build           # type-check + bundle
cd cli && npm test                     # CLI unit tests
```
