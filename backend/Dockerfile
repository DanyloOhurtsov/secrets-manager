# syntax=docker/dockerfile:1

# Two stages. The build stage needs the TypeScript toolchain; the runtime stage
# must not have it. Previously this was one stage ending in `COPY . .` with no
# cleanup, which shipped the .ts sources, the Nest CLI, jest, eslint and the
# whole dev tree into production — ~1.4GB of build tooling running as the API.
#
# It also made `kubectl exec ... npx ts-node src/bootstrap.ts` possible, which is
# how an admin task ended up OOM-killing the API. Removing the compiler removes
# the temptation along with the weight. See deploy/k8s/60-bootstrap-job.yaml.
#
# ---------------------------------------------------------------------------
# BEFORE YOU EDIT: a `RUN rm` in a LATER layer does not shrink the image.
#
# Layers are stacked, not rewritten. Deleting a file in a later layer records a
# whiteout entry that HIDES it — every byte still ships, and `docker pull` still
# transfers it. The first version of this file did exactly that (a standalone
# `RUN rm -rf node_modules/typescript`, and a `find -delete` after the COPY of
# dist/) and the image measured 907MB both with and without them: identical.
#
# The two rules that follow from it, both applied below:
#   1. Delete in the SAME `RUN` that created the files.
#   2. For anything arriving via `COPY --from=build`, delete it in the BUILD
#      stage instead, so the COPY never carries it over.
#
# Merging them is what took this image from 907MB to 878MB. If you split a
# cleanup out into its own layer "for readability", you have silently undone it.
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Stage 1 — build
# ---------------------------------------------------------------------------
FROM node:22-slim AS build

# Prisma's engines shell out to OpenSSL to pick a binary target; without it
# `prisma generate` warns and guesses.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dependencies first, so a source-only change does not re-install.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Generate the Prisma client for this (linux) platform, then compile to dist/.
#
# The find runs HERE, not in the runtime stage, so the runtime COPY never brings
# them across. Deleting after a COPY only adds a whiteout layer — the bytes stay
# in the image. Declarations and source maps are build artifacts: nothing
# consumes them at runtime (source-map-support is a devDependency and node is
# not started with --enable-source-maps), and .d.ts files would otherwise leave
# 71 *.ts files in an image that is supposed to have none.
RUN npx prisma generate \
  && npm run build \
  && find dist \( -name '*.d.ts' -o -name '*.js.map' \) -delete

# ---------------------------------------------------------------------------
# Stage 2 — runtime
# ---------------------------------------------------------------------------
FROM node:22-slim AS runtime

# ARG/ENV do not cross stages — APP_VERSION has to be declared again here.
ARG APP_VERSION=development
ENV APP_VERSION=${APP_VERSION}
ENV NODE_ENV=production

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Production dependencies only: no typescript, no ts-node, no Nest CLI, no jest.
#
# The Prisma CLI DOES stay, because it is a runtime dependency of this
# deployment model, not a build tool: the CMD below runs `prisma migrate deploy`
# for the compose path, and 30-migrate-job.yaml invokes it as the Job's command.
# It is declared in `dependencies` for exactly that reason — relying on it
# arriving as @prisma/client's optional peer (range "*") would be an accident,
# not a contract.
COPY package.json package-lock.json ./

# The rm is part of THIS RUN on purpose. A separate `RUN rm -rf` would only add
# a whiteout layer on top of the layer that already contains the 23MB — the
# image would still carry it.
#
# npm installs `typescript` even under --omit=dev: both `prisma` and
# `@prisma/client` declare it as an OPTIONAL peer (">=5.4.0"), and npm resolves
# optional peers into the lockfile tree, so --omit=peer does not drop it either.
# Nothing needs it at runtime — TypeScript is only required to load a
# prisma.config.TS, and the compiled prisma.config.js is what we ship.
RUN npm ci --omit=dev \
  && rm -rf node_modules/typescript \
  && npm cache clean --force

# Order matters: `npm ci` above wipes node_modules, so the generated client has
# to be copied in AFTER it.
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma

# Compiled application. dist/src/ (not dist/) because prisma.config.ts sits at
# the project root and is not excluded from tsconfig.build.json, so tsc infers
# the common source root as backend/ and keeps the src/ segment.
COPY --from=build /app/dist/src ./dist/src

# Prisma 7 reads the datasource URL and the schema/migrations paths from a
# config file. We ship the COMPILED one so no .ts source enters this image;
# `prisma.config.js` is resolved just like `prisma.config.ts` would be.
COPY --from=build /app/dist/prisma.config.js ./prisma.config.js

# The schema AND the migration SQL — `migrate deploy` replays the files in
# prisma/migrations, so the schema alone is not enough.
COPY prisma ./prisma

EXPOSE 3000

# On boot: apply any pending migrations against DATABASE_URL, then start the API.
# `migrate deploy` is idempotent, so restarts are safe. In Kubernetes this CMD is
# overridden — 30-migrate-job.yaml owns migrations and 40-api.yaml runs only the
# server, so replicas do not race. Compose still uses this path.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/src/main"]
