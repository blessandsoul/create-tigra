// @vitest-environment jsdom
/**
 * The API client's session rules, against a fake transport (an axios adapter):
 * one refresh for parallel 401s, a lost refresh race between tabs, a dead
 * session, a network failure, limits, the start-up probe and a ban mid-session.
 * Each test loads a fresh copy of the module, because the refresh state and the
 * circuit breaker live at module level.
 */
import { AxiosError, type AxiosAdapter, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@/lib/api/hard-redirect', () => ({ hardRedirect: vi.fn() }));

type Handler = (config: InternalAxiosRequestConfig) => { status: number; body?: unknown } | 'network';

/** The server's answer for one request: 2xx resolves, anything else rejects like axios' own adapters. */
function respond(config: InternalAxiosRequestConfig, status: number, body?: unknown): Promise<AxiosResponse> {
  const response: AxiosResponse = { data: body, status, statusText: '', headers: {}, config };
  if (status >= 200 && status < 300) return Promise.resolve(response);
  return Promise.reject(new AxiosError(`Request failed with status code ${status}`, 'ERR_BAD_REQUEST', config, undefined, response));
}

const fail = (code: string, extra: Record<string, unknown> = {}): unknown => ({ success: false, error: { code, message: code, ...extra } });

async function load(handler: Handler) {
  vi.resetModules();
  const { apiClient } = await import('../axios.config');
  const events = await import('../session-events');
  const { hardRedirect } = await import('@/lib/api/hard-redirect');
  const { toast } = await import('sonner');
  const calls: string[] = [];
  const adapter: AxiosAdapter = async (config) => {
    calls.push(`${config.method?.toUpperCase()} ${config.url}`);
    await new Promise((r) => setTimeout(r, 5)); // let parallel requests overlap
    const answer = handler(config);
    if (answer === 'network') throw new AxiosError('Network Error', 'ERR_NETWORK', config);
    return respond(config, answer.status, answer.body);
  };
  apiClient.defaults.adapter = adapter;
  const ended: string[] = [];
  events.onSessionEnded((reason) => ended.push(reason));
  return { apiClient, calls, ended, hardRedirect: vi.mocked(hardRedirect), toastError: vi.mocked(toast.error) };
}

const count = (calls: string[], call: string): number => calls.filter((c) => c === call).length;

beforeEach(() => {
  // Module mocks survive vi.resetModules(): forget the previous test's calls.
  vi.clearAllMocks();
  document.cookie = 'auth_session=1; path=/';
});

describe('expired access token', () => {
  it('parallel 401s share ONE refresh, then every request is replayed', async () => {
    let refreshed = false;
    const t = await load((c) => {
      if (c.url === '/auth/refresh') { refreshed = true; return { status: 200 }; }
      return refreshed ? { status: 200, body: { ok: c.url } } : { status: 401, body: fail('UNAUTHORIZED') };
    });
    const [a, b] = await Promise.all([t.apiClient.get('/a'), t.apiClient.get('/b')]);
    expect([a.data, b.data]).toEqual([{ ok: '/a' }, { ok: '/b' }]);
    expect(count(t.calls, 'POST /auth/refresh')).toBe(1);
    expect(t.ended).toEqual([]);
  });

  it('a lost refresh race (another tab won) replays the request and keeps the session', async () => {
    let refreshAttempted = false;
    const t = await load((c) => {
      if (c.url === '/auth/refresh') { refreshAttempted = true; return { status: 401, body: fail('REFRESH_TOKEN_ROTATED') }; }
      // The winner's fresh cookies are already in the browser: the replay works.
      return refreshAttempted ? { status: 200, body: 'fresh' } : { status: 401, body: fail('UNAUTHORIZED') };
    });
    const r = await t.apiClient.get('/sessions');
    expect(r.data).toBe('fresh');
    expect(t.ended).toEqual([]);
    expect(t.hardRedirect).not.toHaveBeenCalled();
    expect(document.cookie).toContain('auth_session=1');
  });

  it('a lost race also releases the requests queued behind it', async () => {
    let refreshAttempted = false;
    const t = await load((c) => {
      if (c.url === '/auth/refresh') { refreshAttempted = true; return { status: 401, body: fail('REFRESH_TOKEN_ROTATED') }; }
      return refreshAttempted ? { status: 200, body: c.url } : { status: 401, body: fail('UNAUTHORIZED') };
    });
    const results = await Promise.all([t.apiClient.get('/a'), t.apiClient.get('/b')]);
    expect(results.map((r) => r.data)).toEqual(['/a', '/b']);
    expect(count(t.calls, 'POST /auth/refresh')).toBe(1);
  });

  it('a replay that still gets 401 after a lost race is rejected, not looped', async () => {
    const t = await load((c) =>
      c.url === '/auth/refresh' ? { status: 401, body: fail('REFRESH_TOKEN_ROTATED') } : { status: 401, body: fail('UNAUTHORIZED') },
    );
    await expect(t.apiClient.get('/a')).rejects.toMatchObject({ response: { status: 401 } });
    expect(count(t.calls, 'POST /auth/refresh')).toBe(1);
    expect(count(t.calls, 'GET /a')).toBe(2);
  });
});

describe('a dead session', () => {
  it('a refused refresh signs out, clears the marker and goes to sign-in', async () => {
    const t = await load((c) =>
      c.url === '/auth/refresh' ? { status: 401, body: fail('INVALID_REFRESH_TOKEN') } : { status: 401, body: fail('UNAUTHORIZED') },
    );
    await expect(t.apiClient.get('/sessions')).rejects.toBeTruthy();
    expect(t.ended).toEqual(['expired']);
    expect(t.hardRedirect).toHaveBeenCalledWith('/login');
    expect(document.cookie).not.toContain('auth_session=1');
  });

  it('after that, further 401s are rejected without another refresh (circuit breaker)', async () => {
    const t = await load((c) =>
      c.url === '/auth/refresh' ? { status: 401, body: fail('INVALID_REFRESH_TOKEN') } : { status: 401, body: fail('UNAUTHORIZED') },
    );
    await expect(t.apiClient.get('/a')).rejects.toBeTruthy();
    await expect(t.apiClient.get('/b')).rejects.toBeTruthy();
    expect(count(t.calls, 'POST /auth/refresh')).toBe(1);
  });

  it('a refresh that never reached the server keeps the session', async () => {
    const t = await load((c) => (c.url === '/auth/refresh' ? 'network' : { status: 401, body: fail('UNAUTHORIZED') }));
    await expect(t.apiClient.get('/a')).rejects.toMatchObject({ code: 'ERR_NETWORK' });
    expect(t.ended).toEqual([]);
    expect(t.hardRedirect).not.toHaveBeenCalled();
  });

  it('the start-up probe finding no session signs out quietly, without leaving the page', async () => {
    const t = await load((c) =>
      c.url === '/auth/refresh' ? { status: 401, body: fail('MISSING_REFRESH_TOKEN') } : { status: 401, body: fail('UNAUTHORIZED') },
    );
    await expect(t.apiClient.get('/auth/me')).rejects.toBeTruthy();
    expect(t.ended).toEqual(['signed-out']);
    expect(t.hardRedirect).not.toHaveBeenCalled();
  });
});

describe('slow down answers', () => {
  it('a 429 shows one toast with the wait and never starts a refresh', async () => {
    const t = await load(() => ({ status: 429, body: fail('RATE_LIMIT_EXCEEDED', { retryAfterSeconds: 60 }) }));
    await expect(t.apiClient.get('/a')).rejects.toBeTruthy();
    expect(t.toastError).toHaveBeenCalledWith('Too many requests. Try again in 1 minute.', { id: 'rate-limit' });
    expect(count(t.calls, 'POST /auth/refresh')).toBe(0);
  });

  it('skipLimitToast leaves the message to the caller', async () => {
    const t = await load(() => ({ status: 429, body: fail('LOGIN_LOCKED', { retryAfterSeconds: 60 }) }));
    await expect(t.apiClient.post('/auth/login', {}, { skipLimitToast: true })).rejects.toBeTruthy();
    expect(t.toastError).not.toHaveBeenCalled();
  });
});

describe('banned while signed in (403 ACCOUNT_DEACTIVATED)', () => {
  it('ends the session through the logout route ONCE for a burst of calls, then reports it', async () => {
    const t = await load((c) => (c.url === '/auth/logout' ? { status: 200 } : { status: 403, body: fail('ACCOUNT_DEACTIVATED') }));
    const results = await Promise.allSettled([t.apiClient.get('/a'), t.apiClient.get('/b')]);
    expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected']);
    expect(count(t.calls, 'POST /auth/logout')).toBe(1);
    expect(t.ended).toEqual(['deactivated']);
    expect(t.hardRedirect).not.toHaveBeenCalled();
  });

  it('still signs out locally when the logout call itself fails', async () => {
    const t = await load((c) => (c.url === '/auth/logout' ? 'network' : { status: 403, body: fail('ACCOUNT_DEACTIVATED') }));
    await expect(t.apiClient.get('/a')).rejects.toBeTruthy();
    expect(t.ended).toEqual(['deactivated']);
  });

  it('a banned account trying to sign in is left to the form (no logout call, no event)', async () => {
    const t = await load(() => ({ status: 403, body: fail('ACCOUNT_DEACTIVATED') }));
    await expect(t.apiClient.post('/auth/login', {})).rejects.toBeTruthy();
    expect(count(t.calls, 'POST /auth/logout')).toBe(0);
    expect(t.ended).toEqual([]);
  });

  it('another 403 (a missing role) does not end the session', async () => {
    const t = await load(() => ({ status: 403, body: fail('FORBIDDEN') }));
    await expect(t.apiClient.get('/admin/stats')).rejects.toBeTruthy();
    expect(t.ended).toEqual([]);
    expect(count(t.calls, 'POST /auth/logout')).toBe(0);
  });
});
