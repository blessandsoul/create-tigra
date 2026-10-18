/**
 * Refresh Cloudflare IP Ranges Job
 *
 * Keeps libs/cloudflare-ranges.ts in step with Cloudflare's published edge ranges: once shortly
 * after start, then every 24 hours. The bundled list keeps working when a refresh fails, so this
 * job is a freshness optimisation, not a dependency (see that module for why it matters).
 * Skipped under NODE_ENV=test so test runs never make outbound calls.
 */

import type { FastifyInstance } from 'fastify';
import { env } from '@config/env.js';
import { refreshCloudflareRanges } from '@libs/cloudflare-ranges.js';

const INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const FIRST_RUN_DELAY_MS = 30 * 1000; // off the startup path

export function startRefreshCloudflareRangesJob(app: FastifyInstance): void {
  if (env.NODE_ENV === 'test') return;

  // refreshCloudflareRanges never throws; it logs and keeps the current list on failure.
  const firstRun = setTimeout(() => void refreshCloudflareRanges(), FIRST_RUN_DELAY_MS);
  const intervalId = setInterval(() => void refreshCloudflareRanges(), INTERVAL_MS);
  // Timers must not keep the process alive on their own (graceful shutdown).
  firstRun.unref();
  intervalId.unref();

  app.addHook('onClose', async () => {
    clearTimeout(firstRun);
    clearInterval(intervalId);
  });
}
