> **SCOPE**: These rules apply specifically to the **server** directory.

# Deployment & Docker

This project is deployed via **Docker** on **Coolify** (or any Docker-based platform). The `Dockerfile` is the production deployment contract. Every code change must remain compatible with it.

---

## Dockerfile Architecture

The server uses a **3-stage multi-stage build**:

```
Stage 1 (dependencies)  → Installs prod-only node_modules (cached layer)
Stage 2 (builder)        → Installs all deps, generates Prisma client, compiles TypeScript
Stage 3 (production)     → Alpine + dumb-init, non-root user, copies dist + prod node_modules + Prisma
```

**Entry point**: `node dist/server.js`
**Health check**: `GET /api/v1/live` — this endpoint MUST always exist and return 200.

---

## When to Update the Dockerfile

| You did this... | Update Dockerfile? | What to change |
|---|---|---|
| Added a new npm dependency | No | Automatic — `npm ci` installs from `package.json` |
| Added a native/system dependency (e.g., `sharp`, `bcrypt`) | **Yes** | Add `apk add` in the production stage for required system libraries |
| Changed the build command or output directory | **Yes** | Update the `RUN npm run build` or `COPY` paths in stage 2/3 |
| Changed the entry point file (e.g., renamed `server.ts`) | **Yes** | Update `CMD ["node", "dist/<new-name>.js"]` |
| Changed the default port | **Yes** | Update `EXPOSE` and the `HEALTHCHECK` port |
| Added/renamed a health check endpoint | **Yes** | Update the `HEALTHCHECK` URL path |
| Added files needed at runtime (e.g., templates, static assets) | **Yes** | Add a `COPY` line in stage 3 |
| Changed Prisma schema | No | Automatic — `npx prisma generate` runs in stage 2 |
| Added a new env var | Maybe | If it's needed at **build time**, add `ARG` + `ENV` in the builder stage |
| Added file upload functionality | **Yes** | Add a `VOLUME` directive or ensure the upload directory is writable |

---

## Critical Rules

1. **Health endpoint is sacred.** The route `GET /api/v1/live` must always exist and return HTTP 200. Coolify, Docker, and load balancers use it to determine if the container is alive. Never remove, rename, or gate it behind auth.

2. **Never break the build chain.** If you rename the build output directory, the entry file, or change `tsconfig.json` `outDir`, update the Dockerfile `COPY` paths and `CMD` accordingly.

3. **System dependencies must be explicit.** If a new npm package requires native binaries (e.g., `sharp` needs `libvips`, `bcrypt` needs `build-base`), add `apk add --no-cache <package>` in the production stage. The build will succeed locally but fail in Docker without this.

4. **Non-root user.** The app runs as `nodejs:nodejs` (UID 1001). Any files the app needs to write (uploads, logs) must be in directories owned by this user. Add `RUN mkdir -p /app/<dir> && chown nodejs:nodejs /app/<dir>` if needed.

5. **No secrets in the image.** Environment variables are injected at runtime via Coolify/Docker. Never hardcode secrets, never `COPY .env`, never use `ENV` for sensitive values. Only use `ARG`/`ENV` for non-secret build-time config.

6. **Keep `.dockerignore` in sync.** When adding new directories or file types that should NOT be in the Docker build context (test fixtures, docs, local scripts), add them to `.dockerignore`. When adding files that ARE needed at build time, make sure they're not ignored.

7. **Port consistency.** The default port is `8000`. If you change the port in `src/config/env.ts`, also update `EXPOSE` and the `HEALTHCHECK` in the Dockerfile.

---

## Coolify-Specific Notes

- **Environment variables**: Set in Coolify's UI, injected at container runtime. No `.env` file needed.
- **Build arguments**: For build-time vars, use Coolify's "Build Arguments" section → maps to `docker build --build-arg`.
- **Persistent storage**: For file uploads, mount a volume in Coolify to `/app/uploads`. Add to Dockerfile: `RUN mkdir -p /app/uploads && chown nodejs:nodejs /app/uploads` before `USER nodejs`.
- **Database migrations**: Run `npx prisma migrate deploy` as a pre-deploy command in Coolify, or add it to the `CMD` before the server starts.

---

## Files That Matter for Deployment

| File | Purpose | Must exist? |
|---|---|---|
| `Dockerfile` | Production build instructions | Yes |
| `.dockerignore` | Excludes files from Docker build context | Yes |
| `package.json` | Dependencies and build script | Yes |
| `tsconfig.json` | TypeScript compilation config | Yes |
| `prisma/schema.prisma` | Database schema (copied to runtime) | Yes |
| `prisma/migrations/` | Migration files (copied to runtime) | Yes |
| `src/server.ts` | Entry point (compiled to `dist/server.js`) | Yes |
