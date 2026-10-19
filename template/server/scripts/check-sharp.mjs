/**
 * Build-time proof that sharp works in the final Docker image. The Dockerfile
 * runs it as the runtime user after everything is copied in; any failure
 * fails the image build, so an image whose sharp cannot load never ships.
 * It needs no env, network, database or application code.
 *
 * Why the addon file is loaded directly first: when our source-built addon
 * fails to load, sharp silently falls back to its prebuilt addon. On a build
 * host with a newer (x86-64-v2) CPU that fallback works, hides the broken
 * build, and the image then crashes on an older production CPU. Requiring our
 * own file first turns a missing library into a build error here.
 *
 * Keep this file identical in server/scripts and client/scripts.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { version } = require('../node_modules/sharp/package.json');
require(`../node_modules/sharp/src/build/Release/sharp-linuxmusl-${process.arch}-${version}.node`);

// The libvips the Dockerfile compiled. sharp must report this one, not the
// libvips bundled with its prebuilt addon.
const pc = readFileSync('/opt/vips/lib/pkgconfig/vips-cpp.pc', 'utf8');
const shipped = /^Version:\s*(\S+)/m.exec(pc)?.[1];

const { default: sharp } = await import('sharp');
assert.equal(sharp.versions.vips, shipped, 'sharp is not using the libvips built into this image');

// The work the apps do: decode, auto-orient, resize, encode WebP and drop
// metadata (avatars on the server, /_next/image on the client).
const jpeg = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#3366cc' } })
  .jpeg()
  .withExif({ IFD0: { Copyright: 'check-sharp' } })
  .toBuffer();
assert.ok((await sharp(jpeg).metadata()).exif, 'the test JPEG should carry EXIF');
const png = await sharp({ create: { width: 16, height: 16, channels: 4, background: '#00000000' } }).png().toBuffer();

for (const [name, input] of [['jpeg', jpeg], ['png', png]]) {
  const { data, info } = await sharp(input).autoOrient().resize(8, 8).webp().toBuffer({ resolveWithObject: true });
  assert.equal(info.format, 'webp', `${name}: output format`);
  assert.equal(info.width, 8, `${name}: resize width`);
  assert.equal((await sharp(data).metadata()).exif, undefined, `${name}: metadata must be stripped`);
}

// HEIC/HEIF input (phone photos) is accepted by the server's avatar upload.
assert.equal(sharp.format.heif.input.buffer, true, 'HEIF input support missing');

// Also prove which runtime the image ships (the deploy log shows this line).
const npmVersion = execFileSync('npm', ['-v'], { encoding: 'utf8' }).trim();
console.log(`check-sharp: sharp ${version} works with libvips ${sharp.versions.vips} on Node ${process.version}, npm ${npmVersion}`);
