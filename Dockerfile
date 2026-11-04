# syntax=docker/dockerfile:1.7
# One multi-stage Dockerfile for the whole monorepo. Targets:
#   migrate  — applies Prisma migrations (one-off job)
#   api      — NestJS REST API
#   collab   — Hocuspocus collaboration server
#   web      — nginx serving the SPA + reverse proxy for /api and /collab

ARG NODE_IMAGE=node:24-alpine

# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY apps/api/package.json apps/api/
COPY apps/collab/package.json apps/collab/
COPY apps/web/package.json apps/web/
RUN npm ci --no-audit --no-fund

# ---------------------------------------------------------------------------
FROM deps AS build
COPY . .
RUN npm run build:packages \
 && npm run build -w @syncnotes/api \
 && npm run build -w @syncnotes/collab \
 && npm run build -w @syncnotes/web

# ---------------------------------------------------------------------------
FROM build AS migrate
WORKDIR /app/packages/db
CMD ["npx", "prisma", "migrate", "deploy"]

# ---------------------------------------------------------------------------
# Production dependencies per service: only the workspaces a service actually runs, so the
# API image does not carry Hocuspocus and neither carries the web app's React/Tiptap stack.
# `--omit=optional` also drops the Prisma CLI/Studio, which @prisma/client lists as an optional peer.
FROM deps AS manifests
RUN rm -rf node_modules

FROM manifests AS api-deps
RUN npm ci --omit=dev --omit=optional --no-audit --no-fund \
    -w @syncnotes/api -w @syncnotes/db -w @syncnotes/shared

FROM manifests AS collab-deps
RUN npm ci --omit=dev --omit=optional --no-audit --no-fund \
    -w @syncnotes/collab -w @syncnotes/db -w @syncnotes/shared

FROM ${NODE_IMAGE} AS server-base
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/packages/shared/package.json packages/shared/package.json
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/packages/db/package.json packages/db/package.json
COPY --from=build /app/packages/db/dist packages/db/dist

# ---------------------------------------------------------------------------
FROM server-base AS api
COPY --from=api-deps /app/node_modules ./node_modules
COPY --from=build /app/apps/api/package.json apps/api/package.json
COPY --from=build /app/apps/api/dist apps/api/dist
USER node
EXPOSE 4000
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=5 \
  CMD wget -qO- http://127.0.0.1:4000/api/health >/dev/null || exit 1
CMD ["node", "apps/api/dist/main.js"]

# ---------------------------------------------------------------------------
FROM server-base AS collab
COPY --from=collab-deps /app/node_modules ./node_modules
COPY --from=build /app/apps/collab/package.json apps/collab/package.json
COPY --from=build /app/apps/collab/dist apps/collab/dist
USER node
EXPOSE 1234
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=5 \
  CMD wget -qO- http://127.0.0.1:1234/health >/dev/null || exit 1
CMD ["node", "apps/collab/dist/main.js"]

# ---------------------------------------------------------------------------
FROM nginx:1.27-alpine AS web
COPY infra/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY infra/nginx/security-headers.inc /etc/nginx/snippets/security-headers.inc
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=10s --timeout=3s --retries=5 CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
