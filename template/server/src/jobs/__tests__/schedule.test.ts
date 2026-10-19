/**
 * startRecurringJob (jobs/schedule.ts) with fake timers: a job runs once
 * shortly after start, then on its interval; a failing run is logged and the
 * schedule goes on; runs never overlap; app close stops it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { logger } from '@libs/logger.js';
import { startRecurringJob } from '../schedule.js';

vi.mock('@libs/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** A stand-in app that records onClose hooks so the test can "close" it. */
function fakeApp(): { app: FastifyInstance; close: () => Promise<void> } {
  const hooks: Array<() => Promise<void>> = [];
  const app = { addHook: (name: string, fn: () => Promise<void>) => name === 'onClose' && hooks.push(fn) };
  return { app: app as unknown as FastifyInstance, close: async () => { for (const h of hooks) await h(); } };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('startRecurringJob', () => {
  it('runs once shortly after start, then every interval (a restart never postpones it a full interval)', async () => {
    const run = vi.fn(async () => undefined);
    startRecurringJob(fakeApp().app, { name: 't', intervalMs: HOUR, firstRunDelayMs: MINUTE, run });

    await vi.advanceTimersByTimeAsync(MINUTE - 1);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(1); // one minute after start, not one hour
    await vi.advanceTimersByTimeAsync(HOUR);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('logs a failing run and keeps the schedule going', async () => {
    const run = vi.fn().mockRejectedValueOnce(new Error('db down')).mockResolvedValue(undefined);
    startRecurringJob(fakeApp().app, { name: 'purge', intervalMs: HOUR, firstRunDelayMs: MINUTE, run });

    await vi.advanceTimersByTimeAsync(MINUTE);
    expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ job: 'purge' }), '[JOB] purge failed');
    await vi.advanceTimersByTimeAsync(HOUR);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('skips a tick while the previous run is still busy (runs never overlap)', async () => {
    let finish!: () => void;
    const run = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    startRecurringJob(fakeApp().app, { name: 'slow', intervalMs: MINUTE, firstRunDelayMs: MINUTE, run });

    await vi.advanceTimersByTimeAsync(MINUTE); // first run starts and hangs
    await vi.advanceTimersByTimeAsync(MINUTE); // interval tick while busy: skipped
    expect(run).toHaveBeenCalledTimes(1);
    finish();
    await vi.advanceTimersByTimeAsync(MINUTE);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('stops when the app closes', async () => {
    const run = vi.fn(async () => undefined);
    const { app, close } = fakeApp();
    startRecurringJob(app, { name: 't', intervalMs: HOUR, firstRunDelayMs: MINUTE, run });
    await close();
    await vi.advanceTimersByTimeAsync(2 * HOUR);
    expect(run).not.toHaveBeenCalled();
  });

  it('does not keep the process alive on its own (timers are unref-ed)', () => {
    const unref = vi.fn();
    const spyTimeout = vi.spyOn(globalThis, 'setTimeout').mockReturnValue({ unref } as never);
    const spyInterval = vi.spyOn(globalThis, 'setInterval').mockReturnValue({ unref } as never);
    startRecurringJob(fakeApp().app, { name: 't', intervalMs: HOUR, firstRunDelayMs: MINUTE, run: async () => undefined });
    expect(unref).toHaveBeenCalledTimes(2);
    spyTimeout.mockRestore();
    spyInterval.mockRestore();
  });
});
