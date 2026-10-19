/**
 * The global error handler (src/libs/error-handler.ts) on a small Fastify app
 * wired like src/app.ts (fastify-type-provider-zod compilers). Proves the one
 * shape for wrong input, 422 VALIDATION_FAILED + fields, from all three places
 * input is checked (route schema, schema.parse() in a handler, parseInput), and
 * that no submitted value is ever echoed back.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { z } from 'zod';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { registerErrorHandler } from '@libs/error-handler.js';
import { MAX_FIELD_ERRORS, parseInput } from '@libs/validation-errors.js';
import { TooManyRequestsError } from '@shared/errors/errors.js';
import { OutboundHttpError } from '@libs/http.js';

/** A distinctive value: it must never appear in any answer. */
const SECRET_VALUE = 'leak-canary-7Q2X';

const signupSchema = z.object({
  email: z.email(),
  age: z.number().int().min(18),
  address: z.object({ city: z.string().min(2) }).optional(),
});
const passwordSchema = z.object({ password: z.string().min(8) });
const wideSchema = z.object(Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`f${i}`, z.string()])));

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerErrorHandler(app);
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.post('/schema', { schema: { body: signupSchema } }, async () => ({ ok: true }));
  typed.post('/wide', { schema: { body: wideSchema } }, async () => ({ ok: true }));
  typed.get('/users/:id', { schema: { params: z.object({ id: z.uuid() }) } }, async () => ({ ok: true }));
  typed.get('/list', { schema: { querystring: z.object({ page: z.coerce.number().int().min(1) }) } }, async () => ({ ok: true }));
  app.post('/parse', async (request) => passwordSchema.parse(request.body));
  app.post('/parse-input', async (request) => parseInput(passwordSchema, request.body));
  app.get('/limited', async () => {
    throw new TooManyRequestsError('Too many requests. Try again in 1 minute.', 'RATE_LIMIT_EXCEEDED', 42);
  });
  app.get('/outbound', async () => {
    throw new OutboundHttpError('http', { status: 404, cause: new Error(`upstream said ${SECRET_VALUE}`) });
  });
  app.get('/boom', async () => {
    throw new Error(`internal detail ${SECRET_VALUE}`);
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

function expectNoLeak(raw: string): void {
  expect(raw).not.toContain(SECRET_VALUE);
}

describe('global error handler', () => {
  it('route schema: 422 VALIDATION_FAILED with every wrong field (body), never the values', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/schema',
      payload: { email: SECRET_VALUE, age: 12, address: { city: 'x' } },
    });
    expect(res.statusCode).toBe(422);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.fields.map((f: { field: string }) => f.field).sort()).toEqual(['address.city', 'age', 'email']);
    expect(body.error.message).toMatch(/^Please check these fields: /);
    for (const f of body.error.fields) expect(typeof f.message).toBe('string');
    expectNoLeak(res.body);
  });

  it('route schema: a missing body names the request part', async () => {
    const res = await app.inject({ method: 'POST', url: '/schema', headers: { 'content-type': 'application/json' }, payload: 'null' });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.fields).toEqual([expect.objectContaining({ field: 'body' })]);
  });

  it('route schema: params and querystring use the same shape', async () => {
    const params = await app.inject({ method: 'GET', url: `/users/${SECRET_VALUE}` });
    expect(params.statusCode).toBe(422);
    expect(params.json().error.fields[0].field).toBe('id');
    expectNoLeak(params.body);

    const query = await app.inject({ method: 'GET', url: '/list?page=0' });
    expect(query.statusCode).toBe(422);
    expect(query.json().error.fields[0].field).toBe('page');
  });

  it('caps the field list', async () => {
    const res = await app.inject({ method: 'POST', url: '/wide', payload: {} });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.fields).toHaveLength(MAX_FIELD_ERRORS);
  });

  it('schema.parse() inside a handler: same 422 shape', async () => {
    const res = await app.inject({ method: 'POST', url: '/parse', payload: { password: 'short' } });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatchObject({
      code: 'VALIDATION_FAILED',
      message: 'Please check these fields: password',
      fields: [expect.objectContaining({ field: 'password' })],
    });
    expect(res.body).not.toContain('"short"');
  });

  it('parseInput(): same 422 shape', async () => {
    const res = await app.inject({ method: 'POST', url: '/parse-input', payload: { password: 'short' } });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatchObject({ code: 'VALIDATION_FAILED', fields: [expect.objectContaining({ field: 'password' })] });
  });

  it('malformed JSON stays 400 BAD_REQUEST (unreadable request, not wrong input)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/schema',
      headers: { 'content-type': 'application/json' },
      payload: `{"email": "${SECRET_VALUE}"`,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('BAD_REQUEST');
    expect(res.json().error.fields).toBeUndefined();
    expectNoLeak(res.body);
  });

  it('AppError keeps its status, code and retryAfterSeconds, with no fields', async () => {
    const res = await app.inject({ method: 'GET', url: '/limited' });
    expect(res.statusCode).toBe(429);
    expect(res.json().error).toEqual({
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many requests. Try again in 1 minute.',
      retryAfterSeconds: 42,
    });
  });

  it('an unexpected error is a generic 500 that reveals nothing', async () => {
    const res = await app.inject({ method: 'GET', url: '/boom' });
    expect(res.statusCode).toBe(500);
    expect(res.json().error).toEqual({ code: 'INTERNAL_ERROR', message: 'Internal server error' });
    expectNoLeak(res.body);
  });

  it('an unhandled outbound failure is the same generic 500, without its status, kind or cause', async () => {
    const res = await app.inject({ method: 'GET', url: '/outbound' });
    expect(res.statusCode).toBe(500);
    expect(res.json().error).toEqual({ code: 'INTERNAL_ERROR', message: 'Outbound HTTP request failed' });
    expect(res.body).not.toContain('404');
    expectNoLeak(res.body);
  });
});

