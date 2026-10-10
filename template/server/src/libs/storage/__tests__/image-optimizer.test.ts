import { describe, it, expect } from 'vitest';
import { crc32, deflateSync } from 'node:zlib';
import sharp from 'sharp';
import { imageOptimizerService, MAX_INPUT_PIXELS } from '../image-optimizer.service.js';

// Avatars are public: the output must carry no metadata (GPS, device), and a
// small file describing a huge picture must be refused before it is decoded.

/**
 * A ~70-byte PNG whose header claims width×height. Its pixel data is truncated:
 * enough for the header to be read, which is exactly where the limit must act.
 */
function pngHeaderOnly(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer): Buffer => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([length, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.alloc(64))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

describe('imageOptimizerService.optimizeAvatar', () => {
  it('strips EXIF/GPS/XMP and applies the orientation tag to the pixels', async () => {
    const input = await sharp({ create: { width: 64, height: 32, channels: 3, background: '#808080' } })
      .jpeg()
      .withExif({
        IFD0: { Make: 'DummyCam', Model: 'DummyModel' },
        IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '1/1 2/1 3/1', GPSLongitudeRef: 'E', GPSLongitude: '4/1 5/1 6/1' },
      })
      .withMetadata({ orientation: 6 }) // "rotate 90° clockwise" tag, as phones write it
      .toBuffer();
    expect((await sharp(input).metadata()).exif).toBeDefined();

    const output = await imageOptimizerService.optimizeAvatar(input);
    const meta = await sharp(output).metadata();

    expect(meta.format).toBe('webp');
    expect(meta.exif).toBeUndefined();
    expect(meta.xmp).toBeUndefined();
    expect(meta.orientation).toBeUndefined();
    // 64×32 landscape + orientation 6 → stored upright as 32×64
    expect(meta.width).toBe(32);
    expect(meta.height).toBe(64);
  });

  it('refuses an image above the pixel limit without decoding it', async () => {
    const huge = pngHeaderOnly(16000, 16000); // 256 MP claimed, a few dozen bytes
    expect(16000 * 16000).toBeGreaterThan(MAX_INPUT_PIXELS);

    const started = Date.now();
    await expect(imageOptimizerService.optimizeAvatar(huge)).rejects.toMatchObject({ code: 'IMAGE_TOO_LARGE' });
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('refuses formats outside the allowlist even when named like a PNG', async () => {
    const gif = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#ff0000' } }).gif().toBuffer();
    await expect(imageOptimizerService.optimizeAvatar(gif)).rejects.toMatchObject({
      code: 'UNSUPPORTED_IMAGE_FORMAT',
    });
  });

  it('accepts a normal photo-sized JPEG', async () => {
    const photo = await sharp({ create: { width: 4000, height: 3000, channels: 3, background: '#336699' } })
      .jpeg()
      .toBuffer();
    const output = await imageOptimizerService.optimizeAvatar(photo);
    const meta = await sharp(output).metadata();
    expect(meta.width).toBe(512);
    expect(meta.height).toBe(384);
  });
});
