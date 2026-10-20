# syntax=docker/dockerfile:1
# ===================================================================
# Multi-stage Dockerfile for Production Deployment
# Optimized for Coolify, Docker Compose, and Kubernetes
# ===================================================================
# BuildKit cache mounts (--mount=type=cache) keep the npm download cache warm
# ACROSS builds, so a lockfile-change rebuild re-installs without re-downloading.
# Requires the `# syntax` line above; auto-enabled on Docker 23+ / any BuildKit.
#
# Every stage uses the same pinned node:24-alpine image (Node 24.22.0,
# npm 11.19.1, Alpine 3.24). Node 24 is the template's runtime (package.json
# engines >=24). `npm ci` below fails when package-lock.json was written by an
# older npm: npm 10 always, and early npm 11 too (11.6.1 leaves out the
# @emnapi/* entries this npm requires). Write lockfiles with npm 11.19 or newer.

# ===================================================================
# Stage 1: libvips that runs on any x86-64 CPU
# ===================================================================
# Why this stage exists: sharp's prebuilt addon and the libvips it bundles
# need an x86-64-v2 CPU (SSE4.2/POPCNT). Many VPS hosts present an older
# virtual CPU (e.g. "QEMU Virtual CPU"), where the prebuilt sharp refuses to
# load and the server crashes at start. So we compile a pinned libvips release
# for the generic x86-64 baseline and build sharp's addon against it (stage 2).
#
# KEEP THIS STAGE BYTE-IDENTICAL in server/Dockerfile and client/Dockerfile,
# so one rule set builds both images. Identical text also lets a plain
# `docker build` host reuse the compiled layer across the two apps. On
# Coolify (measured): redeploys of the same app on the same server reused it,
# but the two apps did not share it, and a change to a build-time variable
# compiled it again (Coolify passes those into the build). An uncached
# compile takes about 6-7 min on a small shared VPS.
#
# Version coupling: every sharp release needs a minimum libvips (the
# "config.libvips" range in sharp's package.json, e.g. ">=8.18.7" for sharp
# 0.35.5). When a sharp upgrade needs more than LIBVIPS_VERSION, bump
# LIBVIPS_VERSION and LIBVIPS_SHA256 (from the libvips release page) in BOTH
# Dockerfiles. Stage 2 stops the build with a clear message if you forget.
FROM node:24-alpine@sha256:44fce696f38ba8c987c4db89954051000bbd05ffd8d8659ba15ed4a8602e937f AS libvips

ARG LIBVIPS_VERSION=8.18.7
ARG LIBVIPS_SHA256=5baaead3b0bb20ffdb9e9ff09aa9fda08620923df77b63b436654cb5e0b3bf94

# Compilers and codec headers. python3 serves node-gyp in the stage that
# builds FROM this one. Every -dev package here needs its runtime library in
# the production stage's apk list (keep the two lists in sync).
RUN apk add --no-cache \
      build-base python3 curl xz meson ninja pkgconf \
      glib-dev expat-dev libjpeg-turbo-dev libpng-dev libwebp-dev \
      tiff-dev lcms2-dev libheif-dev libexif-dev

ENV PKG_CONFIG_PATH=/opt/vips/lib/pkgconfig \
    LD_LIBRARY_PATH=/opt/vips/lib

# --auto-features=disabled turns every optional dependency off; only the
# formats we use are enabled: JPEG/PNG/WebP/HEIF/TIFF (plus the built-in GIF
# loader, which Next's image optimizer accepts), colour profiles, and EXIF
# (needed to read orientation and strip metadata). The rarely used PPM,
# Analyze and Radiance loaders are off to shrink the parser attack surface.
# -march=x86-64 is the baseline every x86-64 CPU supports (other
# architectures keep the compiler default). -j 2 bounds memory on small
# build hosts.
RUN set -eu; \
    if [ "$(uname -m)" = "x86_64" ]; then \
      export CFLAGS="-march=x86-64 -mtune=generic" CXXFLAGS="-march=x86-64 -mtune=generic"; \
    fi; \
    curl -fsSL --retry 3 -o /tmp/vips.tar.xz \
      "https://github.com/libvips/libvips/releases/download/v${LIBVIPS_VERSION}/vips-${LIBVIPS_VERSION}.tar.xz"; \
    echo "${LIBVIPS_SHA256}  /tmp/vips.tar.xz" | sha256sum -c -; \
    tar -xJf /tmp/vips.tar.xz -C /tmp; \
    meson setup /tmp/vips-build "/tmp/vips-${LIBVIPS_VERSION}" \
      --prefix=/opt/vips --libdir=lib --buildtype=release --auto-features=disabled \
      -Djpeg=enabled -Dpng=enabled -Dwebp=enabled -Dheif=enabled -Dtiff=enabled \
      -Dlcms=enabled -Dzlib=enabled -Dexif=enabled \
      -Dexamples=false -Dppm=false -Danalyze=false -Dradiance=false; \
    meson compile -C /tmp/vips-build -j 2; \
    meson install -C /tmp/vips-build; \
    test "$(pkg-config --modversion vips-cpp)" = "${LIBVIPS_VERSION}"; \
    rm -rf /tmp/vips-build "/tmp/vips-${LIBVIPS_VERSION}" /tmp/vips.tar.xz

# ===================================================================
# Stage 2: Production dependencies + CPU-safe sharp addon
# ===================================================================
# Built FROM the libvips stage because compiling sharp's addon needs the
# compilers and every codec -dev package that vips-cpp.pc references. Only
# /app/node_modules leaves this stage.
FROM libvips AS dependencies

# Install production dependencies only
WORKDIR /app

# Copy package files
COPY package.json package-lock.json* pnpm-lock.yaml* yarn.lock* ./

# Install dependencies (use the lockfile that exists)
RUN --mount=type=cache,target=/root/.npm \
    if [ -f pnpm-lock.yaml ]; then \
      npm install -g pnpm && pnpm install --prod --frozen-lockfile; \
    elif [ -f yarn.lock ]; then \
      yarn install --production --frozen-lockfile; \
    else \
      npm ci --omit=dev; \
    fi

# Add the Prisma CLI to the production node_modules so the runtime image can
# run `npx prisma migrate deploy` at container start (see CMD in stage 4).
# `prisma` is a devDependency (correct for local dev), so the prod-only install
# above does NOT include it — without this step, npx would try to download the
# CLI from the registry on every container boot. Pinned to the exact
# @prisma/client version the lockfile installed, so CLI and client never drift.
# --no-save keeps package.json and the lockfile untouched. Because this stage
# runs on the same Alpine (musl) base as the runtime stage, the engine binaries
# downloaded here are the correct ones for production.
RUN --mount=type=cache,target=/root/.npm npm install --no-save --no-audit --no-fund \
      "prisma@$(node -p "require('@prisma/client/package.json').version")"

# Build sharp's native addon against /opt/vips. sharp loads
# node_modules/sharp/src/build/Release/sharp-<platform>-<version>.node BEFORE
# its prebuilt addon and without the prebuilt's x86-64-v2 check, so this file
# is what makes sharp work on older CPUs. Keep this block identical in
# server/Dockerfile and client/Dockerfile.
#  - It runs after every npm install above, so it targets the sharp version
#    actually installed (read from its package.json, never hard-coded).
#  - SHARP_FORCE_GLOBAL_LIBVIPS makes sharp skip its own libvips version
#    check, so the block checks sharp's "config.libvips" range itself.
#  - node-addon-api and node-gyp are build tools sharp requires but does not
#    install. They go to /tmp/sharp-build (exact pins inside sharp's declared
#    ranges; --ignore-scripts, since neither needs an install script and their
#    unlocked transitive packages must not run code here) and never reach the
#    lockfile or the runtime image.
#  - npm_config_nodedir points node-gyp at this image's own Node headers, so
#    nothing is downloaded and the addon matches the runtime Node exactly.
#  - Intermediate build files are dropped; only the .node file stays, also
#    staged in /opt/sharp-addon for stages that copy it explicitly.
RUN --mount=type=cache,target=/root/.npm \
    set -eu; \
    npm install --prefix /tmp/sharp-build --no-save --no-audit --no-fund --ignore-scripts \
      node-addon-api@8.9.2 node-gyp@12.4.0; \
    if [ ! -d node_modules/sharp ]; then \
      echo "ERROR: node_modules/sharp is missing. If this app no longer uses sharp, delete this build step and the libvips stage." >&2; \
      exit 1; \
    fi; \
    cd node_modules/sharp; \
    version="$(node -p "require('./package.json').version")"; \
    need="$(node -p "require('./package.json').config.libvips")"; \
    have="$(pkg-config --modversion vips-cpp)"; \
    if ! node -e "process.exit(require('semver').satisfies(process.argv[1], process.argv[2]) ? 0 : 1)" "$have" "$need"; then \
      echo "ERROR: sharp ${version} needs libvips ${need}, but this image builds libvips ${have}. Raise LIBVIPS_VERSION and LIBVIPS_SHA256 in BOTH server/Dockerfile and client/Dockerfile." >&2; \
      exit 1; \
    fi; \
    if [ "$(uname -m)" = "x86_64" ]; then \
      export CFLAGS="-march=x86-64 -mtune=generic" CXXFLAGS="-march=x86-64 -mtune=generic"; \
    fi; \
    SHARP_FORCE_GLOBAL_LIBVIPS=1 npm_config_nodedir=/usr/local \
      NODE_PATH=/tmp/sharp-build/node_modules PATH="/tmp/sharp-build/node_modules/.bin:$PATH" \
      node install/build.js; \
    addon="sharp-linuxmusl-$(node -p "process.arch")-${version}.node"; \
    test -f "src/build/Release/${addon}"; \
    mkdir -p /opt/sharp-addon; \
    cp "src/build/Release/${addon}" /opt/sharp-addon/; \
    rm -rf src/build /tmp/sharp-build; \
    mkdir -p src/build/Release; \
    cp "/opt/sharp-addon/${addon}" src/build/Release/

# ===================================================================
# Stage 3: Build (compile TypeScript)
# ===================================================================
# Independent of stages 1-2 (tsc and prisma generate never load sharp), so
# BuildKit runs it in parallel with the libvips compile.
FROM node:24-alpine@sha256:44fce696f38ba8c987c4db89954051000bbd05ffd8d8659ba15ed4a8602e937f AS builder

# Override NODE_ENV to ensure devDependencies are installed.
# Coolify may inject NODE_ENV=production as a build arg, which causes npm ci
# to skip devDependencies (typescript, @types/node, etc.) and break the build.
ENV NODE_ENV=development

WORKDIR /app

# Copy package files and install ALL dependencies (including dev)
COPY package.json package-lock.json* pnpm-lock.yaml* yarn.lock* ./

RUN --mount=type=cache,target=/root/.npm \
    if [ -f pnpm-lock.yaml ]; then \
      npm install -g pnpm && pnpm install --frozen-lockfile; \
    elif [ -f yarn.lock ]; then \
      yarn install --frozen-lockfile; \
    else \
      npm ci; \
    fi

# Copy source code and Prisma schema
COPY . .

# Generate Prisma Client
RUN npx prisma generate

# Build TypeScript
RUN npm run build

# ===================================================================
# Stage 4: Production Runtime
# ===================================================================
FROM node:24-alpine@sha256:44fce696f38ba8c987c4db89954051000bbd05ffd8d8659ba15ed4a8602e937f AS production

# dumb-init: proper signal handling.
# curl: Coolify's own HTTP health check runs curl (then BusyBox wget) inside
# the container. Without curl it falls back to wget, which tries only the
# first address `localhost` resolves to (often IPv6 ::1, while the app
# listens on IPv4), so Coolify marks a healthy app unhealthy and rolls the
# deploy back. curl tries both addresses.
# The rest are the shared libraries our libvips links against (one per -dev
# package in stage 1). Alpine ships WebP's mux/demux libraries separately from
# libwebp and sharp fails to load without them; the libheif plugins decode
# HEIC (libde265) and AVIF (aom).
RUN apk add --no-cache \
      dumb-init curl \
      glib expat libjpeg-turbo libpng libwebp libwebpmux libwebpdemux \
      tiff lcms2 libheif libheif-libde265 libheif-aom libexif

# The libvips built in stage 1. sharp's addon links to it without an rpath,
# so the dynamic loader is told where it lives.
COPY --from=libvips /opt/vips/lib /opt/vips/lib
ENV LD_LIBRARY_PATH=/opt/vips/lib

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

WORKDIR /app

# Pin production mode in the runtime image. src/config/env.ts already defaults
# an unset NODE_ENV to production; this keeps the image fail-closed even if that
# default ever changes. A runtime NODE_ENV from Coolify still overrides it.
ENV NODE_ENV=production

# Copy production dependencies from dependencies stage.
# Includes the Prisma CLI (+ its engines) installed in stage 2, which the
# CMD below needs for `npx prisma migrate deploy`, and the CPU-safe sharp
# addon built there.
COPY --from=dependencies --chown=nodejs:nodejs /app/node_modules ./node_modules

# Copy generated Prisma client from builder stage (not present in prod deps)
COPY --from=builder --chown=nodejs:nodejs /app/node_modules/.prisma ./node_modules/.prisma

# Copy built application from builder stage
COPY --from=builder --chown=nodejs:nodejs /app/dist ./dist
COPY --from=builder --chown=nodejs:nodejs /app/package.json ./package.json

# Copy Prisma files (needed for migrations)
COPY --from=builder --chown=nodejs:nodejs /app/prisma ./prisma

# Build-time sharp and HEIC proofs (see each script's header).
COPY --chown=nodejs:nodejs scripts/check-sharp.mjs ./scripts/check-sharp.mjs
COPY --chown=nodejs:nodejs scripts/check-heic.mjs ./scripts/check-heic.mjs

# Create BOTH upload tiers with correct ownership (must be before USER nodejs).
# public/ is served as static files at /uploads/; private/ is served ONLY via
# the auth-gated route GET /api/v1/files/:filename. See file-storage.service.ts.
RUN mkdir -p /app/uploads/public /app/uploads/private && chown -R nodejs:nodejs /app/uploads

# Switch to non-root user
USER nodejs

# Prove sharp loads our addon and converts images in THIS image, as the
# runtime user, before the image can ship. A failure fails the build instead
# of crashing the server on its first upload or at start.
RUN node scripts/check-sharp.mjs
# The avatar upload accepts iPhone HEIC photos: prove a real HEVC-coded HEIC
# decodes here (the HEIF flag check-sharp sees is also true for AVIF-only builds).
RUN node scripts/check-heic.mjs

# Expose port (matches default PORT in env.ts; override via PORT env var)
EXPOSE 8000

# Health check for container orchestration.
# 127.0.0.1, never localhost: the server listens on IPv4 (HOST=0.0.0.0), and
# localhost can resolve to IPv6 ::1 first, which would refuse the probe.
# start-period is 60s because CMD runs `prisma migrate deploy` BEFORE the server
# starts listening — a slow migration must not be counted as unhealthy, or
# Coolify restart-loops the container mid-migration.
HEALTHCHECK --interval=30s --timeout=3s --start-period=60s --retries=3 \
  CMD node -e "const p=process.env.PORT||8000;require('http').get('http://127.0.0.1:'+p+'/api/v1/live',(r)=>{process.exit(r.statusCode===200?0:1)})"

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Start the application — apply any pending Prisma migrations first, then boot.
# Runs inside Coolify on every container start, where DATABASE_URL is reachable
# (it isn't from CI, which is why migrations belong here and not in a workflow).
# `migrate deploy` is idempotent: it applies only pending migrations and exits 0
# when there is nothing to do. Requirements, all satisfied above:
#   - prisma CLI in ./node_modules (installed in stage 2, copied with node_modules)
#   - ./prisma/schema.prisma + ./prisma/migrations (copied from builder)
# Refuses to start when the image holds NO migration at all (prisma/migrations
# deleted, never committed, or the project switched to `db push`): `migrate
# deploy` would then succeed with nothing to apply and the server would boot
# healthy on a database without tables, failing only at the first real query.
# Exiting instead fails the Coolify deploy with this message in the logs, and
# the previous version keeps serving. New projects ship 0_init, so this only
# fires when that safety net was removed.
# `exec` replaces the shell so node receives signals from dumb-init directly.
CMD ["sh", "-c", "if ! ls prisma/migrations/*/migration.sql >/dev/null 2>&1; then echo 'Refusing to start: no Prisma migrations in this image (prisma/migrations/*/migration.sql), so the database would have no tables. Create them with npm run prisma:migrate:dev and commit prisma/migrations.' >&2; exit 1; fi; npx prisma migrate deploy && exec node dist/server.js"]
