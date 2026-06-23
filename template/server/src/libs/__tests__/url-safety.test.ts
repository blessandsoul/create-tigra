import { describe, it, expect } from 'vitest';
import { redactUrl, isPrivateOrReservedIp } from '../url-safety.js';

describe('redactUrl', () => {
  it('redacts a Telegram bot token in the API path', () => {
    expect(redactUrl('https://api.telegram.org/bot123456:AAHsecret/getFile')).toBe(
      'https://api.telegram.org/bot<redacted>/getFile',
    );
  });

  it('redacts a Telegram bot token in the file-download path', () => {
    expect(redactUrl('https://api.telegram.org/file/bot123456:AAHsecret/photos/file_1.jpg')).toBe(
      'https://api.telegram.org/file/bot<redacted>/photos/file_1.jpg',
    );
  });

  it('strips the query string (may carry signed media tokens)', () => {
    expect(redactUrl('https://lookaside.fbsbx.com/media?asset_id=1&token=SECRET')).toBe(
      'https://lookaside.fbsbx.com/media',
    );
  });

  it('strips a fragment as well', () => {
    expect(redactUrl('https://cdn.example.com/x.jpg#frag')).toBe('https://cdn.example.com/x.jpg');
  });

  it('leaves a normal URL unchanged', () => {
    expect(redactUrl('https://scontent.xx.fbcdn.net/v/photo.jpg')).toBe(
      'https://scontent.xx.fbcdn.net/v/photo.jpg',
    );
  });

  it('returns empty / non-string input as-is without throwing', () => {
    expect(redactUrl('')).toBe('');
  });
});

describe('isPrivateOrReservedIp', () => {
  it.each([
    '0.0.0.0',
    '127.0.0.1',
    '10.0.0.5',
    '172.16.0.1',
    '172.31.255.254',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '100.127.255.255',
    '::1',
    '::',
    'fc00::1',
    'fd12:3456:789a::1',
    'fe80::abcd',
    '::ffff:10.0.0.5',
    '::ffff:127.0.0.1',
  ])('blocks internal/reserved address %s', (addr) => {
    expect(isPrivateOrReservedIp(addr)).toBe(true);
  });

  it.each([
    '93.184.216.34',
    '8.8.8.8',
    '1.1.1.1',
    '172.32.0.1', // just outside 172.16/12
    '172.15.0.1', // just below 172.16/12
    '192.169.0.1', // not 192.168
    '100.63.255.255', // just below CGNAT
    '100.128.0.0', // just above CGNAT
    '2606:4700:4700::1111', // Cloudflare public IPv6
    '::ffff:93.184.216.34', // IPv4-mapped public
  ])('allows public address %s', (addr) => {
    expect(isPrivateOrReservedIp(addr)).toBe(false);
  });

  it('fails closed (blocks) on malformed input', () => {
    expect(isPrivateOrReservedIp('not-an-ip')).toBe(true);
    expect(isPrivateOrReservedIp('999.999.999.999')).toBe(true);
    expect(isPrivateOrReservedIp('')).toBe(true);
  });
});
