/**
 * The integration-test service rules (../integration-services.ts): which mode
 * runs, and the guards that keep the tests (which drop every table and flush
 * Redis) away from a database that could hold real data. No URL may appear in
 * an error: it carries a password.
 */
import { describe, expect, it } from 'vitest';
import { databaseName, pickIntegrationMode, redisDatabaseIndex } from '../integration-services.js';

const DB = 'mysql://tester:s3cret-pw@127.0.0.1:3306/app_test';
const REDIS = 'redis://:r3dis-pw@127.0.0.1:6379/15';

describe('pickIntegrationMode', () => {
  it('neither variable → Testcontainers', () => {
    expect(pickIntegrationMode({})).toEqual({ kind: 'containers' });
    expect(pickIntegrationMode({ INTEGRATION_DATABASE_URL: ' ', INTEGRATION_REDIS_URL: '' })).toEqual({ kind: 'containers' });
  });

  it('both variables, disposable → external services', () => {
    expect(pickIntegrationMode({ INTEGRATION_DATABASE_URL: DB, INTEGRATION_REDIS_URL: REDIS })).toEqual({
      kind: 'external',
      databaseUrl: DB,
      redisUrl: REDIS,
    });
  });

  it('only one of the two → refused, not a silent fallback to containers', () => {
    expect(() => pickIntegrationMode({ INTEGRATION_DATABASE_URL: DB })).toThrow(/both/);
    expect(() => pickIntegrationMode({ INTEGRATION_REDIS_URL: REDIS })).toThrow(/both/);
  });

  it.each([
    ['a database not ending in _test', 'mysql://u:s3cret-pw@127.0.0.1:3306/app', REDIS, /_test/],
    ['a database named test but not ending in _test', 'mysql://u:s3cret-pw@127.0.0.1:3306/test_app', REDIS, /_test/],
    ['no database name', 'mysql://u:s3cret-pw@127.0.0.1:3306', REDIS, /_test/],
    ['a malformed database URL', 'not a url', REDIS, /_test/],
    ['Redis database 0', DB, 'redis://:r3dis-pw@127.0.0.1:6379/0', /1 to 15/],
    ['Redis without a database number', DB, 'redis://:r3dis-pw@127.0.0.1:6379', /1 to 15/],
    ['Redis database 16', DB, 'redis://:r3dis-pw@127.0.0.1:6379/16', /1 to 15/],
  ])('refuses %s, and the message never holds the URL or its password', (_label, databaseUrl, redisUrl, rule) => {
    let message = '';
    try {
      pickIntegrationMode({ INTEGRATION_DATABASE_URL: databaseUrl, INTEGRATION_REDIS_URL: redisUrl });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(rule);
    for (const secret of ['s3cret-pw', 'r3dis-pw', '127.0.0.1', databaseUrl, redisUrl]) {
      expect(message).not.toContain(secret);
    }
  });
});

describe('URL parts', () => {
  it('databaseName decodes the path, empty when missing', () => {
    expect(databaseName('mysql://u:p@h:3306/my%5Fapp_test')).toBe('my_app_test');
    expect(databaseName('mysql://u:p@h:3306/')).toBe('');
    expect(databaseName('::')).toBe('');
  });

  it('redisDatabaseIndex reads the number, null otherwise', () => {
    expect(redisDatabaseIndex('redis://h:6379/7')).toBe(7);
    expect(redisDatabaseIndex('redis://h:6379/x')).toBeNull();
    expect(redisDatabaseIndex('redis://h:6379')).toBeNull();
  });
});
