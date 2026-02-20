# Create Server Project

You are scaffolding a new Fastify + TypeScript backend project. The project name is: **$ARGUMENTS**

If no project name is provided, ask the user for one before proceeding.

---

## Instructions

Create a complete, production-ready Fastify server project following the architecture and rules defined in `.claude/rules/server/`. Read those rules before generating any code.

### Step 1: Project Root Setup

Create the project directory named `$ARGUMENTS` with the following root files:

#### `package.json`
```json
{
  "name": "$ARGUMENTS",
  "version": "1.0.0",
  "description": "",
  "main": "dist/server.js",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc && tsc-alias",
    "start": "node dist/server.js",
    "prisma:generate": "prisma generate",
    "prisma:migrate:dev": "prisma migrate dev",
    "prisma:migrate:deploy": "prisma migrate deploy",
    "prisma:reset": "prisma migrate reset",
    "prisma:seed": "prisma db seed",
    "prisma:studio": "prisma studio",
    "lint": "eslint src/",
    "docker:up": "docker compose up -d",
    "docker:down": "docker compose down",
    "docker:logs": "docker compose logs -f"
  },
  "prisma": {
    "seed": "tsx prisma/seed.ts"
  }
}
```

Install these dependencies (use npm):
```
# Dependencies
npm install fastify @fastify/cors @fastify/helmet @fastify/rate-limit @fastify/cookie @fastify/jwt
npm install @prisma/client zod dotenv pino pino-pretty ioredis bcryptjs uuid

# Dev dependencies
npm install -D typescript tsx tsc-alias prisma @types/node @types/bcryptjs @types/uuid eslint @eslint/js typescript-eslint
```

#### `tsconfig.json`
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "dist",
    "rootDir": "src",
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"],
      "@modules/*": ["./src/modules/*"],
      "@libs/*": ["./src/libs/*"],
      "@config/*": ["./src/config/*"],
      "@shared/*": ["./src/shared/*"]
    }
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

> **Note**: The `tsc-alias` package resolves path aliases at build time. `tsx` handles paths natively in development.

#### `eslint.config.mjs`
```js
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/explicit-function-return-type': 'warn',
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    ignores: ['dist/', 'node_modules/', 'prisma/'],
  }
);
```

#### `.env` and `.env.example`
```env
# App
NODE_ENV=development
PORT=3000
HOST=0.0.0.0

# Database
DATABASE_URL="mysql://root:rootpassword@localhost:3306/$ARGUMENTS"

# Redis
REDIS_URL="redis://localhost:6379"

# JWT
JWT_SECRET="change-this-to-a-secure-random-string"
JWT_ACCESS_EXPIRY="15m"
JWT_REFRESH_EXPIRY="7d"

# CORS
CORS_ORIGIN="http://localhost:3001"
```

#### `.gitignore`
Include: node_modules, dist, .env, .env.local, .env*.local, *.log, .prisma

#### `docker-compose.yml`
Create a Docker Compose file with these services:
1. **mysql** - MySQL 8.0, port 3306, database name = `$ARGUMENTS`, root password = `rootpassword`, volume for data persistence, healthcheck
2. **phpmyadmin** - Latest, port 8080, linked to mysql
3. **redis** - Redis 7 Alpine, port 6379, volume for data persistence, healthcheck
4. **redis-commander** - Redis Commander UI, port 8081, linked to redis

Use a named network for all services. Add restart policies.

---

### Step 2: Source Code Structure

Create the following directory structure under `src/`:

```
src/
├── app.ts                    # Fastify instance, plugin registration
├── server.ts                 # listen() call only
├── config/
│   └── env.ts                # Zod-validated environment variables
├── libs/
│   ├── prisma.ts             # Prisma client singleton
│   ├── redis.ts              # Redis client singleton
│   ├── logger.ts             # Pino logger
│   └── auth.ts               # JWT helpers (sign, verify, middleware)
├── shared/
│   ├── errors/
│   │   ├── AppError.ts       # Base error class
│   │   └── errors.ts         # All typed error subclasses
│   ├── responses/
│   │   ├── successResponse.ts
│   │   └── paginatedResponse.ts
│   ├── schemas/
│   │   └── pagination.schema.ts  # Shared Zod pagination schema
│   └── types/
│       └── index.ts          # Shared TypeScript types
└── modules/
    └── auth/                 # Auth module
        ├── auth.routes.ts
        ├── auth.controller.ts
        ├── auth.service.ts
        ├── auth.repo.ts
        └── auth.schemas.ts
```

---

### Step 3: Core Files Implementation

#### `src/config/env.ts`
- Use Zod to validate ALL environment variables at startup
- Export typed `env` object
- Crash immediately with clear message if validation fails

#### `src/libs/logger.ts`
- Use Pino logger
- Pretty print in development, JSON in production
- Export singleton `logger`

#### `src/libs/prisma.ts`
- Singleton Prisma client
- Handle graceful shutdown (disconnect on process exit)

#### `src/libs/redis.ts`
- Singleton ioredis client
- Configure from `REDIS_URL` env
- Handle connection errors with logger
- Handle graceful shutdown

#### `src/libs/auth.ts`
- JWT sign/verify using @fastify/jwt
- Fastify `authenticate` preHandler decorator
- Fastify `optionalAuth` preHandler decorator
- Role-based `authorize(...roles)` preHandler

#### `src/shared/errors/AppError.ts`
- Base `AppError` class extending `Error` with: `code`, `statusCode`, `message`

#### `src/shared/errors/errors.ts`
- Export all subclasses: `BadRequestError`, `ValidationError`, `UnauthorizedError`, `ForbiddenError`, `NotFoundError`, `ConflictError`, `InternalError`
- Each with appropriate default status code and code string

#### `src/shared/responses/successResponse.ts`
```typescript
export function successResponse<T>(message: string, data: T) {
  return { success: true as const, message, data };
}
```

#### `src/shared/responses/paginatedResponse.ts`
```typescript
export function paginatedResponse<T>(
  message: string,
  items: T[],
  page: number,
  limit: number,
  totalItems: number
) {
  const totalPages = Math.ceil(totalItems / limit);
  return {
    success: true as const,
    message,
    data: {
      items,
      pagination: {
        page,
        limit,
        totalItems,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
    },
  };
}
```

#### `src/shared/schemas/pagination.schema.ts`
```typescript
import { z } from 'zod';

export const PaginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
});

export type PaginationInput = z.infer<typeof PaginationSchema>;
```

#### `src/app.ts`
- Create and configure Fastify instance
- Register plugins: cors, helmet, rate-limit, cookie, jwt
- Register health check route: `GET /api/v1/health` — returns `successResponse('Server is healthy', { status: 'ok', timestamp: new Date().toISOString() })`
- Register global error handler that maps `AppError` → proper response format
- Register routes with `/api/v1` prefix
- Export the app instance

The global error handler MUST:
- Check if error is `AppError` → use its code, message, statusCode
- Check if error is Zod validation error → 422 with validation details
- Check if error is Fastify validation error → 400
- Default to 500 Internal Server Error
- Log internal errors with logger
- NEVER expose stack traces or internal details to client

#### `src/server.ts`
- Import app from `app.ts`
- Import env config
- Call `app.listen({ port, host })`
- Log startup message with port and environment
- Handle graceful shutdown (SIGINT, SIGTERM) — close Fastify, disconnect Prisma, disconnect Redis

---

### Step 4: Auth Module

Create a working auth module with these endpoints:
- `POST /api/v1/auth/register` - Register new user
- `POST /api/v1/auth/login` - Login with email/password
- `POST /api/v1/auth/logout` - Logout (invalidate refresh token)
- `POST /api/v1/auth/refresh` - Refresh access token
- `GET /api/v1/auth/me` - Get current user (protected)

Follow the layered architecture:
- **auth.schemas.ts** - Zod schemas for register, login, refresh input
- **auth.controller.ts** - Validate input, call service, return `successResponse()`
- **auth.service.ts** - Business logic, bcrypt hashing, JWT token generation, throw typed errors
- **auth.repo.ts** - Prisma queries for users and refresh tokens
- **auth.routes.ts** - Fastify plugin registering routes with appropriate preHandlers

---

### Step 5: Prisma Setup

#### `prisma/schema.prisma`
```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "mysql"
  url      = env("DATABASE_URL")
}

model User {
  id            String    @id @default(uuid())
  email         String    @unique
  password      String
  firstName     String
  lastName      String
  role          String    @default("USER")
  isActive      Boolean   @default(true)
  emailVerified Boolean   @default(false)
  deletedAt     DateTime?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  refreshTokens RefreshToken[]

  @@map("users")
}

model RefreshToken {
  id        String   @id @default(uuid())
  token     String   @unique @db.VarChar(500)
  userId    String
  expiresAt DateTime
  createdAt DateTime @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([token])
  @@map("refresh_tokens")
}
```

#### `prisma/seed.ts`
- Create a basic seed file that creates an admin user and a test user
- Use bcrypt to hash passwords
- Wrap in try/catch with proper logging

---

### Step 6: Final Verification

After creating all files:
1. Run `npm install` to install dependencies
2. Run `docker compose up -d` to start services (if Docker is available, otherwise remind the user)
3. Wait for MySQL to be healthy, then run `npx prisma migrate dev --name init`
4. Run `npx prisma generate`
5. Run `npx prisma db seed`
6. Verify the project starts with `npm run dev`
7. Test health check: `curl http://localhost:3000/api/v1/health`

If Docker is not running, inform the user they need to run `docker compose up -d` before running migrations.

---

## IMPORTANT RULES

- Follow ALL rules from `.claude/rules/server/` and `.claude/rules/global/`
- Use the EXACT response format from `response-handling.md` (includes pagination contract)
- All routes prefixed with `/api/v1`
- TypeScript strict mode
- No `console.log` — use logger
- No raw `Error` throws — use AppError subclasses
- Named exports everywhere except `app.ts`
