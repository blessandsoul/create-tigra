/**
 * Multipart limits (MULTIPART_LIMITS in ../file-validator.ts) on a small Fastify
 * app wired like src/app.ts: the real @fastify/multipart plugin, the same limits
 * and the global error handler. Form fields sent before the file are buffered,
 * so their number and size must be capped, and going over must be a clear 413,
 * never a 500 and never "your file is too large".
 */
import Fastify, { type FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { registerErrorHandler } from '@libs/error-handler.js';
import { MULTIPART_LIMITS } from '../file-validator.js';

const FILE_SIZE = 64 * 1024;
let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify({ logger: false });
  registerErrorHandler(app);
  await app.register(multipart, { limits: { fileSize: FILE_SIZE, files: 1, ...MULTIPART_LIMITS } });
  // Like the avatar upload: take the first file, read it whole.
  app.post('/upload', async (request) => {
    const file = await request.file();
    const bytes = file ? (await file.toBuffer()).length : 0;
    const fields = file ? Object.values(file.fields).filter((f) => f && 'value' in f) : [];
    const longest = Math.max(0, ...fields.map((f) => String((f as { value: unknown }).value).length));
    return { bytes, fields: fields.length, longest };
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

/** A multipart body: `fields` text fields of `fieldBytes` each, then `files` small files. */
function form(fields: number, fieldBytes = 10, files = 1, fileBytes = 100): { payload: Buffer; headers: Record<string, string> } {
  const boundary = 'limits-test-boundary';
  const parts: Buffer[] = [];
  for (let i = 0; i < fields; i++) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="f${i}"\r\n\r\n${'a'.repeat(fieldBytes)}\r\n`));
  }
  for (let i = 0; i < files; i++) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file${i}"; filename="a${i}.bin"\r\nContent-Type: application/octet-stream\r\n\r\n`));
    parts.push(Buffer.alloc(fileBytes, 1), Buffer.from('\r\n'));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(parts), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

describe('multipart limits', () => {
  it('a normal upload with a few small fields still works', async () => {
    const res = await app.inject({ method: 'POST', url: '/upload', ...form(2) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ bytes: 100, fields: 2 });
  });

  it('more fields than allowed answers 413 MULTIPART_LIMIT, not FILE_TOO_LARGE', async () => {
    const res = await app.inject({ method: 'POST', url: '/upload', ...form(MULTIPART_LIMITS.fields + 1) });
    expect(res.statusCode).toBe(413);
    expect(res.json().error).toEqual({ code: 'MULTIPART_LIMIT', message: 'Too many form fields or files in this upload' });
  });

  it('too many fields only (no file) answers the same 413', async () => {
    const res = await app.inject({ method: 'POST', url: '/upload', ...form(MULTIPART_LIMITS.fields + 1, 10, 0) });
    expect(res.statusCode).toBe(413);
    expect(res.json().error.code).toBe('MULTIPART_LIMIT');
  });

  it('a second file is ignored: only the first is read, never a 500', async () => {
    const res = await app.inject({ method: 'POST', url: '/upload', ...form(0, 0, 2) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ bytes: 100 });
  });

  it('a field longer than fieldSize is cut at fieldSize, never kept whole', async () => {
    const res = await app.inject({ method: 'POST', url: '/upload', ...form(1, MULTIPART_LIMITS.fieldSize * 3) });
    expect(res.statusCode).toBe(200);
    expect(res.json().longest).toBe(MULTIPART_LIMITS.fieldSize);
  });

  it('a file over the size limit still answers 413 FILE_TOO_LARGE', async () => {
    const res = await app.inject({ method: 'POST', url: '/upload', ...form(0, 0, 1, FILE_SIZE + 1) });
    expect(res.statusCode).toBe(413);
    expect(res.json().error.code).toBe('FILE_TOO_LARGE');
  });

  it('caps fields at about 2 MB in total', () => {
    expect(MULTIPART_LIMITS.fields * MULTIPART_LIMITS.fieldSize).toBeLessThanOrEqual(2 * 1024 * 1024);
  });
});
