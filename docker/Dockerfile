# syntax=docker/dockerfile:1
#
# One image per deployment profile:
#   docker build -f docker/Dockerfile --build-arg PROFILE=kpi-tracker -t scorpion:dev-kpi-tracker .
#
# The image runs the API server (`scorpion start`). The web UI (M5) is added to this build later.
# DATABASE_URL is required at run time; see .env.example for the other variables.

ARG NODE_VERSION=24

FROM node:${NODE_VERSION} AS build
ARG PROFILE=full
ENV CI=true COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo

COPY . .
RUN test -f "profiles/${PROFILE}.ts" || { echo "Unknown profile '${PROFILE}' (no profiles/${PROFILE}.ts)" >&2; exit 1; }

# Production dependencies of the server and the workspace packages it depends on. Workspace
# packages stay symlinks to their source directories: Node runs the TypeScript sources directly
# (type stripping), which it refuses to do for files inside node_modules. The store is a build
# cache mount, so rebuilds do not download packages again. (`pnpm fetch` is not used: it would
# put every production dependency of the whole workspace into node_modules.)
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --prod --filter "@scorpion/server..." --filter "@scorpion/profiles"

# Compose the server for the chosen profile: write apps/server/src/generated/profile.ts with the
# profile's modules. (Installing only those modules is refined in the per-profile image change.)
RUN node apps/server/src/cli.ts profile:generate "${PROFILE}"

FROM node:${NODE_VERSION}-slim AS runtime
ARG PROFILE=full
LABEL org.opencontainers.image.title="scorpion" \
      org.opencontainers.image.description="Scorpion service registry and KPI tracker (profile ${PROFILE})"
ENV NODE_ENV=production PROFILE=${PROFILE} PORT=3000
WORKDIR /app

COPY --from=build --chown=node:node /repo/package.json ./
COPY --from=build --chown=node:node /repo/node_modules ./node_modules
COPY --from=build --chown=node:node /repo/apps/server ./apps/server
COPY --from=build --chown=node:node /repo/packages ./packages
COPY --from=build --chown=node:node /repo/profiles ./profiles

USER node
EXPOSE 3000
# /healthz answers as long as the process runs, also while migrations are still running. It lives
# under BASE_PATH like every route, so the check builds the URL from it. Worker containers, which do
# not listen, override the command and disable this check.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD ["node", "-e", "const base = (process.env.BASE_PATH || '/').replace(/\\/$/, ''); fetch('http://127.0.0.1:' + process.env.PORT + base + '/healthz').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
# `start` applies pending migrations, then serves. `worker` runs jobs and events without HTTP.
CMD ["node", "apps/server/src/cli.ts", "start"]
