import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { InternalAxiosRequestConfig, AxiosResponse } from 'axios';
import { InternalError } from '@shared/errors/errors.js';

// ---------------------------------------------------------------------------
// Captured interceptor handlers (populated when http.ts is first imported)
// vi.hoisted() ensures these are available inside the vi.mock factory
// ---------------------------------------------------------------------------
const captured = vi.hoisted(() => ({
  requestFulfilled: null as null | ((c: InternalAxiosRequestConfig) => InternalAxiosRequestConfig),
  requestRejected: null as null | ((e: unknown) => never),
  responseFulfilled: null as null | ((r: AxiosResponse) => AxiosResponse),
  responseRejected: null as null | ((e: unknown) => never),
  mockIsAxiosError: vi.fn<(e: unknown) => boolean>(),
}));

// ---------------------------------------------------------------------------
// Mock axios — captures interceptor handlers at registration time
// ---------------------------------------------------------------------------
vi.mock('axios', () => ({
  default: {
    create: vi.fn(() => ({
      interceptors: {
        request: {
          use: vi.fn((onFulfilled: any, onRejected: any) => {
            captured.requestFulfilled = onFulfilled;
            captured.requestRejected = onRejected;
          }),
        },
        response: {
          use: vi.fn((onFulfilled: any, onRejected: any) => {
            captured.responseFulfilled = onFulfilled;
            captured.responseRejected = onRejected;
          }),
        },
      },
    })),
  },
  isAxiosError: captured.mockIsAxiosError,
}));

// ---------------------------------------------------------------------------
// Mock logger — prevents real Pino I/O in tests
// ---------------------------------------------------------------------------
vi.mock('@libs/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

// Import AFTER mocks are registered
import { httpClient } from '../http.js';
import { logger } from '@libs/logger.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeConfig(overrides: Partial<InternalAxiosRequestConfig> = {}): InternalAxiosRequestConfig {
  return { headers: {} as InternalAxiosRequestConfig['headers'], ...overrides };
}

function makeResponse(overrides: Partial<AxiosResponse> = {}): AxiosResponse {
  return {
    data: {},
    status: 200,
    statusText: 'OK',
    headers: {},
    config: makeConfig({ method: 'get', url: '/test' }),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('httpClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    captured.mockIsAxiosError.mockReturnValue(false);
  });

  // -------------------------------------------------------------------------
  // Module contract
  // -------------------------------------------------------------------------
  describe('module contract', () => {
    it('should be exported as a named export', () => {
      expect(httpClient).toBeDefined();
    });

    it('should return the same singleton instance on re-import', async () => {
      const { httpClient: httpClient2 } = await import('../http.js');
      expect(httpClient2).toBe(httpClient);
    });

    it('should have registered exactly one request interceptor', () => {
      expect(captured.requestFulfilled).not.toBeNull();
      expect(captured.requestRejected).not.toBeNull();
    });

    it('should have registered exactly one response interceptor', () => {
      expect(captured.responseFulfilled).not.toBeNull();
      expect(captured.responseRejected).not.toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Request interceptor — success path
  // -------------------------------------------------------------------------
  describe('request interceptor (success)', () => {
    it('should return the config unchanged', () => {
      const config = makeConfig({ method: 'get', url: '/users' });
      const result = captured.requestFulfilled!(config);
      expect(result).toBe(config);
    });

    it('should log outbound request at debug level', () => {
      const config = makeConfig({ method: 'get', url: '/users', baseURL: 'https://api.example.com' });
      captured.requestFulfilled!(config);
      expect(logger.debug).toHaveBeenCalledOnce();
      expect(logger.debug).toHaveBeenCalledWith(
        { method: 'GET', url: '/users', baseURL: 'https://api.example.com' },
        '[HTTP] Outbound request',
      );
    });

    it('should uppercase the HTTP method in the log', () => {
      captured.requestFulfilled!(makeConfig({ method: 'post', url: '/items' }));
      expect(logger.debug).toHaveBeenCalledWith(
        expect.objectContaining({ method: 'POST' }),
        '[HTTP] Outbound request',
      );
    });

    it('should handle undefined method without throwing', () => {
      const config = makeConfig({ url: '/noop' });
      expect(() => captured.requestFulfilled!(config)).not.toThrow();
      expect(logger.debug).toHaveBeenCalledWith(
        expect.objectContaining({ method: undefined }),
        '[HTTP] Outbound request',
      );
    });

    it('should not call logger.error on the success path', () => {
      captured.requestFulfilled!(makeConfig({ method: 'get', url: '/ok' }));
      expect(logger.error).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Request interceptor — error path
  // -------------------------------------------------------------------------
  describe('request interceptor (error)', () => {
    it('should throw an InternalError', () => {
      expect(() => captured.requestRejected!(new Error('setup fail'))).toThrow(InternalError);
    });

    it('should throw with the correct message', () => {
      expect(() => captured.requestRejected!(new Error('x'))).toThrow(
        'Outbound HTTP request could not be constructed',
      );
    });

    it('should throw InternalError with statusCode 500', () => {
      let thrown: unknown;
      try {
        captured.requestRejected!(new Error('x'));
      } catch (e) {
        thrown = e;
      }
      expect((thrown as InternalError).statusCode).toBe(500);
    });

    it('should throw InternalError with code INTERNAL_ERROR', () => {
      let thrown: unknown;
      try {
        captured.requestRejected!(new Error('x'));
      } catch (e) {
        thrown = e;
      }
      expect((thrown as InternalError).code).toBe('INTERNAL_ERROR');
    });

    it('should log the error before throwing', () => {
      const err = new Error('setup fail');
      try {
        captured.requestRejected!(err);
      } catch {
        // expected
      }
      expect(logger.error).toHaveBeenCalledWith({ err }, '[HTTP] Request setup failed');
    });

    it('should not call logger.debug on the error path', () => {
      try {
        captured.requestRejected!(new Error('x'));
      } catch {
        // expected
      }
      expect(logger.debug).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Response interceptor — success path
  // -------------------------------------------------------------------------
  describe('response interceptor (success)', () => {
    it('should return the response unchanged', () => {
      const response = makeResponse({ status: 200, data: { id: 42 } });
      const result = captured.responseFulfilled!(response);
      expect(result).toBe(response);
    });

    it('should log the response at debug level', () => {
      const response = makeResponse({
        status: 201,
        config: makeConfig({ method: 'post', url: '/items' }),
      });
      captured.responseFulfilled!(response);
      expect(logger.debug).toHaveBeenCalledOnce();
      expect(logger.debug).toHaveBeenCalledWith(
        { method: 'POST', url: '/items', status: 201 },
        '[HTTP] Outbound response',
      );
    });

    it('should uppercase the HTTP method in the response log', () => {
      const response = makeResponse({
        config: makeConfig({ method: 'delete', url: '/items/1' }),
      });
      captured.responseFulfilled!(response);
      expect(logger.debug).toHaveBeenCalledWith(
        expect.objectContaining({ method: 'DELETE' }),
        '[HTTP] Outbound response',
      );
    });

    it('should not call logger.error on the success path', () => {
      captured.responseFulfilled!(makeResponse());
      expect(logger.error).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Response interceptor — AxiosError path
  // -------------------------------------------------------------------------
  describe('response interceptor (AxiosError)', () => {
    beforeEach(() => {
      captured.mockIsAxiosError.mockReturnValue(true);
    });

    const buildAxiosError = (overrides: Record<string, unknown> = {}): object => ({
      isAxiosError: true,
      config: { method: 'get', url: '/failing', headers: {} },
      response: { status: 503 },
      message: 'Service Unavailable',
      ...overrides,
    });

    it('should throw an InternalError', () => {
      expect(() => captured.responseRejected!(buildAxiosError())).toThrow(InternalError);
    });

    it('should throw with the correct message', () => {
      expect(() => captured.responseRejected!(buildAxiosError())).toThrow(
        'Outbound HTTP request failed',
      );
    });

    it('should throw InternalError with statusCode 500', () => {
      let thrown: unknown;
      try {
        captured.responseRejected!(buildAxiosError());
      } catch (e) {
        thrown = e;
      }
      expect((thrown as InternalError).statusCode).toBe(500);
    });

    it('should throw InternalError with code INTERNAL_ERROR', () => {
      let thrown: unknown;
      try {
        captured.responseRejected!(buildAxiosError());
      } catch (e) {
        thrown = e;
      }
      expect((thrown as InternalError).code).toBe('INTERNAL_ERROR');
    });

    it('should log method, url, status, and message', () => {
      try {
        captured.responseRejected!(
          buildAxiosError({
            config: { method: 'post', url: '/upload', headers: {} },
            response: { status: 413 },
            message: 'Payload Too Large',
          }),
        );
      } catch {
        // expected
      }
      expect(logger.error).toHaveBeenCalledWith(
        { method: 'POST', url: '/upload', status: 413, message: 'Payload Too Large' },
        '[HTTP] Outbound request failed',
      );
    });

    it('should uppercase method in error log', () => {
      try {
        captured.responseRejected!(
          buildAxiosError({ config: { method: 'delete', url: '/x', headers: {} } }),
        );
      } catch {
        // expected
      }
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ method: 'DELETE' }),
        '[HTTP] Outbound request failed',
      );
    });

    it('should handle missing config/response gracefully', () => {
      const minimalError = { isAxiosError: true, message: 'timeout' };
      expect(() => captured.responseRejected!(minimalError)).toThrow(InternalError);
      expect(logger.error).toHaveBeenCalledWith(
        { method: undefined, url: undefined, status: undefined, message: 'timeout' },
        '[HTTP] Outbound request failed',
      );
    });

    it('should not call logger.debug on the error path', () => {
      try {
        captured.responseRejected!(buildAxiosError());
      } catch {
        // expected
      }
      expect(logger.debug).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Response interceptor — non-AxiosError path
  // -------------------------------------------------------------------------
  describe('response interceptor (non-AxiosError)', () => {
    beforeEach(() => {
      captured.mockIsAxiosError.mockReturnValue(false);
    });

    it('should throw an InternalError for a plain Error', () => {
      expect(() => captured.responseRejected!(new Error('network failure'))).toThrow(InternalError);
    });

    it('should throw with the correct message', () => {
      expect(() => captured.responseRejected!(new Error('x'))).toThrow(
        'Outbound HTTP request failed',
      );
    });

    it('should log with the generic message and err field', () => {
      const err = new Error('network failure');
      try {
        captured.responseRejected!(err);
      } catch {
        // expected
      }
      expect(logger.error).toHaveBeenCalledWith({ err }, '[HTTP] Unexpected outbound error');
    });

    it('should throw InternalError for thrown string', () => {
      expect(() => captured.responseRejected!('something broke')).toThrow(InternalError);
    });

    it('should throw InternalError for thrown null', () => {
      expect(() => captured.responseRejected!(null)).toThrow(InternalError);
    });

    it('should not call logger.debug on the error path', () => {
      try {
        captured.responseRejected!(new Error('x'));
      } catch {
        // expected
      }
      expect(logger.debug).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Security: sensitive data must NOT be logged
  // -------------------------------------------------------------------------
  describe('security: no sensitive data in logs', () => {
    it('should not log request body in request interceptor', () => {
      captured.requestFulfilled!(makeConfig({ method: 'post', url: '/login', data: { password: 'secret' } }));
      const logCall = vi.mocked(logger.debug).mock.calls[0][0] as Record<string, unknown>;
      expect(logCall).not.toHaveProperty('data');
      expect(JSON.stringify(logCall)).not.toContain('secret');
    });

    it('should not log response body in response interceptor', () => {
      captured.responseFulfilled!(makeResponse({ data: { token: 'bearer-xyz', password: 'hidden' } }));
      const logCall = vi.mocked(logger.debug).mock.calls[0][0] as Record<string, unknown>;
      expect(logCall).not.toHaveProperty('data');
      expect(JSON.stringify(logCall)).not.toContain('bearer-xyz');
    });

    it('should not log request headers (may contain Authorization)', () => {
      captured.requestFulfilled!(
        makeConfig({ method: 'get', url: '/me', headers: { Authorization: 'Bearer token123' } as any }),
      );
      const logCall = vi.mocked(logger.debug).mock.calls[0][0] as Record<string, unknown>;
      expect(logCall).not.toHaveProperty('headers');
      expect(JSON.stringify(logCall)).not.toContain('token123');
    });
  });
});
