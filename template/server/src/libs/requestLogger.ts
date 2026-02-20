import type { FastifyRequest, FastifyReply } from 'fastify';
import { logger } from '@libs/logger.js';

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

function getStatusColor(statusCode: number): string {
  if (statusCode >= 500) return colors.serverError;
  if (statusCode >= 400) return colors.clientError;
  if (statusCode >= 300) return colors.redirect;
  return colors.success;
}

function formatDuration(ms: number): string {
  if (ms < 1) return `${(ms * 1000).toFixed(0)}μs`;
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
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
 * Format: GET /api/v1/auth/me 200 OK (12ms)
 */
export function logRequestLine(request: FastifyRequest, reply: FastifyReply): void {
  const duration = request.startTime ? Date.now() - request.startTime : 0;
  const statusCode = reply.statusCode;
  const statusMessage = reply.raw.statusMessage || '';

  const methodColor = colors[request.method as keyof typeof colors] || colors.reset;
  const statusColor = getStatusColor(statusCode);

  const line = `${methodColor}${request.method.padEnd(7)}${colors.reset}${request.url} ${statusColor}${statusCode} ${statusMessage}${colors.reset} ${colors.dim}(${formatDuration(duration)})${colors.reset}`;

  if (statusCode >= 500) {
    logger.error(line);
  } else if (statusCode >= 400) {
    logger.warn(line);
  } else {
    logger.info(line);
  }
}
