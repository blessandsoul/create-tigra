/**
 * The guarded outbound client for URLs that came from a user (an avatar or
 * import "from a link", webhooks, link previews). A URL like that must never
 * reach the database, Redis, Coolify's internal services or a cloud metadata
 * endpoint (SSRF). Trusted, hard-coded URLs use httpClient (libs/http.ts).
 *
 * Every connection is checked, not just the URL as written:
 * - http: and https: only (no file:, data:, ftp:, ...);
 * - an IP literal in the URL (first hop, or any redirect hop) must be a public
 *   address (isForbiddenOutboundIp, libs/url-safety.ts);
 * - a hostname is resolved by our own lookup, which refuses it when ANY answer
 *   is not public, and the socket then connects to exactly the addresses that
 *   were checked: a DNS answer cannot change between the check and the
 *   connection (DNS rebinding);
 * - redirects: at most 3, each hop checked the same way;
 * - environment proxies are ignored (with a proxy the lookup would check the
 *   proxy, and the proxy would fetch the internal target for us);
 * - 10 s timeout, 10 MB body cap (createHttpClient).
 *
 * A refused request throws OutboundHttpError with kind 'blocked' (a generic 500
 * unless the caller handles it, e.g. as "this link is not allowed").
 */
import dns, { type LookupAddress } from 'node:dns';
import { isIP } from 'node:net';
import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import { createHttpClient, OutboundHttpError, OUTBOUND_BLOCKED } from '@libs/http.js';
import { isForbiddenOutboundIp } from '@libs/url-safety.js';

const SAFE_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;

type Resolve = (hostname: string, options: { all: true; family?: number }) => Promise<LookupAddress[]>;

const systemResolve: Resolve = (hostname, options) => dns.promises.lookup(hostname, options);

/** The error our guards raise inside axios (recognised by libs/http.ts as kind 'blocked'). */
function blocked(): Error {
  return Object.assign(new Error('Outbound request refused: the target is not a public address'), {
    code: OUTBOUND_BLOCKED,
  });
}

/** The hostname as an IP literal (brackets stripped), or null when it is a name. */
function literalIp(hostname: string): string | null {
  const host = hostname.replace(/^\[|\]$/g, '');
  return isIP(host) ? host : null;
}

/** Whether a target (protocol + hostname) may be connected to, before any DNS. */
function isAllowedTarget(protocol: string, hostname: string, isForbidden: (ip: string) => boolean): boolean {
  if (protocol !== 'http:' && protocol !== 'https:') return false;
  const ip = literalIp(hostname);
  return ip === null || !isForbidden(ip);
}

export interface SafeHttpOptions {
  /** DNS resolver (tests inject one). */
  resolve?: Resolve;
  /** Address policy (tests may loosen it for a local server; production never). */
  isForbidden?: (ip: string) => boolean;
}

export function createSafeHttpClient({
  resolve = systemResolve,
  isForbidden = isForbiddenOutboundIp,
}: SafeHttpOptions = {}): AxiosInstance {
  // Every hostname connection resolves here; the socket uses only checked addresses.
  const lookup = async (hostname: string, options: { family?: number } = {}): Promise<LookupAddress[]> => {
    const answers = await resolve(hostname, { all: true, family: options.family || undefined });
    if (answers.length === 0 || answers.some((answer) => isForbidden(answer.address))) throw blocked();
    return answers;
  };

  const client = createHttpClient({
    timeout: SAFE_TIMEOUT_MS,
    maxRedirects: MAX_REDIRECTS,
    proxy: false,
    lookup,
    // Redirect hops: an IP literal skips the lookup, so check it (and the protocol) here.
    beforeRedirect: (options) => {
      if (!isAllowedTarget(String(options.protocol), String(options.hostname), isForbidden)) throw blocked();
    },
  });

  // First hop: refuse before anything is sent (an IP literal never reaches the lookup).
  client.interceptors.request.use((config: InternalAxiosRequestConfig): InternalAxiosRequestConfig => {
    let target: URL;
    try {
      target = new URL(String(config.url), config.baseURL);
    } catch {
      throw new OutboundHttpError('blocked');
    }
    if (!isAllowedTarget(target.protocol, target.hostname, isForbidden)) throw new OutboundHttpError('blocked');
    return config;
  });

  return client;
}

/** For URLs a user supplied. Trusted, hard-coded URLs: httpClient (libs/http.ts). */
export const safeHttpClient: AxiosInstance = createSafeHttpClient();
