# syntax=docker/dockerfile:1

# Single-stage image: simple and reliable for a self-hosted MVP. We keep the full
# dependency tree so the Prisma CLI is available at boot to run migrations.
FROM node:22-slim

ARG APP_VERSION=development
ENV APP_VERSION=${APP_VERSION}

# OpenSSL + CA certs are required by Prisma's schema/migration engine on slim.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies first for better layer caching.
COPY package.json package-lock.json ./
RUN npm ci

# Copy the rest of the source (node_modules / dist / .env are excluded via
# .dockerignore so we never ship host artifacts or secrets into the image).
COPY . .

# Generate the Prisma client for this (linux) platform, then compile to dist/.
RUN npx prisma generate && npm run build

EXPOSE 3000

# On boot: apply any pending migrations against DATABASE_URL, then start the API.
# `migrate deploy` is idempotent, so restarts are safe.
# Entry is dist/src/main.js: prisma.config.ts at the project root makes tsc root the
# output at backend/ and keep the src/ folder (so NOT dist/main.js).
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/src/main"]
