# ===================================================================
# Multi-stage Dockerfile for Next.js Production Deployment
# Optimized for Coolify, Docker Compose, and Kubernetes
# Requires `output: "standalone"` in next.config.ts
# ===================================================================

# ===================================================================
# Stage 1: Dependencies (cached layer)
# ===================================================================
FROM node:20-alpine AS dependencies

WORKDIR /app

# Copy package files
COPY package.json package-lock.json* pnpm-lock.yaml* yarn.lock* ./

# Install dependencies (use the lockfile that exists)
RUN if [ -f pnpm-lock.yaml ]; then \
      npm install -g pnpm && pnpm install --frozen-lockfile; \
    elif [ -f yarn.lock ]; then \
      yarn install --frozen-lockfile; \
    else \
      npm ci; \
    fi

# ===================================================================
# Stage 2: Build (compile Next.js)
# ===================================================================
FROM node:20-alpine AS builder

WORKDIR /app

# Copy dependencies from previous stage
COPY --from=dependencies /app/node_modules ./node_modules

# Copy source code
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
RUN npm run build

# ===================================================================
# Stage 3: Production Runtime
# ===================================================================
FROM node:20-alpine AS production

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

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

# Switch to non-root user
USER nextjs

# Disable telemetry at runtime
ENV NEXT_TELEMETRY_DISABLED=1

# Set hostname to listen on all interfaces (required in containers)
ENV HOSTNAME="0.0.0.0"

# Default port (override via PORT env var in Coolify)
ENV PORT=3000
EXPOSE 3000

# Health check for container orchestration
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "const p=process.env.PORT||3000;require('http').get('http://localhost:'+p,(r)=>{process.exit(r.statusCode===200?0:1)})"

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Start the standalone Next.js server
CMD ["node", "server.js"]
