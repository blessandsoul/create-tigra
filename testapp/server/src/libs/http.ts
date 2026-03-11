import axios, {
  type AxiosInstance,
  type InternalAxiosRequestConfig,
  type AxiosResponse,
  isAxiosError,
} from 'axios';
import { logger } from '@libs/logger.js';
import { InternalError } from '@shared/errors/errors.js';

const TIMEOUT_MS = 30_000;

const httpClient: AxiosInstance = axios.create({
  timeout: TIMEOUT_MS,
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  },
});

// Request interceptor — log every outbound call
httpClient.interceptors.request.use(
  (config: InternalAxiosRequestConfig): InternalAxiosRequestConfig => {
    logger.debug(
      { method: config.method?.toUpperCase(), url: config.url, baseURL: config.baseURL },
      '[HTTP] Outbound request',
    );
    return config;
  },
  (error: unknown): never => {
    logger.error({ err: error }, '[HTTP] Request setup failed');
    throw new InternalError('Outbound HTTP request could not be constructed');
  },
);

// Response interceptor — log responses and convert AxiosError → InternalError
httpClient.interceptors.response.use(
  (response: AxiosResponse): AxiosResponse => {
    logger.debug(
      {
        method: response.config.method?.toUpperCase(),
        url: response.config.url,
        status: response.status,
      },
      '[HTTP] Outbound response',
    );
    return response;
  },
  (error: unknown): never => {
    if (isAxiosError(error)) {
      logger.error(
        {
          method: error.config?.method?.toUpperCase(),
          url: error.config?.url,
          status: error.response?.status,
          message: error.message,
        },
        '[HTTP] Outbound request failed',
      );
    } else {
      logger.error({ err: error }, '[HTTP] Unexpected outbound error');
    }
    throw new InternalError('Outbound HTTP request failed');
  },
);

export { httpClient };
