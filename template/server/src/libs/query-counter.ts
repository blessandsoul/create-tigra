import { AsyncLocalStorage } from 'node:async_hooks';
import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { env } from '@config/env.js';

/**
 * Dev and test only: the number of Prisma operations a request made, in the
 * `X-Query-Count` response header. This lets a black-box perf/load tester (the
 * fleet's perf-tester) see N+1 at the source over plain HTTP — no DB access, no
 * profiler needed.
 *
 * How it counts: an AsyncLocalStorage store is entered per request, and
 * queryCountExtension (applied to the client in prisma.ts) adds one for every
 * Prisma operation that request runs: model calls (findMany, update, ...) and
 * raw queries ($queryRaw, $executeRaw) alike. It counts operations, not SQL
 * statements (an `include` can add a statement inside one operation).
 *
 * Why an extension and not Prisma's `query` log events: the engine emits those
 * outside the request's async context, so the store was never found and the
 * header always said 0. An extension runs in the caller's context.
 *
 * Note on Prisma N+1: the engine's DataLoader auto-batches relation `include`s and same-tick
 * calls, so the operations this counts are the ones that actually matter — sequential awaited
 * queries in a loop (`for (...) await prisma.x.find()`), the real application-level N+1.
 *
 * NEVER active in production: no extension, no store, no header — purely a dev aid.
 */
interface QueryCountStore {
  count: number;
}

const als = new AsyncLocalStorage<QueryCountStore>();

/**
 * Counts each Prisma operation into the current request's store. Operations
 * outside a counted request (startup, jobs, tests without a request) find no
 * store and are not counted. prisma.ts applies it outside production only.
 */
export const queryCountExtension = Prisma.defineExtension({
  name: 'query-counter',
  query: {
    $allOperations({ args, query }) {
      const store = als.getStore();
      if (store) store.count += 1;
      return query(args);
    },
  },
});

/**
 * Wire the dev-only `X-Query-Count` header onto every route. Call once with the root app
 * instance (top-level, so the hooks are global). No-op in production.
 */
export function registerQueryCounter(app: FastifyInstance): void {
  if (env.NODE_ENV === 'production') return;

  // Wrap the whole request lifecycle in a fresh store via the callback-style hook: passing
  // Fastify's `done` continuation into als.run() means every subsequent hook, the handler, and
  // the Prisma calls they make run inside this request's store (the @fastify/request-context
  // pattern — more robust than enterWith, which can be lost across the hook boundary).
  app.addHook('onRequest', (_request, _reply, done) => {
    als.run({ count: 0 }, done);
  });

  // onSend can still mutate headers (runs before the body is flushed).
  app.addHook('onSend', async (_request, reply, payload) => {
    const store = als.getStore();
    if (store) reply.header('X-Query-Count', String(store.count));
    return payload;
  });
}
