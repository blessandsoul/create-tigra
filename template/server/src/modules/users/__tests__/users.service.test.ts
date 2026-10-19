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
import { testUsers } from '@/test/setup.js';

vi.mock('@modules/auth/auth.repo.js');
vi.mock('@modules/auth/session.repo.js');
vi.mock('../users.repo.js');
vi.mock('@libs/password.js');
vi.mock('@libs/storage/file-storage.service.js', () => ({ fileStorageService: {} }));
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
});
