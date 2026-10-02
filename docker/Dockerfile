# syntax=docker/dockerfile:1
#
# One image per deployment profile, holding only that profile's modules:
#   docker build -f docker/Dockerfile --build-arg PROFILE=kpi-tracker -t scorpion:dev-kpi-tracker .
#
# The image runs the API server (`scorpion start`). The web UI (M5) is added to this build later.
# DATABASE_URL is required at run time, and SECRETS_KEY for profiles that include core.settings (see
# modules/core-settings/README.md); see .env.example for the other variables.
#
# Build arguments:
#   PROFILE       the profile (default full); profiles/<PROFILE>.ts lists its modules
#   PROFILE_FILE  another profile file, for the test fixtures (default profiles/<PROFILE>.ts)
#   MODULE_ROOTS  directories with module packages, space separated (default modules)

ARG NODE_VERSION=24

FROM node:${NODE_VERSION} AS build
ARG PROFILE=full
ARG PROFILE_FILE=
ARG MODULE_ROOTS=modules
ENV CI=true COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo

COPY . .
RUN test -f "${PROFILE_FILE:-profiles/${PROFILE}.ts}" || { echo "Unknown profile '${PROFILE}' (no ${PROFILE_FILE:-profiles/${PROFILE}.ts})" >&2; exit 1; }

# 1. A first install, only so that the generator can run: it loads the profile file and the kernel.
#    The store is a build cache mount, so rebuilds do not download packages again.
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --prod --filter "@scorpion/server..." --filter "@scorpion/profiles"

# 2. Compose the server for the profile: apps/server/src/generated/profile.ts imports the profile's
#    modules, and apps/server/package.json depends on exactly those modules. The generator also
#    fails the build if the profile lacks a module that one of its modules requires.
RUN set -eu; \
    args=""; for root in ${MODULE_ROOTS}; do args="$args --modules-root $root"; done; \
    node apps/server/src/cli.ts profile:generate "${PROFILE}" ${PROFILE_FILE:+--profile-file "$PROFILE_FILE"} $args

# 3. Install again for the new dependency set. The lockfile is updated first (its versions are all
#    reused; only the server's workspace links change), then a frozen, filtered install fills the
#    virtual store with the server's closure only. Optional module dependencies (optional peer
#    dependencies) are not installed unless the profile lists them.
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    find . -name node_modules -prune -exec rm -rf {} + \
    && pnpm install --lockfile-only --no-frozen-lockfile --prefer-offline \
    && pnpm install --frozen-lockfile --prod --filter "@scorpion/server..."

# 4. Assemble the run-time tree: the server's closure and nothing else.
RUN node scripts/image-tree.ts /out

FROM node:${NODE_VERSION}-slim AS runtime
ARG PROFILE=full
LABEL org.opencontainers.image.title="scorpion" \
      org.opencontainers.image.description="Scorpion service registry and KPI tracker (profile ${PROFILE})"
ENV NODE_ENV=production PROFILE=${PROFILE} PORT=3000
WORKDIR /app

COPY --from=build --chown=node:node /out ./

USER node
EXPOSE 3000
# /healthz answers as long as the process runs, also while migrations are still running. It lives
# under BASE_PATH like every route, so the check builds the URL from it. Worker containers, which do
# not listen, override the command and disable this check.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD ["node", "-e", "const base = (process.env.BASE_PATH || '/').replace(/\\/$/, ''); fetch('http://127.0.0.1:' + process.env.PORT + base + '/healthz').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
# `start` applies pending migrations, then serves. `worker` runs jobs and events without HTTP.
CMD ["node", "apps/server/src/cli.ts", "start"]
