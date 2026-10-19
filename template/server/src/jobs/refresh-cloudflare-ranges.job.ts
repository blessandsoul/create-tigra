/**
 * Refresh Cloudflare IP Ranges Job
 *
 * Keeps libs/cloudflare-ranges.ts in step with Cloudflare's published edge ranges: once shortly
 * after start, then every 24 hours (jobs/schedule.ts). The bundled list keeps working when a
 * refresh fails, so this job is a freshness optimisation, not a dependency (see that module for
 * why it matters). Skipped under NODE_ENV=test so test runs never make outbound calls.
 */

import type { FastifyInstance } from 'fastify';
import { env } from '@config/env.js';
import { refreshCloudflareRanges } from '@libs/cloudflare-ranges.js';
import { startRecurringJob } from './schedule.js';

const INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const FIRST_RUN_DELAY_MS = 30 * 1000; // off the startup path

export function startRefreshCloudflareRangesJob(app: FastifyInstance): void {
  if (env.NODE_ENV === 'test') return;

  // refreshCloudflareRanges never throws; it logs and keeps the current list on failure.
  startRecurringJob(app, {
    name: 'refresh-cloudflare-ranges',
    intervalMs: INTERVAL_MS,
    firstRunDelayMs: FIRST_RUN_DELAY_MS,
    run: () => refreshCloudflareRanges(),
  });
}
