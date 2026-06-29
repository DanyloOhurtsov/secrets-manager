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
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
