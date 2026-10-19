/**
 * Password confirmation in users.service: a wrong password is wrong INPUT
 * (422 with its own code), never 401. A 401 tells the client "your session
 * expired", which made it run a pointless token refresh.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { usersService } from '../users.service.js';
import * as authRepo from '@modules/auth/auth.repo.js';
import { sessionRepository } from '@modules/auth/session.repo.js';
import { usersRepository } from '../users.repo.js';
import { hashPassword, verifyPassword } from '@libs/password.js';
import { fileStorageService } from '@libs/storage/file-storage.service.js';
import { testUsers } from '@/test/setup.js';

vi.mock('@modules/auth/auth.repo.js');
vi.mock('@modules/auth/session.repo.js');
vi.mock('../users.repo.js');
vi.mock('@libs/password.js');
vi.mock('@libs/storage/file-storage.service.js', () => ({ fileStorageService: { deleteAvatar: vi.fn() } }));
vi.mock('@libs/storage/image-optimizer.service.js', () => ({ imageOptimizerService: {} }));

const user = testUsers.validUser;

describe('users.service password confirmation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authRepo.findUserById).mockResolvedValue(user);
    vi.mocked(hashPassword).mockResolvedValue('new-hash');
  });

  it('changePassword with a wrong current password answers 422 INVALID_CURRENT_PASSWORD and changes nothing', async () => {
    vi.mocked(verifyPassword).mockResolvedValue(false);
    await expect(
      usersService.changePassword(user.id, { currentPassword: 'wrong', newPassword: 'New-Passw0rd-123!' }),
    ).rejects.toMatchObject({ statusCode: 422, code: 'INVALID_CURRENT_PASSWORD', message: 'Current password is incorrect' });
    expect(authRepo.updateUserPassword).not.toHaveBeenCalled();
    expect(sessionRepository.deleteAllUserSessions).not.toHaveBeenCalled();
  });

  it('changePassword with the right current password still changes it and ends all sessions', async () => {
    // First call: current password matches; second: the new one differs from it.
    vi.mocked(verifyPassword).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await usersService.changePassword(user.id, { currentPassword: 'right', newPassword: 'New-Passw0rd-123!' });
    expect(authRepo.updateUserPassword).toHaveBeenCalledWith(user.id, 'new-hash');
    expect(sessionRepository.deleteAllUserSessions).toHaveBeenCalledWith(user.id);
  });

  it('deleteAccount with a wrong password answers 422 INVALID_PASSWORD and deletes nothing', async () => {
    vi.mocked(verifyPassword).mockResolvedValue(false);
    await expect(usersService.deleteAccount(user.id, 'wrong')).rejects.toMatchObject({
      statusCode: 422,
      code: 'INVALID_PASSWORD',
      message: 'Incorrect password',
    });
    expect(usersRepository.softDeleteUser).not.toHaveBeenCalled();
  });

  it('deleteAccount with the right password still soft-deletes and ends all sessions', async () => {
    vi.mocked(verifyPassword).mockResolvedValue(true);
    await usersService.deleteAccount(user.id, 'right');
    expect(usersRepository.softDeleteUser).toHaveBeenCalledWith(user.id);
    expect(sessionRepository.deleteAllUserSessions).toHaveBeenCalledWith(user.id);
  });

  it('deleteAccount removes the public avatar at once, after the soft delete', async () => {
    vi.mocked(verifyPassword).mockResolvedValue(true);
    await usersService.deleteAccount(user.id, 'right');
    expect(fileStorageService.deleteAvatar).toHaveBeenCalledWith(user.id);
    const softDeletedAt = vi.mocked(usersRepository.softDeleteUser).mock.invocationCallOrder[0];
    expect(vi.mocked(fileStorageService.deleteAvatar).mock.invocationCallOrder[0]).toBeGreaterThan(softDeletedAt);
  });

  it('an admin deleting an account removes its public avatar too', async () => {
    await usersService.deleteAccount(user.id, '', true);
    expect(fileStorageService.deleteAvatar).toHaveBeenCalledWith(user.id);
  });

  it('deleteAccount still succeeds when the avatar file cannot be removed (the purge retries)', async () => {
    vi.mocked(verifyPassword).mockResolvedValue(true);
    vi.mocked(fileStorageService.deleteAvatar).mockRejectedValueOnce(new Error('disk'));
    await expect(usersService.deleteAccount(user.id, 'right')).resolves.toBeUndefined();
    expect(usersRepository.softDeleteUser).toHaveBeenCalledWith(user.id);
  });

  it("an owner's password change keeps the asking device signed in and ends every other session", async () => {
    vi.mocked(verifyPassword).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await usersService.changePassword(user.id, { currentPassword: 'right', newPassword: 'New-Passw0rd-123!' }, false, 'session-here');
    expect(sessionRepository.deleteOtherUserSessions).toHaveBeenCalledWith(user.id, 'session-here');
    expect(authRepo.deleteRefreshTokensByUserId).toHaveBeenCalledWith(user.id, { exceptSessionId: 'session-here' });
    expect(sessionRepository.deleteAllUserSessions).not.toHaveBeenCalled();
  });

  it('an admin-forced password change still ends every session of that user', async () => {
    vi.mocked(verifyPassword).mockResolvedValue(false); // only the "same as current" check runs
    await usersService.changePassword(user.id, { newPassword: 'New-Passw0rd-123!' }, true, 'admins-own-session');
    expect(sessionRepository.deleteAllUserSessions).toHaveBeenCalledWith(user.id);
    expect(authRepo.deleteRefreshTokensByUserId).toHaveBeenCalledWith(user.id);
    expect(sessionRepository.deleteOtherUserSessions).not.toHaveBeenCalled();
  });

  it('the last active admin cannot delete their own account (409 LAST_ADMIN), and nothing is deleted', async () => {
    vi.mocked(authRepo.findUserById).mockResolvedValue({ ...user, role: 'ADMIN' });
    vi.mocked(verifyPassword).mockResolvedValue(true);
    vi.mocked(usersRepository.countOtherActiveAdmins).mockResolvedValue(0);
    await expect(usersService.deleteAccount(user.id, 'right')).rejects.toMatchObject({ statusCode: 409, code: 'LAST_ADMIN' });
    expect(usersRepository.softDeleteUser).not.toHaveBeenCalled();
  });

  it('an admin can delete their own account when another active admin exists', async () => {
    vi.mocked(authRepo.findUserById).mockResolvedValue({ ...user, role: 'ADMIN' });
    vi.mocked(verifyPassword).mockResolvedValue(true);
    vi.mocked(usersRepository.countOtherActiveAdmins).mockResolvedValue(1);
    await usersService.deleteAccount(user.id, 'right');
    expect(usersRepository.softDeleteUser).toHaveBeenCalledWith(user.id);
  });

  it('a wrong password still answers 422 first, even for the last admin', async () => {
    vi.mocked(authRepo.findUserById).mockResolvedValue({ ...user, role: 'ADMIN' });
    vi.mocked(verifyPassword).mockResolvedValue(false);
    await expect(usersService.deleteAccount(user.id, 'wrong')).rejects.toMatchObject({ code: 'INVALID_PASSWORD' });
    expect(usersRepository.countOtherActiveAdmins).not.toHaveBeenCalled();
  });

  it('a normal user never triggers the admin check', async () => {
    vi.mocked(verifyPassword).mockResolvedValue(true);
    await usersService.deleteAccount(user.id, 'right');
    expect(usersRepository.countOtherActiveAdmins).not.toHaveBeenCalled();
  });
});
