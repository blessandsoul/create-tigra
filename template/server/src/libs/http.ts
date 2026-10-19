/**
 * Outbound HTTP.
 *
 * `httpClient` is for TRUSTED, hard-coded URLs (provider APIs, Cloudflare's IP
 * list). A URL that came from a user must go through `safeHttpClient`
 * (libs/safe-http.ts), which refuses internal addresses.
 *
 * Both are built by `createHttpClient`, which adds:
 * - logging of every call (debug) and failure (error), with the URL passed
 *   through redactUrl: credentials, query strings (API keys!) and bot tokens
 *   never reach the logs; bodies and headers are never logged;
 * - a 10 MB cap on request and response bodies;
 * - one error type for every failure, OutboundHttpError: unhandled it is the
 *   same generic 500 as before (code INTERNAL_ERROR, nothing upstream leaks),
 *   while the caller can read `kind` and `status` to handle "not found" or retry
 *   only timeouts.
 */
import axios, {
  type AxiosError,
  type AxiosInstance,
  type CreateAxiosDefaults,
  type InternalAxiosRequestConfig,
  type AxiosResponse,
  isAxiosError,
} from 'axios';
import { logger } from '@libs/logger.js';
import { redactUrl } from '@libs/url-safety.js';
import { InternalError } from '@shared/errors/errors.js';

const TIMEOUT_MS = 30_000;
/** Largest request or response body any outbound call may carry. */
export const MAX_BODY_BYTES = 10 * 1024 * 1024;

/** Error code our own guards put on a refused request (libs/safe-http.ts). */
export const OUTBOUND_BLOCKED = 'OUTBOUND_BLOCKED';

export type OutboundFailureKind = 'http' | 'timeout' | 'network' | 'blocked' | 'too-large';

/**
 * Every outbound failure. Extends InternalError with the SAME code and message,
 * so an unhandled one answers the same generic 500 as before. `status` is the
 * upstream HTTP status when there was a response; `cause` keeps the original
 * error for the logs (pino logs only a cause's message and stack).
 */
export class OutboundHttpError extends InternalError {
  readonly kind: OutboundFailureKind;
  readonly status?: number;

  constructor(kind: OutboundFailureKind, options: { status?: number; cause?: unknown } = {}) {
    super('Outbound HTTP request failed');
    this.kind = kind;
    this.status = options.status;
    if (options.cause !== undefined) {
      Object.defineProperty(this, 'cause', { value: options.cause, enumerable: false });
    }
  }
}

/** True when this error, or one it wraps, was refused by our own guards. */
function wasBlocked(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth++) {
    if ((current as { code?: unknown }).code === OUTBOUND_BLOCKED) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

function failureKind(error: AxiosError): OutboundFailureKind {
  if (wasBlocked(error)) return 'blocked';
  if (error.response) return 'http';
  if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') return 'timeout';
  if (typeof error.message === 'string' && error.message.includes('maxContentLength')) return 'too-large';
  if (typeof error.message === 'string' && error.message.includes('maxBodyLength')) return 'too-large';
  return 'network';
}

/** URLs as they may be logged. */
const safeUrl = (url: string | undefined): string | undefined => (url === undefined ? undefined : redactUrl(url));

/** An axios instance with our logging, size caps and error type. */
export function createHttpClient(config: CreateAxiosDefaults = {}): AxiosInstance {
  const client = axios.create({
    timeout: TIMEOUT_MS,
    maxContentLength: MAX_BODY_BYTES,
    maxBodyLength: MAX_BODY_BYTES,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    ...config,
  });

  // Request interceptor — log every outbound call
  client.interceptors.request.use(
    (requestConfig: InternalAxiosRequestConfig): InternalAxiosRequestConfig => {
      logger.debug(
        {
          method: requestConfig.method?.toUpperCase(),
          url: safeUrl(requestConfig.url),
          baseURL: safeUrl(requestConfig.baseURL),
        },
        '[HTTP] Outbound request',
      );
      return requestConfig;
    },
    (error: unknown): never => {
      logger.error({ err: error }, '[HTTP] Request setup failed');
      throw new InternalError('Outbound HTTP request could not be constructed');
    },
  );

  // Response interceptor — log responses and turn every failure into OutboundHttpError
  client.interceptors.response.use(
    (response: AxiosResponse): AxiosResponse => {
      logger.debug(
        {
          method: response.config.method?.toUpperCase(),
          url: safeUrl(response.config.url),
          status: response.status,
        },
        '[HTTP] Outbound response',
      );
      return response;
    },
    (error: unknown): never => {
      // Already ours (a guard refused the request before axios sent it).
      if (error instanceof OutboundHttpError) {
        logger.error({ kind: error.kind }, '[HTTP] Outbound request refused');
        throw error;
      }
      if (isAxiosError(error)) {
        logger.error(
          {
            method: error.config?.method?.toUpperCase(),
            url: safeUrl(error.config?.url),
            status: error.response?.status,
            message: error.message,
          },
          '[HTTP] Outbound request failed',
        );
        throw new OutboundHttpError(failureKind(error), { status: error.response?.status, cause: error });
      }
      logger.error({ err: error }, '[HTTP] Unexpected outbound error');
      throw new OutboundHttpError('network', { cause: error });
    },
  );

  return client;
}

/** For trusted, hard-coded URLs only. User-supplied URLs: safeHttpClient (libs/safe-http.ts). */
const httpClient: AxiosInstance = createHttpClient();

export { httpClient };
