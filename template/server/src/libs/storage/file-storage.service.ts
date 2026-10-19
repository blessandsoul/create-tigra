/**
 * File Storage Service
 *
 * Handles local file system operations for user-uploaded files.
 *
 * ── Two-tier storage (security: closes the @fastify/static over-exposure) ──────
 * PUBLIC tier  (UPLOAD_PUBLIC_DIR, default <cwd>/uploads/public):
 *   uploads/public/users/{userId}/<media-type>/ — avatars and other assets meant
 *   to be world-readable. THIS is the only directory @fastify/static serves at
 *   /uploads/, so a private file can never leak through the static mount.
 * PRIVATE tier (UPLOAD_PRIVATE_DIR, default <cwd>/uploads/private):
 *   uploads/private/users/{userId}/ — sensitive files. Lives OUTSIDE the static
 *   root and is reachable ONLY through the auth-gated, owner-scoped streaming
 *   route GET /api/v1/files/:filename (see src/modules/files/).
 *
 * Public avatar URLs look like `/uploads/users/{id}/avatar/avatar-<16 hex>.webp`:
 * the static mount serves UPLOAD_PUBLIC_DIR at prefix `/uploads/`.
 *
 * ── Public files never change under the same name ──────────────────────────
 * Every new avatar gets a NEW random filename, so a URL always means the same
 * bytes. That is what lets app.ts serve /uploads with a one-year immutable
 * cache, and it keeps any cache keyed by URL (browsers, CDNs, the Next.js image
 * optimizer) from showing an old photo. Anything else stored in the public
 * tier must follow the same rule: new content, new name.
 */

import { randomBytes } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import fs from 'fs/promises';
import path from 'path';
import { env } from '@config/env.js';
import { logger } from '@libs/logger.js';
import { InternalError } from '@shared/errors/errors.js';

/** How uploadDirsOnContainerDisk looks at the disk (injectable for tests). */
export interface DiskProbe {
  exists(p: string): boolean;
  /** The filesystem device id of a path (fs.stat().dev). */
  device(p: string): number;
}

const realDisk: DiskProbe = {
  exists: (p) => existsSync(p),
  device: (p) => statSync(p).dev,
};

/**
 * Upload folders that sit on the container's own disk and would therefore be
 * lost on the next deploy (Coolify starts a fresh container each time).
 *
 * Only in production inside a Docker container (/.dockerenv exists): there the
 * container's writable layer is "/", and a folder on the same device as "/" is
 * not on a mounted volume. Never in dev or test, never outside a container (a
 * plain server's disk is persistent), and a folder that cannot be checked is
 * left out rather than guessed. The caller only warns: a project that stores
 * no files must still start.
 */
export function uploadDirsOnContainerDisk(
  dirs: readonly string[],
  nodeEnv: string,
  disk: DiskProbe = realDisk,
): string[] {
  if (nodeEnv !== 'production' || !disk.exists('/.dockerenv')) return [];
  try {
    const rootDevice = disk.device('/');
    return dirs.filter((dir) => {
      try {
        return disk.device(dir) === rootDevice;
      } catch {
        return false;
      }
    });
  } catch {
    return [];
  }
}

/**
 * File Storage Service
 *
 * Manages local file storage with per-user directories.
 * All user media lives under {tier}/users/{userId}/ for easy per-user cleanup.
 */
class FileStorageService {
  /** PUBLIC tier root — served as static files at /uploads/ (world-readable). */
  private readonly publicDir: string;
  /** PRIVATE tier root — NEVER served statically; auth-gated route only. */
  private readonly privateDir: string;
  /** {publicDir}/users — per-user public media. */
  private readonly publicUsersDir: string;
  /** {privateDir}/users — per-user private media. */
  private readonly privateUsersDir: string;

  constructor() {
    // Env-driven base paths, optional with <cwd>/uploads/{public,private}
    // defaults so a clean env still boots (see src/config/env.ts).
    this.publicDir = env.UPLOAD_PUBLIC_DIR ?? path.join(process.cwd(), 'uploads', 'public');
    this.privateDir = env.UPLOAD_PRIVATE_DIR ?? path.join(process.cwd(), 'uploads', 'private');
    this.publicUsersDir = path.join(this.publicDir, 'users');
    this.privateUsersDir = path.join(this.privateDir, 'users');
  }

  /** PUBLIC tier root — read by app.ts to scope the @fastify/static mount. */
  getPublicDir(): string {
    return this.publicDir;
  }

  /** PRIVATE tier root — read by the files route for path-containment checks. */
  getPrivateDir(): string {
    return this.privateDir;
  }

  /**
   * Gets the base PUBLIC directory for a user's media
   */
  private getUserDir(userId: string): string {
    return path.join(this.publicUsersDir, userId);
  }

  /**
   * Gets the PRIVATE per-user directory
   */
  private getUserPrivateDir(userId: string): string {
    return path.join(this.privateUsersDir, userId);
  }

  /**
   * Gets the avatar directory for a user (PUBLIC tier)
   */
  private getUserAvatarDir(userId: string): string {
    return path.join(this.getUserDir(userId), 'avatar');
  }

  /**
   * Writes a NEW avatar file under a fresh random name and returns its URL.
   *
   * It never overwrites or deletes anything: the old avatar keeps serving until
   * the database points at the new one, and the caller then removes exactly
   * the file it replaced (see usersService.uploadAvatar). The name carries no
   * personal data (no user name) and is unique per upload.
   *
   * @param userId - User's unique ID
   * @param buffer - Optimized image buffer (always WebP)
   * @returns Filename and public URL, e.g. /uploads/users/{userId}/avatar/avatar-3f9c0a1b2c3d4e5f.webp
   */
  async saveAvatar(userId: string, buffer: Buffer): Promise<{ filename: string; url: string }> {
    try {
      const avatarDir = this.getUserAvatarDir(userId);
      await this.ensureDirectoryExists(avatarDir);

      const filename = `avatar-${randomBytes(8).toString('hex')}.webp`;
      await fs.writeFile(path.join(avatarDir, filename), buffer);

      const url = `/uploads/users/${userId}/avatar/${filename}`;

      logger.info({
        msg: 'Avatar saved successfully',
        userId,
        filename,
        fileSize: buffer.length,
      });

      return { filename, url };
    } catch (error) {
      logger.error({ err: error, msg: 'Failed to save avatar', userId });
      throw new InternalError('Failed to save avatar file', 'FILE_SAVE_FAILED');
    }
  }

  /**
   * Deletes a user's avatar directory and all contents
   *
   * @param userId - User's unique ID
   * @throws InternalError if deletion fails
   *
   * @example
   * ```typescript
   * await fileStorageService.deleteAvatar(userId);
   * ```
   */
  async deleteAvatar(userId: string): Promise<void> {
    try {
      const avatarDir = this.getUserAvatarDir(userId);

      // Check if directory exists
      const exists = await this.directoryExists(avatarDir);
      if (!exists) {
        logger.info({ msg: 'Avatar directory does not exist, nothing to delete', userId });
        return;
      }

      // Delete avatar directory and contents
      await fs.rm(avatarDir, { recursive: true, force: true });

      logger.info({ msg: 'Avatar deleted successfully', userId });
    } catch (error) {
      logger.error({ err: error, msg: 'Failed to delete avatar', userId });
      throw new InternalError('Failed to delete avatar file', 'FILE_DELETE_FAILED');
    }
  }

  /**
   * Deletes all media for a user: the public directory (avatars) AND the
   * private directory (owner-only files).
   *
   * Used by the cleanup job when permanently purging deleted accounts, which
   * promises that nothing of the user remains. It used to delete only the
   * public tier, so private files outlived the account.
   * No-op for a directory that doesn't exist.
   *
   * @param userId - User's unique ID
   *
   * @example
   * ```typescript
   * await fileStorageService.deleteUserMedia(userId);
   * ```
   */
  async deleteUserMedia(userId: string): Promise<void> {
    try {
      for (const dir of [this.getUserDir(userId), this.getUserPrivateDir(userId)]) {
        if (await this.directoryExists(dir)) {
          await fs.rm(dir, { recursive: true, force: true });
        }
      }

      logger.info({ msg: 'User media deleted successfully', userId });
    } catch (error) {
      logger.error({ err: error, msg: 'Failed to delete user media', userId });
      throw new InternalError('Failed to delete user media', 'FILE_DELETE_FAILED');
    }
  }

  /**
   * Removes ONE avatar file of this user. Best effort: never throws, because it
   * runs while cleaning up (the replaced file after a new upload, or the new
   * file after a failed one). A miss is logged; the account purge removes any
   * leftover with the whole folder.
   *
   * Only the basename is used, so whatever a stored URL says, the path stays
   * inside this user's avatar folder.
   */
  async removeAvatarFile(userId: string, filename: string): Promise<void> {
    const safeName = path.basename(filename);
    try {
      await fs.rm(path.join(this.getUserAvatarDir(userId), safeName), { force: true });
    } catch (error) {
      logger.error({ err: error, msg: 'Failed to remove avatar file', userId, filename: safeName });
    }
  }

  /**
   * Sanitizes a single-segment filename for safe disk storage.
   *
   * Strips every path component (returns only the basename) and rejects any
   * remaining traversal/separator/null-byte chars, so the result can never
   * escape the user's private directory. This is a storage-side guard; the
   * files route applies its OWN validation + path-containment check on read.
   *
   * @throws InternalError on an empty or unusable name
   */
  private sanitizePrivateFilename(filename: string): string {
    // Reject obvious traversal/separator/null-byte input up front.
    if (!filename || filename.includes('\0') || filename.includes('/') || filename.includes('\\')) {
      throw new InternalError('Invalid private filename', 'INVALID_FILENAME');
    }
    // Collapse to the basename and drop any leading dots so `..`/`.` can't slip
    // through; keep a conservative allowlist (letters, digits, . _ -).
    const base = path.basename(filename).replace(/^\.+/, '');
    const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, '');
    if (!cleaned) {
      throw new InternalError('Invalid private filename', 'INVALID_FILENAME');
    }
    return cleaned;
  }

  /**
   * Saves a PRIVATE file for a user (PRIVATE tier — never served statically).
   *
   * Writes to UPLOAD_PRIVATE_DIR/users/{userId}/<sanitized-filename>. The file
   * is reachable ONLY through the auth-gated, owner-scoped route
   * GET /api/v1/files/:filename — there is no static mount over this tier.
   *
   * @param userId - User's unique ID (the owner; scopes the directory)
   * @param filename - Desired filename (sanitized to a safe single segment)
   * @param buffer - File contents
   * @returns The sanitized filename and the owner-scoped absolute path
   */
  async savePrivateFile(
    userId: string,
    filename: string,
    buffer: Buffer
  ): Promise<{ filename: string; path: string }> {
    try {
      const safeName = this.sanitizePrivateFilename(filename);
      const userDir = this.getUserPrivateDir(userId);
      await this.ensureDirectoryExists(userDir);

      const filePath = path.join(userDir, safeName);
      await fs.writeFile(filePath, buffer);

      logger.info({
        msg: 'Private file saved successfully',
        userId,
        filename: safeName,
        fileSize: buffer.length,
      });

      return { filename: safeName, path: filePath };
    } catch (error) {
      if (error instanceof InternalError) throw error;
      logger.error({ err: error, msg: 'Failed to save private file', userId });
      throw new InternalError('Failed to save private file', 'FILE_SAVE_FAILED');
    }
  }

  /**
   * Resolves the absolute path of a PRIVATE file for a user.
   *
   * Owner-scoped by construction: the path is derived from the supplied userId
   * (the AUTHENTICATED user at the call site) — never a client-supplied owner.
   * Returns the path WITHOUT touching disk; the caller checks existence and
   * re-asserts path containment before streaming.
   *
   * @param userId - User's unique ID (the owner)
   * @param filename - File name within the user's private directory
   * @returns Absolute file path under UPLOAD_PRIVATE_DIR/users/{userId}/
   */
  getPrivateFilePath(userId: string, filename: string): string {
    const safeName = this.sanitizePrivateFilename(filename);
    return path.join(this.getUserPrivateDir(userId), safeName);
  }

  /**
   * Ensures a directory exists, creates it if not
   *
   * @param dirPath - Directory path
   * @private
   */
  private async ensureDirectoryExists(dirPath: string): Promise<void> {
    try {
      await fs.access(dirPath);
    } catch {
      // Directory doesn't exist, create it
      await fs.mkdir(dirPath, { recursive: true });
      logger.info({ msg: 'Created directory', dirPath });
    }
  }

  /**
   * Checks if a directory exists
   *
   * @param dirPath - Directory path
   * @returns True if directory exists
   * @private
   */
  private async directoryExists(dirPath: string): Promise<boolean> {
    try {
      const stats = await fs.stat(dirPath);
      return stats.isDirectory();
    } catch {
      return false;
    }
  }

  /**
   * Initializes the upload directory structure
   *
   * Creates BOTH tiers (public + private) and their per-user subdirectories if
   * they don't exist. Should be called at application startup. Creating the
   * public dir up front matters because @fastify/static is mounted on it.
   */
  async initialize(): Promise<void> {
    try {
      await this.ensureDirectoryExists(this.publicDir);
      await this.ensureDirectoryExists(this.publicUsersDir);
      await this.ensureDirectoryExists(this.privateDir);
      await this.ensureDirectoryExists(this.privateUsersDir);
      logger.info({
        msg: 'File storage initialized',
        publicDir: this.publicDir,
        privateDir: this.privateDir,
      });
    } catch (error) {
      logger.error({ err: error, msg: 'Failed to initialize file storage' });
      throw new InternalError('Failed to initialize file storage', 'STORAGE_INIT_FAILED');
    }
  }

  /**
   * Warns (once per tier, at boot) when an upload tier is not on a mounted
   * volume in a production container, so uploads would vanish on the next
   * deploy. The deploy step it points to is in the README and
   * .env.example.production. Never stops the server.
   */
  warnIfUploadsNotPersistent(): void {
    for (const dir of uploadDirsOnContainerDisk([this.publicDir, this.privateDir], env.NODE_ENV)) {
      logger.warn(
        { dir },
        `[STORAGE] ${dir} is not on a mounted volume: uploaded files will be lost on the next deploy. ` +
          'In Coolify add a volume mount at /app/uploads (Storages → Add Volume Mount).',
      );
    }
  }
}

// Export singleton instance
export const fileStorageService = new FileStorageService();
