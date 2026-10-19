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

/**
 * Whether request lines carry their parts as separate JSON fields. Only where
 * logs are JSON (production, the same switch as the pino-pretty transport in
 * logger.ts): pino-pretty would print each field on its own line under every
 * request, while a developer reads the one-line summary anyway.
 */
export function shouldAttachFields(nodeEnv: string): boolean {
  return nodeEnv === 'production';
}

// Decided once at startup: neither stdout nor NODE_ENV changes at runtime.
const useColor = shouldColorize(process.stdout.isTTY, env.NODE_ENV);
const attachFields = shouldAttachFields(env.NODE_ENV);

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
 * The URL without its query string or fragment. Queries carry search terms,
 * email addresses and the like (`/admin/users?search=jane@example.com`), and
 * links in emails carry tokens, so no request log keeps them; route params
 * stay (they are ids, not secrets).
 */
export function requestPath(url: string): string {
  const end = url.search(/[?#]/);
  return end === -1 ? url : url.slice(0, end);
}

/** The request line's parts as JSON fields, for searching and alerting on production logs. */
export interface RequestLogFields {
  reqId: string;
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
  ip: string;
}

export function requestLogFields(parts: RequestLineParts): RequestLogFields {
  return {
    reqId: parts.requestId,
    method: parts.method,
    path: requestPath(parts.url),
    statusCode: parts.statusCode,
    durationMs: parts.durationMs,
    ip: parts.clientIp,
  };
}

/**
 * Build the one-line summary. Pure (no I/O), so the colour rule is testable.
 * With `color: false` the line contains no escape codes at all. The URL is
 * printed without its query (requestPath).
 */
export function formatRequestLine(parts: RequestLineParts, { color }: { color: boolean }): string {
  const paint = (code: string, text: string): string => (color ? `${code}${text}${colors.reset}` : text);
  const methodColor = colors[parts.method as keyof typeof colors] || colors.reset;

  return [
    paint(methodColor, parts.method.padEnd(7)),
    `${requestPath(parts.url)} `,
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
 * In production the same parts also go out as JSON fields
 * ({ reqId, method, path, statusCode, durationMs, ip }), so log search can
 * filter on them instead of parsing the text. Neither keeps the query string.
 *
 * The IP is the proxy-aware resolved client IP (getClientIp): the verified
 * CF-Connecting-IP behind Cloudflare, otherwise the address our own proxy saw.
 * reqId is request.id (inbound X-Request-Id or the minted UUID) for log↔Sentry
 * tie-up. Colours follow shouldColorize(); production lines are plain text.
 * `options` exists for tests; the app always uses the startup decision.
 */
export function logRequestLine(
  request: FastifyRequest,
  reply: FastifyReply,
  options: { color: boolean; fields: boolean } = { color: useColor, fields: attachFields },
): void {
  const statusCode = reply.statusCode;
  const parts: RequestLineParts = {
    method: request.method,
    url: request.url,
    statusCode,
    statusMessage: reply.raw.statusMessage || '',
    durationMs: request.startTime ? Date.now() - request.startTime : 0,
    clientIp: getClientIp(request),
    requestId: String(request.id),
  };
  const line = formatRequestLine(parts, { color: options.color });
  const level = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info';

  if (options.fields) {
    logger[level](requestLogFields(parts), line);
  } else {
    logger[level](line);
  }
}
