/**
 * Admin service rules with the repositories mocked: a ban or a demotion ends
 * the account's sessions at once, an admin can never ban themselves or change
 * their own role (either could leave the project without an admin), and a
 * force-expired session takes its refresh tokens with it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { adminService } from '../admin.service.js';
import { adminRepository } from '../admin.repo.js';
import { sessionRepository } from '@modules/auth/session.repo.js';
import { deleteRefreshTokensByUserId } from '@modules/auth/auth.repo.js';

vi.mock('../admin.repo.js');
vi.mock('@modules/auth/session.repo.js');
vi.mock('@modules/auth/auth.repo.js');
vi.mock('@libs/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';

function adminUser(overrides: Record<string, unknown> = {}): never {
  return {
    id: USER_ID, email: 'u@example.test', firstName: 'Us', lastName: 'Er', role: 'USER', avatarUrl: null,
    isActive: true, emailVerifiedAt: new Date(), deletedAt: null, createdAt: new Date(), updatedAt: new Date(),
    ...overrides,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(adminRepository.findUserById).mockResolvedValue(adminUser());
  vi.mocked(adminRepository.updateUserStatus).mockResolvedValue(adminUser());
  vi.mocked(adminRepository.updateUserRole).mockResolvedValue(adminUser());
});

describe('ban and unban', () => {
  it("banning another user ends that user's sessions and refresh tokens", async () => {
    await adminService.toggleUserStatus(USER_ID, false, ADMIN_ID);
    expect(adminRepository.updateUserStatus).toHaveBeenCalledWith(USER_ID, false, false);
    expect(sessionRepository.deleteAllUserSessions).toHaveBeenCalledWith(USER_ID);
    expect(deleteRefreshTokensByUserId).toHaveBeenCalledWith(USER_ID);
  });

  it('an admin cannot ban themselves (403 CANNOT_BAN_SELF), and nothing changes', async () => {
    await expect(adminService.toggleUserStatus(ADMIN_ID, false, ADMIN_ID)).rejects.toMatchObject({
      statusCode: 403,
      code: 'CANNOT_BAN_SELF',
    });
    expect(adminRepository.updateUserStatus).not.toHaveBeenCalled();
    expect(sessionRepository.deleteAllUserSessions).not.toHaveBeenCalled();
  });

  it('activating an unverified user also approves the email; no sessions are touched', async () => {
    vi.mocked(adminRepository.findUserById).mockResolvedValue(adminUser({ emailVerifiedAt: null, isActive: false }));
    await adminService.toggleUserStatus(USER_ID, true, ADMIN_ID);
    expect(adminRepository.updateUserStatus).toHaveBeenCalledWith(USER_ID, true, true);
    expect(sessionRepository.deleteAllUserSessions).not.toHaveBeenCalled();
  });

  it('banning an unknown or deleted user answers 404', async () => {
    vi.mocked(adminRepository.findUserById).mockResolvedValue(null);
    await expect(adminService.toggleUserStatus(USER_ID, false, ADMIN_ID)).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('role changes', () => {
  it('an admin cannot change their own role', async () => {
    await expect(adminService.changeUserRole(ADMIN_ID, 'USER', ADMIN_ID)).rejects.toMatchObject({ statusCode: 403 });
    expect(adminRepository.updateUserRole).not.toHaveBeenCalled();
  });

  it("demoting another admin ends that admin's sessions", async () => {
    vi.mocked(adminRepository.findUserById).mockResolvedValue(adminUser({ id: USER_ID, role: 'ADMIN' }));
    await adminService.changeUserRole(USER_ID, 'USER', ADMIN_ID);
    expect(sessionRepository.deleteAllUserSessions).toHaveBeenCalledWith(USER_ID);
    expect(deleteRefreshTokensByUserId).toHaveBeenCalledWith(USER_ID);
  });

  it('promoting a user keeps their sessions (the role is re-read on every request)', async () => {
    await adminService.changeUserRole(USER_ID, 'ADMIN', ADMIN_ID);
    expect(adminRepository.updateUserRole).toHaveBeenCalledWith(USER_ID, 'ADMIN');
    expect(sessionRepository.deleteAllUserSessions).not.toHaveBeenCalled();
  });
});

describe('force-expire a session', () => {
  it('deletes its refresh tokens, then the session', async () => {
    vi.mocked(adminRepository.getSessionById).mockResolvedValue({ id: 's1', userId: USER_ID } as never);
    await adminService.forceExpireSession('s1');
    const tokensAt = vi.mocked(adminRepository.deleteRefreshTokensBySessionId).mock.invocationCallOrder[0];
    const sessionAt = vi.mocked(adminRepository.deleteSession).mock.invocationCallOrder[0];
    expect(tokensAt).toBeLessThan(sessionAt);
  });

  it('answers 404 for an unknown session', async () => {
    vi.mocked(adminRepository.getSessionById).mockResolvedValue(null);
    await expect(adminService.forceExpireSession('missing')).rejects.toMatchObject({ statusCode: 404 });
    expect(adminRepository.deleteSession).not.toHaveBeenCalled();
  });
});

describe('deleted accounts and restore', () => {
  it('lists deleted accounts with purgeAt = deletedAt + 30 days', async () => {
    const deletedAt = new Date('2026-10-01T10:00:00Z');
    vi.mocked(adminRepository.getUsers).mockResolvedValue({ items: [adminUser({ deletedAt })], totalItems: 1 });
    const { items } = await adminService.getUsers({ page: 1, limit: 10, sortBy: 'createdAt', sortOrder: 'desc', deleted: true });
    expect(items[0]?.purgeAt?.toISOString()).toBe('2026-10-31T10:00:00.000Z');
  });

  it('the normal list carries no purgeAt', async () => {
    vi.mocked(adminRepository.getUsers).mockResolvedValue({ items: [adminUser()], totalItems: 1 });
    const { items } = await adminService.getUsers({ page: 1, limit: 10, sortBy: 'createdAt', sortOrder: 'desc' });
    expect(items[0]).not.toHaveProperty('purgeAt');
  });

  it('restores a deleted account and returns it', async () => {
    vi.mocked(adminRepository.restoreUser).mockResolvedValue(true);
    await expect(adminService.restoreUser(USER_ID)).resolves.toMatchObject({ id: USER_ID, isActive: true });
  });

  it('answers 409 USER_NOT_DELETED for an account that is not deleted', async () => {
    vi.mocked(adminRepository.restoreUser).mockResolvedValue(false);
    vi.mocked(adminRepository.userExists).mockResolvedValue(true);
    await expect(adminService.restoreUser(USER_ID)).rejects.toMatchObject({ statusCode: 409, code: 'USER_NOT_DELETED' });
  });

  it('answers 404 USER_NOT_FOUND when there is no such account (or it was purged)', async () => {
    vi.mocked(adminRepository.restoreUser).mockResolvedValue(false);
    vi.mocked(adminRepository.userExists).mockResolvedValue(false);
    await expect(adminService.restoreUser(USER_ID)).rejects.toMatchObject({ statusCode: 404, code: 'USER_NOT_FOUND' });
  });
});

