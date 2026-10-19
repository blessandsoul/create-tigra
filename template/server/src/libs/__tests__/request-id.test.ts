import { describe, expect, it } from 'vitest';
import { requestIdFrom } from '../request-id.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('requestIdFrom (inbound X-Request-Id)', () => {
  it('keeps a short, plain id from a proxy', () => {
    expect(requestIdFrom('trace-01.ABC_def')).toBe('trace-01.ABC_def');
    const uuid = '3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90';
    expect(requestIdFrom(uuid)).toBe(uuid);
    expect(requestIdFrom('a'.repeat(128))).toBe('a'.repeat(128));
  });

  it('replaces anything else with a fresh UUID', () => {
    for (const bad of ['a'.repeat(129), 'has space', 'semi;colon', '', '<script>']) {
      const id = requestIdFrom(bad);
      expect(id, JSON.stringify(bad)).toMatch(UUID);
    }
  });

  it('replaces a missing or repeated header', () => {
    expect(requestIdFrom(undefined)).toMatch(UUID);
    expect(requestIdFrom(['one', 'two'])).toMatch(UUID);
  });
});
