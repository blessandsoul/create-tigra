# syntax=docker/dockerfile:1
# ===================================================================
# Multi-stage Dockerfile for Next.js Production Deployment
# Optimized for Coolify, Docker Compose, and Kubernetes
# Requires `output: "standalone"` in next.config.ts
# ===================================================================
# BuildKit cache mount (--mount=type=cache) keeps the npm download cache warm
# across builds, so a lockfile/dep-change rebuild re-installs from cache
# (measured ~2.8x: 49s->18s on a real create-tigra client) instead of
# re-downloading every tarball. Requires the `# syntax` line above (BuildKit).
#
# Every stage uses the same pinned node:22-alpine image (Node 22.23.3 on
# Alpine 3.24). The template requires Node >=22.12; Node 20 is end of life.
#
# next/image optimizes images at runtime with sharp (GET /_next/image), so the
# client needs the same CPU-safe sharp as the server: stages 1-2 below.

# ===================================================================
# Stage 1: libvips that runs on any x86-64 CPU
# ===================================================================
# Why this stage exists: sharp's prebuilt addon and the libvips it bundles
# need an x86-64-v2 CPU (SSE4.2/POPCNT). Many VPS hosts present an older
# virtual CPU (e.g. "QEMU Virtual CPU"), where the prebuilt sharp refuses to
# load and the server crashes at start. So we compile a pinned libvips release
# for the generic x86-64 baseline and build sharp's addon against it (stage 2).
#
# KEEP THIS STAGE BYTE-IDENTICAL in server/Dockerfile and client/Dockerfile:
# identical text gives an identical build-cache key, so a host that builds
# both apps compiles libvips once.
#
# Version coupling: every sharp release needs a minimum libvips (the
# "config.libvips" range in sharp's package.json, e.g. ">=8.18.7" for sharp
# 0.35.5). When a sharp upgrade needs more than LIBVIPS_VERSION, bump
# LIBVIPS_VERSION and LIBVIPS_SHA256 (from the libvips release page) in BOTH
# Dockerfiles. Stage 2 stops the build with a clear message if you forget.
FROM node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402 AS libvips

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
# Stage 2: Dependencies + CPU-safe sharp addon
# ===================================================================
# Built FROM the libvips stage because compiling sharp's addon needs the
# compilers and every codec -dev package that vips-cpp.pc references.
FROM libvips AS dependencies

WORKDIR /app

# Copy package files
COPY package.json package-lock.json* pnpm-lock.yaml* yarn.lock* ./

# Install dependencies (use the lockfile that exists)
RUN --mount=type=cache,target=/root/.npm \
    if [ -f pnpm-lock.yaml ]; then \
      npm install -g pnpm && pnpm install --frozen-lockfile; \
    elif [ -f yarn.lock ]; then \
      yarn install --frozen-lockfile; \
    else \
      npm ci; \
    fi

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
# Stage 3: Build (compile Next.js)
# ===================================================================
# Built FROM the dependencies stage: node_modules (with the CPU-safe addon)
# is already in place, and libvips is loadable should the build touch sharp.
# None of these build tools reach the runtime image.
FROM dependencies AS builder

WORKDIR /app

# Copy source code (.dockerignore keeps node_modules out, so the installed
# modules above are not overwritten)
COPY . .

# Build arguments for env vars needed at build time
# Next.js inlines NEXT_PUBLIC_* values during build, so they must
# be available here. Pass them via --build-arg in Coolify/Docker.
ARG NEXT_PUBLIC_API_BASE_URL
ARG NEXT_PUBLIC_APP_NAME

ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
ENV NEXT_PUBLIC_APP_NAME=$NEXT_PUBLIC_APP_NAME

# Disable Next.js telemetry during build
ENV NEXT_TELEMETRY_DISABLED=1

# Build the application (outputs to .next/standalone)
# NOTE: a `--mount=type=cache,target=/app/.next/cache` was tested here and REMOVED —
# it measured SLOWER (next build 29s→58s on a real create-tigra client), because Next's
# persistent-cache serialization overhead exceeds the incremental savings for small/mid
# apps. Re-add it only for a genuinely large client after measuring a win.
RUN npm run build

# ===================================================================
# Stage 4: Production Runtime
# ===================================================================
FROM node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402 AS production

# dumb-init: proper signal handling.
# curl: Coolify's own HTTP health check runs curl (then BusyBox wget) inside
# the container. Without curl it falls back to wget, which tries only the
# first address `localhost` resolves to (often IPv6 ::1, while Next listens
# on IPv4), so Coolify marks a healthy app unhealthy and rolls the deploy
# back. curl tries both addresses.
# The rest are the shared libraries our libvips links against (one per -dev
# package in stage 1; same list as the server image). Alpine ships WebP's
# mux/demux libraries separately from libwebp and sharp fails to load without
# them; the libheif plugins decode HEIC (libde265) and AVIF (aom).
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
    adduser -S nextjs -u 1001

WORKDIR /app

# Copy the standalone server (includes only required node_modules)
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./

# Copy static assets (not included in standalone output)
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Copy public folder (favicon, images, etc.)
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# Ship the CPU-safe sharp addon explicitly. Next's standalone file tracing
# does not reliably carry a source-built addon (or any libvips .so), so it is
# copied to the exact path sharp's loader tries first.
COPY --from=dependencies --chown=nextjs:nodejs /opt/sharp-addon/ ./node_modules/sharp/src/build/Release/

# Build-time sharp proof (see the script's header).
COPY --chown=nextjs:nodejs scripts/check-sharp.mjs ./scripts/check-sharp.mjs

# Switch to non-root user
USER nextjs

# Prove sharp loads our addon and converts images in THIS image, as the
# runtime user, before the image can ship. A failure fails the build instead
# of breaking every /_next/image request in production.
RUN node scripts/check-sharp.mjs

# Disable telemetry at runtime
ENV NEXT_TELEMETRY_DISABLED=1

# Set hostname to listen on all interfaces (required in containers)
ENV HOSTNAME="0.0.0.0"

# Default port (override via PORT env var in Coolify)
ENV PORT=3000
EXPOSE 3000

# Health check for container orchestration.
# 127.0.0.1, never localhost: Next listens on IPv4 (HOSTNAME=0.0.0.0), and
# localhost can resolve to IPv6 ::1 first, which would refuse the probe.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "const p=process.env.PORT||3000;require('http').get('http://127.0.0.1:'+p+'/',(r)=>{process.exit(r.statusCode===200?0:1)})"

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Start the standalone Next.js server
CMD ["node", "server.js"]
