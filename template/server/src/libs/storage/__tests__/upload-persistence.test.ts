/**
 * The "uploads will be lost on the next deploy" check (uploadDirsOnContainerDisk
 * in ../file-storage.service.ts) with a fake disk: it flags a folder only in
 * production, only inside a Docker container, and only when the folder is on
 * the container's own disk (same device as "/") rather than a mounted volume.
 */
import { describe, expect, it } from 'vitest';
import { type DiskProbe, uploadDirsOnContainerDisk } from '../file-storage.service.js';

const DIRS = ['/app/uploads/public', '/app/uploads/private'];

/** A fake disk: "/" is device 1; `mounted` folders live on device 2. */
function disk({ container = true, mounted = [] as string[], broken = [] as string[] } = {}): DiskProbe {
  return {
    exists: (p) => container && p === '/.dockerenv',
    device: (p) => {
      if (broken.includes(p)) throw new Error('EACCES');
      return mounted.some((m) => p === m || p.startsWith(`${m}/`)) ? 2 : 1;
    },
  };
}

describe('uploadDirsOnContainerDisk', () => {
  it('flags both tiers in a production container without a volume', () => {
    expect(uploadDirsOnContainerDisk(DIRS, 'production', disk())).toEqual(DIRS);
  });

  it('flags nothing when /app/uploads is a mounted volume', () => {
    expect(uploadDirsOnContainerDisk(DIRS, 'production', disk({ mounted: ['/app/uploads'] }))).toEqual([]);
  });

  it('flags only the tier that is not on the volume', () => {
    expect(uploadDirsOnContainerDisk(DIRS, 'production', disk({ mounted: ['/app/uploads/public'] }))).toEqual([
      '/app/uploads/private',
    ]);
  });

  it('never flags in development or test', () => {
    expect(uploadDirsOnContainerDisk(DIRS, 'development', disk())).toEqual([]);
    expect(uploadDirsOnContainerDisk(DIRS, 'test', disk())).toEqual([]);
  });

  it('never flags outside a container (a plain server disk is persistent)', () => {
    expect(uploadDirsOnContainerDisk(DIRS, 'production', disk({ container: false }))).toEqual([]);
  });

  it('leaves out a folder it cannot check instead of guessing', () => {
    expect(uploadDirsOnContainerDisk(DIRS, 'production', disk({ broken: ['/app/uploads/public'] }))).toEqual([
      '/app/uploads/private',
    ]);
  });
});
