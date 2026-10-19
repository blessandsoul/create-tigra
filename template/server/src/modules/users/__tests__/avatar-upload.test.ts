/**
 * Avatar upload (usersService.uploadAvatar) against an in-memory user row and
 * avatar folder: every upload gets a new file, the database is pointed at it
 * with a compare-and-swap, and only the file that swap replaced is deleted.
 * The invariant checked throughout: afterwards the folder holds exactly the
 * file the database names, including when two uploads race.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usersService } from '../users.service.js';
import { usersRepository } from '../users.repo.js';
import { fileStorageService } from '@libs/storage/file-storage.service.js';
import { testUsers } from '@/test/setup.js';

vi.mock('@modules/auth/auth.repo.js');
vi.mock('@modules/auth/session.repo.js');
vi.mock('@libs/password.js');
vi.mock('../users.repo.js');
vi.mock('@libs/storage/image-optimizer.service.js', () => ({
  imageOptimizerService: { optimizeAvatar: vi.fn(async (b: Buffer) => b) },
}));
vi.mock('@libs/storage/file-storage.service.js', () => ({
  fileStorageService: { saveAvatar: vi.fn(), removeAvatarFile: vi.fn() },
}));

const USER_ID = testUsers.validUser.id;
const urlOf = (file: string): string => `/uploads/users/${USER_ID}/avatar/${file}`;

/** The user row's avatarUrl and the files in the avatar folder. */
let row: { avatarUrl: string | null };
let folder: Set<string>;
let saved = 0;
/** When set, the Nth saveAvatar waits for this before returning (to force an interleaving). */
let holdSave: { call: number; until: Promise<unknown> } | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  row = { avatarUrl: null };
  folder = new Set();
  saved = 0;
  holdSave = null;

  vi.mocked(usersRepository.getUserById).mockImplementation(async () => ({ ...testUsers.validUser, avatarUrl: row.avatarUrl }) as never);
  vi.mocked(usersRepository.swapAvatarUrl).mockImplementation(async (_id, expected, next) => {
    if (row.avatarUrl !== expected) return false;
    row.avatarUrl = next;
    return true;
  });
  vi.mocked(fileStorageService.saveAvatar).mockImplementation(async () => {
    const n = ++saved;
    const filename = `avatar-${String(n).padStart(16, '0')}.webp`;
    folder.add(filename);
    if (holdSave?.call === n) await holdSave.until;
    return { filename, url: urlOf(filename) };
  });
  vi.mocked(fileStorageService.removeAvatarFile).mockImplementation(async (_id, filename) => {
    folder.delete(filename);
  });
});

/** The invariant: the folder holds exactly the database's file. */
function expectFolderMatchesDatabase(): void {
  expect(row.avatarUrl).not.toBeNull();
  expect([...folder]).toEqual([row.avatarUrl!.split('/').pop()]);
}

const upload = (): Promise<{ avatarUrl: string }> => usersService.uploadAvatar(USER_ID, Buffer.from('img'), 'a.png');

describe('avatar upload', () => {
  it('a first upload stores the file and points the database at it', async () => {
    const { avatarUrl } = await upload();
    expect(avatarUrl).toMatch(/\/avatar\/avatar-\d{16}\.webp$/);
    expect(row.avatarUrl).toBe(avatarUrl);
    expect(fileStorageService.removeAvatarFile).not.toHaveBeenCalled();
    expectFolderMatchesDatabase();
  });

  it('a re-upload gets a NEW url and deletes the file it replaced', async () => {
    const first = await upload();
    const second = await upload();
    expect(second.avatarUrl).not.toBe(first.avatarUrl);
    expect(fileStorageService.removeAvatarFile).toHaveBeenCalledWith(USER_ID, first.avatarUrl.split('/').pop());
    expectFolderMatchesDatabase();
  });

  it('two uploads at once end with exactly the database file', async () => {
    await upload();
    await Promise.all([upload(), upload()]);
    expectFolderMatchesDatabase();
  });

  it('an upload that finishes while another is between writing and swapping does not delete its file', async () => {
    await upload(); // an existing avatar both uploads will try to replace
    let releaseSecond!: () => void;
    holdSave = { call: 3, until: new Promise<void>((r) => { releaseSecond = r; }) };

    const second = upload(); // reads the old avatar, writes, then waits before swapping
    await vi.waitFor(() => expect(saved).toBe(2));
    const third = upload(); // its save is held: written to disk, not yet in the database
    await vi.waitFor(() => expect(saved).toBe(3));
    await second; // swaps old -> second, deletes old; must leave the third file alone
    releaseSecond();
    await third; // swap fails (database moved on), retries, replaces second, deletes it

    expectFolderMatchesDatabase();
    expect(row.avatarUrl).toBe((await third).avatarUrl);
  });

  it('a database error removes the new file and passes the error on', async () => {
    vi.mocked(usersRepository.swapAvatarUrl).mockRejectedValueOnce(new Error('db down'));
    await expect(upload()).rejects.toThrow('db down');
    expect(folder.size).toBe(0);
    expect(row.avatarUrl).toBeNull();
  });

  it('an avatar that keeps changing answers 409 AVATAR_BUSY and leaves no new file', async () => {
    vi.mocked(usersRepository.swapAvatarUrl).mockResolvedValue(false);
    await expect(upload()).rejects.toMatchObject({ statusCode: 409, code: 'AVATAR_BUSY' });
    expect(folder.size).toBe(0);
  });
});
