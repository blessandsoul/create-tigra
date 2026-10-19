/**
 * Users and files against a real MySQL, Redis and upload folders: what must
 * stay true about profiles, avatars and account deletion (the layer 4
 * hardening).
 * - Names are trimmed before their length check.
 * - An avatar's format is judged by its bytes (the browser's type and name
 *   are ignored); every upload gets a new random name with a one-year cache,
 *   the old file is gone at once, two uploads at once leave exactly one file,
 *   and the served file carries no EXIF.
 * - Too many pixels → 422, too many bytes → 413, never a 500.
 * - A deleted account's photo stops being public at once; the purge removes
 *   both upload tiers, then the row.
 * - Changing your own password keeps this device signed in and ends the
 *   others; an admin's forced change ends them all.
 * - Only the owner or an admin may change a user; private files are the
 *   owner's only.
 */
import fs from 'node:fs';
import path from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { integrationServices } from '@/test/integration.setup.js';
import { TINY_HEIC_BASE64 } from '@/libs/storage/__tests__/fixtures/tiny-heic.js';
import {
  PASSWORD,
  buildTestApp,
  call,
  db,
  image,
  registerAdmin,
  registerUser,
  signIn,
  uniqueEmail,
  uploadAvatar,
  type TestUser,
} from '@/test/integration-helpers.js';

let app: FastifyInstance;
let admin: TestUser;

beforeAll(async () => {
  app = await buildTestApp();
  admin = await registerAdmin(app, 'users-admin');
});

afterAll(async () => {
  await app?.close();
});

const avatarDir = (userId: string): string => path.join(integrationServices.uploadPublicDir, 'users', userId, 'avatar');
const filesIn = (dir: string): string[] => (fs.existsSync(dir) ? fs.readdirSync(dir).sort() : []);
const avatarUrlOf = async (userId: string): Promise<string | null> =>
  (await (await db()).user.findUnique({ where: { id: userId }, select: { avatarUrl: true } }))?.avatarUrl ?? null;
const isWebp = (bytes: Buffer): boolean => bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';

describe('names', () => {
  const base = { password: PASSWORD, lastName: 'Tester' };

  it('register with a blank or 1-letter first name (after trimming) → 422 naming firstName', async () => {
    const blank = await call(app, 'POST', '/auth/register', { payload: { ...base, email: uniqueEmail('blank'), firstName: '   ' } });
    expect([blank.status, blank.code]).toEqual([422, 'VALIDATION_FAILED']);
    expect(blank.body?.error?.fields?.map((f) => f.field)).toContain('firstName');
    const one = await call(app, 'POST', '/auth/register', { payload: { ...base, email: uniqueEmail('one'), firstName: ' a ' } });
    expect(one.status).toBe(422);
  });

  it('register "  Ann  " → 201 and stored trimmed', async () => {
    const email = uniqueEmail('ann');
    const r = await call(app, 'POST', '/auth/register', { payload: { ...base, email, firstName: '  Ann  ' } });
    expect(r.status).toBe(201);
    expect((await (await db()).user.findUnique({ where: { email } }))?.firstName).toBe('Ann');
  });

  it('PATCH /users/me with nothing → 422 naming both fields; " Bo " → saved "Bo"', async () => {
    const u = await registerUser(app, 'names');
    const empty = await call(app, 'PATCH', '/users/me', { jar: u.jar, payload: {} });
    expect([empty.status, empty.code]).toEqual([422, 'VALIDATION_FAILED']);
    expect(empty.body?.error?.fields?.map((f) => f.field).sort()).toEqual(['firstName', 'lastName']);
    const bo = await call(app, 'PATCH', '/users/me', { jar: u.jar, payload: { firstName: ' Bo ' } });
    expect([bo.status, bo.body?.data?.firstName]).toEqual([200, 'Bo']);
  });
});

describe('avatar formats are judged by the bytes', () => {
  let u: TestUser;
  beforeAll(async () => {
    u = await registerUser(app, 'formats');
  });

  it.each(['jpeg', 'png', 'webp', 'avif'] as const)('%s sent as application/octet-stream named "blob" → 200', async (format) => {
    const r = await uploadAvatar(app, u.jar, await image(format));
    expect(r.status).toBe(200);
  });

  it('PNG bytes named photo.exe → 200, and the served file is WebP', async () => {
    const r = await uploadAvatar(app, u.jar, await image('png'), { filename: 'photo.exe', type: 'application/x-msdownload' });
    expect(r.status).toBe(200);
    const served = await call(app, 'GET', r.body?.data?.avatarUrl);
    expect(isWebp(served.res.rawPayload)).toBe(true);
  });

  it('text bytes named photo.jpg (image/jpeg) → 422', async () => {
    const r = await uploadAvatar(app, u.jar, Buffer.from('this is not an image at all'), { filename: 'photo.jpg', type: 'image/jpeg' });
    expect(r.status).toBe(422);
  });

  it('HEIC → 200 where this sharp can decode HEVC, otherwise 422 UNSUPPORTED_IMAGE_FORMAT; never a 500', async () => {
    const r = await uploadAvatar(app, u.jar, Buffer.from(TINY_HEIC_BASE64, 'base64'), { filename: 'IMG_0001.HEIC' });
    if (r.status === 422) expect(r.code).toBe('UNSUPPORTED_IMAGE_FORMAT');
    else expect(r.status).toBe(200);
  });
});

describe('avatar files', () => {
  it('a re-upload gets a new random name with a one-year cache; the old URL is 404 at once; 1 file on disk', async () => {
    const u = await registerUser(app, 'files');
    const a = await uploadAvatar(app, u.jar, await image('jpeg'));
    const b = await uploadAvatar(app, u.jar, await image('png'));
    const urlA = a.body?.data?.avatarUrl as string;
    const urlB = b.body?.data?.avatarUrl as string;
    expect(urlA).not.toBe(urlB);
    expect((await call(app, 'GET', urlA)).status).toBe(404);
    const fresh = await call(app, 'GET', urlB);
    expect(fresh.status).toBe(200);
    expect(fresh.res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(urlB).toMatch(/\/avatar\/avatar-[0-9a-f]{16}\.webp$/);
    expect(await avatarUrlOf(u.id)).toBe(urlB);
    expect(filesIn(avatarDir(u.id))).toEqual([path.basename(urlB)]);
  });

  it('two uploads at the same instant (6 rounds) → exactly 1 file, the one the database points at, served 200', async () => {
    const u = await registerUser(app, 'race');
    for (let round = 0; round < 6; round++) {
      const [r1, r2] = await Promise.all([
        uploadAvatar(app, u.jar, await image('jpeg', 60 + round)),
        uploadAvatar(app, u.jar, await image('png', 70 + round)),
      ]);
      expect([r1.status, r2.status]).toEqual([200, 200]);
      const current = (await avatarUrlOf(u.id)) as string;
      expect(filesIn(avatarDir(u.id))).toEqual([path.basename(current)]);
      expect((await call(app, 'GET', current)).status).toBe(200);
    }
  });

  it('the served file carries no EXIF (a JPEG with GPS comes back as WebP without it)', async () => {
    const u = await registerUser(app, 'gps');
    const sharp = (await import('sharp')).default;
    const gps = await sharp({ create: { width: 64, height: 32, channels: 3, background: '#808080' } })
      .jpeg()
      .withExif({ IFD0: { Make: 'DummyCam' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '1/1 2/1 3/1', GPSLongitudeRef: 'E', GPSLongitude: '4/1 5/1 6/1' } })
      .toBuffer();
    const up = await uploadAvatar(app, u.jar, gps, { filename: 'gps.jpg', type: 'image/jpeg' });
    const meta = await sharp((await call(app, 'GET', up.body?.data?.avatarUrl)).res.rawPayload).metadata();
    expect([meta.format, meta.exif]).toEqual(['webp', undefined]);
  });

  it('the old GET /api/v1/users/:id/avatar route is gone → 404', async () => {
    const u = await registerUser(app, 'oldroute');
    expect((await call(app, 'GET', `/users/${u.id}/avatar`)).status).toBe(404);
  });

  it('avatar delete → folder gone, URL 404, avatarUrl NULL', async () => {
    const u = await registerUser(app, 'avdel');
    const url = (await uploadAvatar(app, u.jar, await image('png'))).body?.data?.avatarUrl as string;
    expect((await call(app, 'DELETE', '/users/avatar', { jar: u.jar })).status).toBe(200);
    expect(fs.existsSync(avatarDir(u.id))).toBe(false);
    expect((await call(app, 'GET', url)).status).toBe(404);
    expect(await avatarUrlOf(u.id)).toBeNull();
  });
});

describe('upload limits', () => {
  it('a 60 MP PNG → 422 IMAGE_TOO_LARGE (refused from its header, never decoded)', async () => {
    const u = await registerUser(app, 'pixels');
    const chunk = (type: string, data: Buffer): Buffer => {
      const len = Buffer.alloc(4);
      len.writeUInt32BE(data.length);
      const body = Buffer.concat([Buffer.from(type), data]);
      const crc = Buffer.alloc(4);
      crc.writeUInt32BE(crc32(body) >>> 0);
      return Buffer.concat([len, body, crc]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(8000, 0);
    ihdr.writeUInt32BE(7500, 4);
    ihdr[8] = 8;
    ihdr[9] = 2;
    const huge = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(Buffer.alloc(64))),
      chunk('IEND', Buffer.alloc(0)),
    ]);
    const r = await uploadAvatar(app, u.jar, huge, { filename: 'huge.png', type: 'image/png' });
    expect([r.status, r.code]).toEqual([422, 'IMAGE_TOO_LARGE']);
  });

  it('an 11 MB file → 413 FILE_TOO_LARGE', async () => {
    const u = await registerUser(app, 'bytes');
    const r = await uploadAvatar(app, u.jar, Buffer.alloc(11 * 1024 * 1024, 7), { filename: 'big.jpg', type: 'image/jpeg' });
    expect([r.status, r.code]).toEqual([413, 'FILE_TOO_LARGE']);
  });
});

describe('account deletion', () => {
  it('self-delete → the avatar URL is 404 at once, avatarUrl NULL, deletedAt set', async () => {
    const x = await registerUser(app, 'selfdel');
    const url = (await uploadAvatar(app, x.jar, await image('jpeg'))).body?.data?.avatarUrl as string;
    expect((await call(app, 'GET', url)).status).toBe(200);
    expect((await call(app, 'DELETE', '/users/me', { jar: x.jar, payload: { password: PASSWORD } })).status).toBe(200);
    expect((await call(app, 'GET', url)).status).toBe(404);
    const row = await (await db()).user.findUnique({ where: { id: x.id }, select: { avatarUrl: true, deletedAt: true } });
    expect(row?.avatarUrl).toBeNull();
    expect(row?.deletedAt).not.toBeNull();
  });

  it("an admin's delete → that avatar URL is 404 at once, avatarUrl NULL", async () => {
    const y = await registerUser(app, 'admindel');
    const url = (await uploadAvatar(app, y.jar, await image('png'))).body?.data?.avatarUrl as string;
    expect((await call(app, 'DELETE', `/users/${y.id}`, { jar: admin.jar })).status).toBe(200);
    expect((await call(app, 'GET', url)).status).toBe(404);
    expect(await avatarUrlOf(y.id)).toBeNull();
  });

  it('the purge (31 days later) removes both upload tiers, then the row', async () => {
    const x = await registerUser(app, 'purge');
    await call(app, 'DELETE', '/users/me', { jar: x.jar, payload: { password: PASSWORD } });
    const privateDir = path.join(integrationServices.uploadPrivateDir, 'users', x.id);
    fs.mkdirSync(privateDir, { recursive: true });
    fs.writeFileSync(path.join(privateDir, 'doc.txt'), 'private');
    fs.mkdirSync(avatarDir(x.id), { recursive: true });
    fs.writeFileSync(path.join(avatarDir(x.id), 'leftover.webp'), 'x'); // a stray public file the purge must also remove
    await (await db()).user.update({ where: { id: x.id }, data: { deletedAt: new Date(Date.now() - 31 * 86_400_000) } });

    const { purgeDeletedAccounts } = await import('@jobs/cleanup-deleted-accounts.job.js');
    const result = await purgeDeletedAccounts();
    expect(result.failed).toBe(0);
    expect(await (await db()).user.count({ where: { id: x.id } })).toBe(0);
    expect(fs.existsSync(privateDir)).toBe(false);
    expect(fs.existsSync(path.join(integrationServices.uploadPublicDir, 'users', x.id))).toBe(false);
  });
});

describe('password changes', () => {
  it('your own change keeps this device (me and refresh 200) and ends the other one; 1 session left', async () => {
    const z = await registerUser(app, 'ownpw');
    const deviceB = await signIn(app, z.email);
    const change = await call(app, 'PATCH', '/users/me/password', {
      jar: z.jar,
      payload: { currentPassword: PASSWORD, newPassword: 'New-Passw0rd-456!' },
    });
    expect(change.status).toBe(200);
    expect((await call(app, 'GET', '/auth/me', { jar: z.jar })).status).toBe(200);
    expect((await call(app, 'POST', '/auth/refresh', { jar: z.jar })).status).toBe(200);
    const bMe = await call(app, 'GET', '/auth/me', { cookie: deviceB.header() });
    expect([bMe.status, bMe.code]).toEqual([401, 'SESSION_EXPIRED']);
    expect((await call(app, 'POST', '/auth/refresh', { cookie: deviceB.header() })).status).toBe(401);
    expect(await (await db()).session.count({ where: { userId: z.id } })).toBe(1);
  });

  it("an admin's forced change ends both of that user's devices", async () => {
    const w = await registerUser(app, 'forcedpw');
    const wB = await signIn(app, w.email);
    const forced = await call(app, 'PATCH', `/users/${w.id}/password`, { jar: admin.jar, payload: { newPassword: 'Forced-Passw0rd-789!' } });
    expect(forced.status).toBe(200);
    expect((await call(app, 'GET', '/auth/me', { cookie: w.jar.header() })).status).toBe(401);
    expect((await call(app, 'GET', '/auth/me', { cookie: wB.header() })).status).toBe(401);
  });
});

describe('who may change a user', () => {
  it('another user → 403 (profile and avatar); an admin → 200; anonymous → 401', async () => {
    const a = await registerUser(app, 'owner');
    const b = await registerUser(app, 'stranger');
    expect((await call(app, 'PATCH', `/users/${a.id}`, { jar: b.jar, payload: { firstName: 'Hacker' } })).status).toBe(403);
    const byAdmin = await call(app, 'PATCH', `/users/${a.id}`, { jar: admin.jar, payload: { firstName: 'Fixed' } });
    expect([byAdmin.status, byAdmin.body?.data?.firstName]).toEqual([200, 'Fixed']);
    expect((await uploadAvatar(app, b.jar, await image('png'), { url: `/users/${a.id}/avatar` })).status).toBe(403);
    expect((await call(app, 'PATCH', `/users/${a.id}`, { payload: { firstName: 'Anon' } })).status).toBe(401);
  });

  it("a private file: the owner 200 with its bytes, anonymous 401, another user 404, a traversal 404", async () => {
    const owner = await registerUser(app, 'privowner');
    const other = await registerUser(app, 'privother');
    const dir = path.join(integrationServices.uploadPrivateDir, 'users', owner.id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'note.txt'), 'owner only');
    const own = await call(app, 'GET', '/files/note.txt', { jar: owner.jar });
    expect([own.status, own.res.body]).toEqual([200, 'owner only']);
    expect((await call(app, 'GET', '/files/note.txt')).status).toBe(401);
    expect((await call(app, 'GET', '/files/note.txt', { jar: other.jar })).status).toBe(404);
    expect((await call(app, 'GET', '/files/..%2F..%2Fpublic%2Fx', { jar: owner.jar })).status).toBe(404);
  });
});
