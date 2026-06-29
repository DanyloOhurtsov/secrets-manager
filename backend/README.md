# Backend (NestJS API)

The source of truth for Secrets Manager: owns the database, envelope encryption,
authentication, and authorization.

> **New here?** Start with the root [`README.md`](../README.md) — it has the one-command
> Docker quickstart. This file only covers running the backend directly.

## Run it directly (without Docker)

```bash
docker compose up -d db redis     # from the repo root: Postgres :5433, Redis :6379
cp .env.example .env              # then set MASTER_KEYS (see the file's comments)
npm install
npx prisma migrate dev            # apply migrations
npm run start:dev                 # watch mode on :3000
```

Generate a master key:

```bash
node -e "console.log('v1:' + require('crypto').randomBytes(32).toString('hex'))"
```

## Common commands

```bash
npm run start:dev                 # watch mode
npm run lint                      # eslint --fix
npm test                          # Jest unit tests (*.spec.ts)
npx jest secrets.service          # a single test file by name fragment
npx prisma migrate dev            # create/apply a migration
npx prisma generate               # regenerate the Prisma client after schema edits

# e2e tests wipe the database, so they require a disposable one whose name contains "test":
TEST_DATABASE_URL="postgresql://dev:dev@localhost:5433/secrets_manager_test" npm run test:e2e
```

See `.env.example` for all environment variables, and the root README's
[Configuration](../README.md#configuration) section for what they mean.
