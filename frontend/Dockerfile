# syntax=docker/dockerfile:1

# Stage 1 — build the static SPA with Vite.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2 — serve the built assets with nginx and reverse-proxy /api -> backend.
# Serving the UI and API from the same origin keeps cookies/credentials simple.
#
# nginx-unprivileged, not the stock nginx image: it runs as uid 101 and ships
# /var/cache/nginx already owned by that uid. The stock image assumes root and
# chowns those paths at startup, which fails under `capabilities: drop: ["ALL"]`
# with `[emerg] ... Operation not permitted`. See deploy/k8s/50-dashboard.yaml.
FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

# 8080, matching `listen 8080` in nginx.conf. Above 1024, so binding it needs no
# CAP_NET_BIND_SERVICE. Anything publishing this container must target 8080 --
# docker-compose.yml maps 8080:8080, and 50-dashboard.yaml uses containerPort
# 8080.
EXPOSE 8080
