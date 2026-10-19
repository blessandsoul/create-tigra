/**
 * The id that ties one request's log lines, error report and response together
 * (logged as reqId, echoed as the `x-request-id` response header).
 *
 * An inbound X-Request-Id is honoured so a proxy in front can pass its own id
 * along, but only when it is short and plain: anyone can send that header, and
 * the value lands in every log line of the request and in the response. A
 * 16 KB id would bloat the logs; a reused one would make an attacker's requests
 * look like part of someone else's trace. Anything else gets a fresh UUID.
 */
import { randomUUID } from 'node:crypto';

/** Up to 128 letters, digits, dots, underscores or dashes (covers UUIDs and proxy ids). */
export const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

export function requestIdFrom(header: string | string[] | undefined): string {
  return typeof header === 'string' && REQUEST_ID_PATTERN.test(header) ? header : randomUUID();
}
