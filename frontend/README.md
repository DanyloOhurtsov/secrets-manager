# Frontend (React + Vite UI)

The admin/console SPA for Secrets Manager. React 19 + Vite + Tailwind v4, shadcn/Radix
primitives. All requests go through `lib/api.ts`, which prefixes `/api` (proxied to the
backend in dev, reverse-proxied by nginx in Docker).

> **New here?** Start with the root [`README.md`](../README.md) — it has the one-command
> Docker quickstart. In Docker this app is built and served by nginx; this file only
> covers local dev.

## Local development

```bash
docker compose up -d db redis     # from the repo root
# start the backend (see ../backend/README.md) so it's listening on :3000
npm install
npm run dev                       # Vite on :5173, proxies /api -> http://localhost:3000
```

## Commands

```bash
npm run dev       # dev server with HMR
npm run build     # tsc -b && vite build (type-check + production bundle)
npm run lint      # eslint
```
