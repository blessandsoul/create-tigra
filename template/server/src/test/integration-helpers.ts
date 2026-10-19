/**
 * Shared helpers for the `*.integration.test.ts` files: boot the real app,
 * sign users in, carry their cookies between requests, read the database and
 * Redis, and catch emails in an in-process stand-in for Resend.
 *
 * Everything that touches the app, Prisma or Redis is imported lazily (inside
 * the functions), never at the top: env.ts must not load before
 * src/test/integration.setup.ts has set the environment, and a test file may
 * still change process.env (rate limits on, an email stub) before its first
 * buildTestApp().
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';

/** The password every helper-made account uses. */
export const PASSWORD = 'Integration-Passw0rd!';

let sequence = 0;
/** An address no other test (or earlier run) has used. */
export function uniqueEmail(tag: string): string {
  sequence += 1;
  return `it-${Date.now().toString(36)}-${process.pid}-${sequence}-${tag}@example.test`;
}

/** The real app, ready for app.inject(). Close it in afterAll. */
export async function buildTestApp(): Promise<FastifyInstance> {
  const { buildApp } = await import('@/app.js');
  const app = await buildApp();
  await app.ready();
  return app;
}

/** The app's Prisma client (lazy, see the file header). */
export async function db(): Promise<typeof import('@/libs/prisma.js')['prisma']> {
  return (await import('@/libs/prisma.js')).prisma;
}

/** The app's Redis connection (lazy, see the file header). */
export async function redis(): Promise<ReturnType<typeof import('@/libs/redis.js')['getRedis']>> {
  return (await import('@/libs/redis.js')).getRedis();
}

const setCookiesOf = (res: LightMyRequestResponse): string[] => ([] as string[]).concat(res.headers['set-cookie'] ?? []);

/** Whether the response tells the browser to delete at least one cookie. */
export function clearsCookies(res: LightMyRequestResponse): boolean {
  return setCookiesOf(res).some((c) => /max-age=0/i.test(c) || /expires=thu, 01 jan 1970/i.test(c));
}

/** The cookies of one browser ("device"): absorbs Set-Cookie, sends them back. */
export class CookieJar {
  private readonly cookies = new Map<string, string>();

  absorb(res: LightMyRequestResponse): this {
    for (const header of setCookiesOf(res)) {
      const [pair, ...attributes] = header.split(';');
      const eq = pair.indexOf('=');
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      const expired = attributes.some((a) => /max-age=0/i.test(a) || /expires=thu, 01 jan 1970/i.test(a));
      if (expired || value === '') this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    return this;
  }

  get(name: string): string | undefined {
    return this.cookies.get(name);
  }

  /** The Cookie header for a request. */
  header(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  /** A second jar holding the same cookies (two tabs, or a stolen copy). */
  copy(): CookieJar {
    const jar = new CookieJar();
    for (const [k, v] of this.cookies) jar.cookies.set(k, v);
    return jar;
  }
}

export interface CallOptions {
  /** Sends this jar's cookies and keeps what the answer sets. */
  jar?: CookieJar;
  /** A raw Cookie header instead of a jar (it is not updated). */
  cookie?: string;
  payload?: unknown;
  headers?: Record<string, string>;
}

export interface CallResult {
  res: LightMyRequestResponse;
  status: number;
  /** error.code of an error answer. */
  code: string | undefined;
  body: { success?: boolean; data?: any; error?: { code?: string; fields?: { field: string }[] } } | null; // eslint-disable-line @typescript-eslint/no-explicit-any
}

/** One request through app.inject(), answered as { status, code, body }. */
export async function call(
  app: FastifyInstance,
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  url: string,
  options: CallOptions = {},
): Promise<CallResult> {
  const headers: Record<string, string> = { ...options.headers };
  const cookie = options.cookie ?? options.jar?.header();
  if (cookie) headers.cookie = cookie;
  const res = await app.inject({
    method,
    url: url.startsWith('/api/') || url.startsWith('/uploads/') ? url : `/api/v1${url}`,
    headers,
    ...(options.payload === undefined ? {} : { payload: options.payload as string | object }),
  });
  options.jar?.absorb(res);
  let body: CallResult['body'] = null;
  try {
    body = res.json();
  } catch {
    // not JSON (a file, an empty body)
  }
  return { res, status: res.statusCode, code: body?.error?.code, body };
}

export interface TestUser {
  id: string;
  email: string;
  /** Signed in: holds the cookies register set. */
  jar: CookieJar;
}

/** Registers a new USER (verification is off in this suite, so register signs in). */
export async function registerUser(
  app: FastifyInstance,
  tag: string,
  names: { firstName?: string; lastName?: string } = {},
): Promise<TestUser> {
  const email = uniqueEmail(tag);
  const jar = new CookieJar();
  const r = await call(app, 'POST', '/auth/register', {
    jar,
    payload: { email, password: PASSWORD, firstName: names.firstName ?? 'Test', lastName: names.lastName ?? 'User' },
  });
  if (r.status !== 201) throw new Error(`register ${tag}: ${r.status} ${r.code}`);
  return { id: r.body?.data?.user?.id as string, email, jar };
}

/** Signs in again (a new device): a fresh jar. */
export async function signIn(app: FastifyInstance, email: string, password = PASSWORD): Promise<CookieJar> {
  const jar = new CookieJar();
  const r = await call(app, 'POST', '/auth/login', { jar, payload: { email, password } });
  if (r.status !== 200) throw new Error(`login: ${r.status} ${r.code}`);
  return jar;
}

/** Makes an account ADMIN (and verified) in the database; the role is read on every request. */
export async function makeAdmin(userId: string): Promise<void> {
  await (await db()).user.update({ where: { id: userId }, data: { role: 'ADMIN', emailVerifiedAt: new Date() } });
}

/** A registered user turned ADMIN, still signed in. */
export async function registerAdmin(app: FastifyInstance, tag: string): Promise<TestUser> {
  const user = await registerUser(app, tag);
  await makeAdmin(user.id);
  return user;
}

/** A small image of the given format, made by sharp. */
export async function image(
  format: 'jpeg' | 'png' | 'webp' | 'avif',
  width = 64,
  height = 48,
): Promise<Buffer> {
  const sharp = (await import('sharp')).default;
  return sharp({ create: { width, height, channels: 3, background: '#3a7bd5' } })[format]().toBuffer();
}

/** A multipart body with one file field named "file", for app.inject(). */
export function multipartFile(
  bytes: Buffer,
  { filename = 'blob', type = 'application/octet-stream' }: { filename?: string; type?: string } = {},
): { payload: Buffer; headers: Record<string, string> } {
  const boundary = `----integration${Date.now().toString(16)}`;
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${type}\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { payload: Buffer.concat([head, bytes, tail]), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

/** Uploads bytes as the signed-in user's avatar (or another path). */
export async function uploadAvatar(
  app: FastifyInstance,
  jar: CookieJar,
  bytes: Buffer,
  options: { filename?: string; type?: string; url?: string } = {},
): Promise<CallResult> {
  const { payload, headers } = multipartFile(bytes, options);
  return call(app, 'POST', options.url ?? '/users/avatar', { jar, payload, headers });
}

/** An email the stub received. `link` is the first verify/reset link in it. */
export interface CaughtEmail {
  to: string;
  subject: string;
  html: string;
  link: string | null;
}

export interface EmailStub {
  sent: CaughtEmail[];
  /** The emails sent to one address, newest last. */
  to(address: string): CaughtEmail[];
  close(): Promise<void>;
}

/**
 * A local stand-in for the Resend API: every send is recorded and answered
 * like Resend does, so tests read the links the app emails without sending
 * anything. Sets RESEND_API_KEY and RESEND_BASE_URL (read by the Resend SDK
 * when it loads), so call it BEFORE buildTestApp() in that file.
 */
export async function startEmailStub(): Promise<EmailStub> {
  const sent: CaughtEmail[] = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => (raw += chunk.toString('utf8')));
    req.on('end', () => {
      let body: { to?: string | string[]; subject?: string; html?: string } = {};
      try {
        body = JSON.parse(raw);
      } catch {
        // not JSON
      }
      const html = String(body.html ?? '');
      sent.push({
        to: Array.isArray(body.to) ? body.to.join(',') : String(body.to ?? ''),
        subject: String(body.subject ?? ''),
        html,
        link: /href="([^"]*(?:verify-account|reset-password)\?token=[^"]+)"/.exec(html)?.[1] ?? null,
      });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: `stub_${sent.length}` }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  process.env.RESEND_API_KEY = 're_integration_stub_key';
  process.env.RESEND_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    sent,
    to: (address) => sent.filter((e) => e.to.includes(address)),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** The token in an emailed link. */
export function tokenOf(link: string | null): string {
  if (!link) throw new Error('no link in the email');
  return new URL(link).searchParams.get('token') ?? '';
}
