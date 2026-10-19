/**
 * Build-time proof that the server image decodes real HEIC (iPhone) photos.
 * The Dockerfile runs it right after check-sharp.mjs, as the runtime user; any
 * failure fails the image build.
 *
 * Why a separate check: sharp.format.heif.input is also true for a build that
 * only reads AVIF (sharp's own prebuilt binaries report it too), so it proves
 * nothing about HEIC. HEIC needs libheif's libde265 plugin (Dockerfile:
 * libheif-libde265), and only decoding a real HEVC file shows it loads.
 * The avatar upload accepts HEIC (src/libs/storage/image-optimizer.service.ts).
 *
 * Server only: the client image does not take HEIC uploads, and check-sharp.mjs
 * must stay identical in both apps.
 */
import assert from 'node:assert/strict';

const { default: sharp } = await import('sharp');

// 16x16 solid-colour HEIC, 467 bytes, no metadata, generated (not a photo).
// Same bytes as src/libs/storage/__tests__/fixtures/tiny-heic.ts.
const TINY_HEIC_BASE64 =
  'AAAAHGZ0eXBoZWljAAAAAG1pZjFoZWljbWlhZgAAAXxtZXRhAAAAAAAAACFoZGxyAAAAAAAAAABwaWN0AAAAAAAAAAAAAAAAAAAA' +
  'ACJpbG9jAAAAAERAAAEAAQAAAAABoAABAAAAAAAAADMAAAAjaWluZgAAAAAAAQAAABVpbmZlAgAAAAABAABodmMxAAAAAA5waXRt' +
  'AAAAAAABAAAA/GlwcnAAAADcaXBjbwAAAHVodmNDAQNwAAAAkAAAAAAAHvAA/P34+AAADwNgAAEAGEABDAH//wNwAAADAJAAAAMA' +
  'AAMAHroCQGEAAQApQgEBA3AAAAMAkAAAAwAAAwAeoCCBBZbqrprm4CGgwIAAAAyAAAADAIRiAAEABkQBwXPBiQAAABNjb2xybmNs' +
  'eAABAA0ABoAAAAAUaXNwZQAAAAAAAABAAAAAQAAAAChjbGFwAAAAEAAAAAEAAAAQAAAAAf///9AAAAAC////0AAAAAIAAAAQcGl4' +
  'aQAAAAADCAgIAAAAGGlwbWEAAAAAAAAAAQABBYECAwWEAAAAO21kYXQAAAAvKAGvEyFkY0D4EPdn/9RdjB6iuj/gbsenOyEdwNIg' +
  'gJtASJNdUAsWEICHdqVW3Pg=';

const heic = Buffer.from(TINY_HEIC_BASE64, 'base64');
const meta = await sharp(heic).metadata();
assert.equal(meta.format, 'heif', 'HEIC fixture: container format');
assert.equal(meta.compression, 'hevc', 'HEIC fixture: must be HEVC-coded (a real iPhone-style HEIC)');

const { data, info } = await sharp(heic, { autoOrient: true }).resize(8, 8).webp().toBuffer({ resolveWithObject: true });
assert.equal(info.format, 'webp', 'HEIC: output format');
assert.equal(info.width, 8, 'HEIC: resize width');
assert.equal((await sharp(data).metadata()).exif, undefined, 'HEIC: metadata must be stripped');

console.log('check-heic: HEIC (HEVC) photos decode in this image');
