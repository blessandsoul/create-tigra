import type { FastifyRequest, FastifyReply } from 'fastify';
import { env } from '@config/env.js';
import { logger } from '@libs/logger.js';
import { getClientIp } from '@libs/client-ip.js';

const colors = {
  // Methods: blue=read, green=create, yellow=update, red=destroy, gray=meta
  GET: '\x1b[34m',
  POST: '\x1b[32m',
  PUT: '\x1b[33m',
  PATCH: '\x1b[33m',
  DELETE: '\x1b[31m',
  OPTIONS: '\x1b[90m',
  HEAD: '\x1b[90m',

  // Status: green=ok, cyan=redirect, yellow=client error, red=server error
  success: '\x1b[32m',
  redirect: '\x1b[36m',
  clientError: '\x1b[33m',
  serverError: '\x1b[31m',

  dim: '\x1b[90m',
  reset: '\x1b[0m',
};

/**
 * Whether request lines get terminal colours. Only for a developer watching a
 * real terminal: in production pino writes JSON, where escape codes would end
 * up as literal `\u001b[34m` junk inside `msg` (Coolify and log search show
 * them verbatim). Production never gets colours, even if stdout is a TTY.
 */
export function shouldColorize(isTty: boolean | undefined, nodeEnv: string): boolean {
  return isTty === true && nodeEnv !== 'production';
}

// Decided once at startup: neither stdout nor NODE_ENV changes at runtime.
const useColor = shouldColorize(process.stdout.isTTY, env.NODE_ENV);

function getStatusColor(statusCode: number): string {
  if (statusCode >= 500) return colors.serverError;
  if (statusCode >= 400) return colors.clientError;
  if (statusCode >= 300) return colors.redirect;
  return colors.success;
}

function formatDuration(ms: number): string {
  if (ms < 1) return `${(ms * 1000).toFixed(0)}us`;
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export interface RequestLineParts {
  method: string;
  url: string;
  statusCode: number;
  statusMessage: string;
  durationMs: number;
  clientIp: string;
  requestId: string;
}

/**
 * Build the one-line summary. Pure (no I/O), so the colour rule is testable.
 * With `color: false` the line contains no escape codes at all.
 */
export function formatRequestLine(parts: RequestLineParts, { color }: { color: boolean }): string {
  const paint = (code: string, text: string): string => (color ? `${code}${text}${colors.reset}` : text);
  const methodColor = colors[parts.method as keyof typeof colors] || colors.reset;

  return [
    paint(methodColor, parts.method.padEnd(7)),
    `${parts.url} `,
    paint(getStatusColor(parts.statusCode), `${parts.statusCode} ${parts.statusMessage}`),
    ' ',
    paint(colors.dim, `(${formatDuration(parts.durationMs)}) [ip=${parts.clientIp} reqId=${parts.requestId}]`),
  ].join('');
}

/**
 * Mark request start time (called in preHandler)
 */
export function markRequestStart(request: FastifyRequest): void {
  request.startTime = Date.now();
}

/**
 * Log a single-line request/response summary (called in onResponse)
 *
 * Format: GET /api/v1/auth/me 200 OK (12ms) [ip=203.0.113.7 reqId=<uuid>]
 *
 * The IP is the proxy-aware resolved client IP (getClientIp): the verified
 * CF-Connecting-IP behind Cloudflare, otherwise the address our own proxy saw.
 * reqId is request.id (inbound X-Request-Id or the minted UUID) for log↔Sentry
 * tie-up. Colours follow shouldColorize(); production lines are plain text.
 */
export function logRequestLine(request: FastifyRequest, reply: FastifyReply): void {
  const statusCode = reply.statusCode;
  const line = formatRequestLine(
    {
      method: request.method,
      url: request.url,
      statusCode,
      statusMessage: reply.raw.statusMessage || '',
      durationMs: request.startTime ? Date.now() - request.startTime : 0,
      clientIp: getClientIp(request),
      requestId: String(request.id),
    },
    { color: useColor },
  );

  if (statusCode >= 500) {
    logger.error(line);
  } else if (statusCode >= 400) {
    logger.warn(line);
  } else {
    logger.info(line);
  }
}
