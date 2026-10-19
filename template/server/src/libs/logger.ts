import pino from 'pino';
import { env } from '@config/env.js';

/**
 * Field names that never reach the logs, wherever they sit in a logged object
 * from the top level down to three levels deep (and inside arrays there).
 * A safety net: no template code logs these today, but a debug line such as
 * `logger.info(request.body)` must not leak a password. To protect a new
 * field, add its exact key here (matching is exact and case-sensitive).
 */
const SECRET_KEYS = [
  'password',
  'newPassword',
  'currentPassword',
  'passwordHash',
  'token',
  'accessToken',
  'refreshToken',
  'access_token',
  'refresh_token',
  'secret',
  'clientSecret',
  'apiKey',
  'api_key',
  'authorization',
  'cookie',
];

/** Secret headers (same list as observability/sentry.ts SECRET_HEADERS), raw and under the `req` serializer. */
const SECRET_HEADERS = ['authorization', 'cookie', 'set-cookie', 'proxy-authorization', 'x-api-key', 'x-origin-verify'];

/**
 * pino redact paths. A `*` matches exactly ONE level (pino has no "any depth"
 * wildcard), so every key is listed at depths 0 to 3 explicitly; deeper keys
 * are not covered. Measured cost: a few microseconds per log line.
 */
export const REDACT_PATHS: string[] = [
  ...SECRET_HEADERS.flatMap((h) => [`req.headers["${h}"]`, `headers["${h}"]`]),
  ...SECRET_KEYS.flatMap((k) => [k, `*.${k}`, `*.*.${k}`, `*.*.*.${k}`]),
];

export const logger = pino({
  level: env.LOG_LEVEL,
  // Never let secrets reach the logs (REDACT_PATHS above). `remove: true` drops
  // the key entirely rather than emitting "[Redacted]".
  redact: {
    paths: REDACT_PATHS,
    remove: true,
  },
  ...(env.NODE_ENV !== 'production' && {
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'HH:MM:ss.l',
        ignore: 'pid,hostname',
        messageFormat: '{msg}',
      },
    },
  }),
  serializers: {
    req: (req) => ({
      method: req.method,
      url: req.url,
      query: req.query,
      params: req.params,
      headers: {
        host: req.headers.host,
        'user-agent': req.headers['user-agent'],
        'content-type': req.headers['content-type'],
      },
    }),
    res: (res) => ({
      statusCode: res.statusCode,
    }),
  },
});
