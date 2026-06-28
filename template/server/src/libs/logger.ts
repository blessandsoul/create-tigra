import pino from 'pino';
import { env } from '@config/env.js';

export const logger = pino({
  level: env.LOG_LEVEL,
  // Never let secrets reach the logs. Covers auth/cookie headers (raw and under
  // the `req` serializer) plus any password/token/secret field at any depth.
  // `remove: true` drops the key entirely rather than emitting "[Redacted]".
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'headers.authorization',
      'headers.cookie',
      '*.password',
      '*.token',
      '*.secret',
    ],
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
