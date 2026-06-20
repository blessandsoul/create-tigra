import { AsyncLocalStorage } from 'node:async_hooks';
import type { FastifyInstance } from 'fastify';
import { prisma } from './prisma.js';
import { env } from '@config/env.js';

/**
 * Dev-only per-request Prisma query counter → the `X-Query-Count` response header.
 *
 * Rides the query events prisma.ts already emits (`{ emit: 'event', level: 'query' }`): an
 * AsyncLocalStorage store is entered per request, every emitted query increments it, and the
 * total ships back as `X-Query-Count`. This lets a black-box perf/load tester (the fleet's
 * perf-tester) see N+1 at the source over plain HTTP — no DB access, no profiler needed.
 *
 * Note on Prisma N+1: the engine's DataLoader auto-batches relation `include`s and same-tick
 * calls, so the queries this counts are the ones that actually matter — sequential awaited
 * queries in a loop (`for (...) await prisma.x.find()`), the real application-level N+1.
 *
 * NEVER active in production: no listener, no header, zero overhead — purely a dev aid.
 */
interface QueryCountStore {
  count: number;
}

const als = new AsyncLocalStorage<QueryCountStore>();

let listenerAttached = false;
function attachQueryListener(): void {
  if (listenerAttached) return;
  listenerAttached = true;
  // Queries outside a counted request (startup, jobs) simply find no store and are ignored.
  prisma.$on('query' as never, () => {
    const store = als.getStore();
    if (store) store.count += 1;
  });
}

/**
 * Wire the dev-only `X-Query-Count` header onto every route. Call once with the root app
 * instance (top-level, so the hooks are global). No-op in production.
 */
export function registerQueryCounter(app: FastifyInstance): void {
  if (env.NODE_ENV === 'production') return;
  attachQueryListener();

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
