# create-tigra

Scaffold a production-ready full-stack application with **Next.js 16** + **Fastify 5** + **Prisma** + **Redis**.

## Quick Start

```bash
npx create-tigra my-app
```

## What's Included

### Client (Next.js 16)

| Feature | Technology |
|---|---|
| Framework | Next.js 16 (App Router, React 19) |
| Styling | Tailwind CSS v4, shadcn/ui, OKLCH color system |
| State | Redux Toolkit (auth), React Query v5 (server data) |
| Forms | React Hook Form + Zod validation |
| HTTP | Axios with httpOnly cookie auth + auto refresh |
| Auth UI | Login, Register, Dashboard pages |
| Components | Header, Footer, Loading, Error, Empty states |
| Theme | Light/Dark mode with next-themes |

### Server (Fastify 5)

| Feature | Technology |
|---|---|
| Framework | Fastify 5 with TypeScript (strict) |
| Database | MySQL 8.0 + Prisma 6 ORM |
| Cache | Redis 7 (ioredis) |
| Auth | JWT (httpOnly cookies), session management |
| Validation | Zod schemas on all inputs |
| Security | Helmet, CORS, rate limiting, password hashing (Argon2) |
| File uploads | Multipart + Sharp image optimization |
| Logging | Pino with pretty dev output |
| Testing | Vitest with 80% coverage thresholds |
| Dev tools | Docker Compose (MySQL, phpMyAdmin, Redis, Redis Commander) |

### AI-Powered Development

Includes `.claude/` rules for Claude Code with project-specific conventions, architecture patterns, and coding standards for both client and server.

## Prerequisites

- **Node.js** 18+
- **Docker** (for MySQL and Redis)

## After Scaffolding

```bash
# 1. Start infrastructure
cd my-app/server
docker compose up -d

# 2. Install server dependencies & set up database
npm install
cp .env.example .env
npm run prisma:generate
npm run prisma:migrate:dev -- --name init

# 3. Start the server
npm run dev

# 4. In a new terminal, set up the client
cd my-app/client
npm install
cp .env.example .env
npm run dev
```

- Server: http://localhost:8000
- Client: http://localhost:3000
- phpMyAdmin: http://localhost:8080
- Redis Commander: http://localhost:8081

## License

MIT
