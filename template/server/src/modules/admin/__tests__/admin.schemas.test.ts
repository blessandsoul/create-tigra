/**
 * Admin query schemas are parsed twice: by the route schema, then again by the
 * controller's parseInput on the already-parsed values. Parsing a result again
 * must give the same result, or every request answers 422 (it did: a boolean
 * from the first parse failed the "true"/"false" check of the second).
 */
import { describe, expect, it } from 'vitest';
import { getSessionsQuerySchema, getUsersQuerySchema } from '../admin.schemas.js';

const twice = <T>(schema: { parse: (v: unknown) => T }, input: unknown): { once: T; again: T } => {
  const once = schema.parse(input);
  return { once, again: schema.parse(once) };
};

describe('admin query schemas survive the second parse', () => {
  it.each([
    [{}],
    [{ isActive: 'true' }],
    [{ isActive: 'false', deleted: 'true', page: '2', limit: '50', role: 'ADMIN', search: 'ann' }],
  ])('users query %j', (input) => {
    const { once, again } = twice(getUsersQuerySchema, input);
    expect(again).toEqual(once);
  });

  it('users query turns the strings into booleans and defaults deleted to false', () => {
    expect(getUsersQuerySchema.parse({ isActive: 'true' })).toMatchObject({ isActive: true, deleted: false });
    expect(getUsersQuerySchema.parse({ deleted: 'true' })).toMatchObject({ deleted: true });
  });

  it('still refuses a value that is not true/false', () => {
    expect(getUsersQuerySchema.safeParse({ isActive: 'yes' }).success).toBe(false);
  });

  it('sessions query', () => {
    const { once, again } = twice(getSessionsQuerySchema, { page: '3', userId: '22222222-2222-4222-8222-222222222222' });
    expect(again).toEqual(once);
  });
});
