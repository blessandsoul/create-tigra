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
 * The public avatar URL shape is UNCHANGED — `/uploads/users/{id}/avatar/x.webp`
 * — because the static mount serves UPLOAD_PUBLIC_DIR at prefix `/uploads/`, so
 * the file just moves one level down on disk (under public/) with no URL churn.
 */

import fs from 'fs/promises';
import path from 'path';
import { env } from '@config/env.js';
import { logger } from '@libs/logger.js';
import { InternalError } from '@shared/errors/errors.js';
import { generateAvatarFilename } from './filename-sanitizer.js';

/**
 * File Storage Service
 *
 * Manages local file storage with per-user directories and SEO-friendly naming.
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
   * Saves an avatar image to user-specific directory
   *
   * Process:
   * 1. Create user avatar directory if it doesn't exist
   * 2. Generate SEO-friendly filename
   * 3. Save buffer to file (overwrites existing avatar)
   * 4. Return filename and public URL
   *
   * @param userId - User's unique ID
   * @param buffer - Optimized image buffer
   * @param firstName - User's first name (for SEO filename)
   * @param lastName - User's last name (for SEO filename)
   * @returns Filename and URL of saved avatar
   *
   * @example
   * ```typescript
   * const { filename, url } = await fileStorageService.saveAvatar(
   *   userId,
   *   imageBuffer,
   *   'John',
   *   'Doe'
   * );
   * // filename: "john-doe-avatar.webp"
   * // url: "/uploads/users/{userId}/avatar/john-doe-avatar.webp"
   * ```
   */
  async saveAvatar(
    userId: string,
    buffer: Buffer,
    firstName: string,
    lastName: string
  ): Promise<{ filename: string; url: string }> {
    try {
      // Ensure user's avatar directory exists
      const avatarDir = this.getUserAvatarDir(userId);
      await this.ensureDirectoryExists(avatarDir);

      // Generate SEO-friendly filename
      const filename = generateAvatarFilename(firstName, lastName, 'webp');
      const filePath = path.join(avatarDir, filename);

      // Write file to disk (overwrites existing)
      await fs.writeFile(filePath, buffer);

      // Generate public URL
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
   * Deletes all media for a user (entire user directory)
   *
   * Used by the cleanup job when permanently purging deleted accounts.
   * No-op if the user directory doesn't exist.
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
      const userDir = this.getUserDir(userId);

      const exists = await this.directoryExists(userDir);
      if (!exists) {
        return;
      }

      await fs.rm(userDir, { recursive: true, force: true });

      logger.info({ msg: 'User media deleted successfully', userId });
    } catch (error) {
      logger.error({ err: error, msg: 'Failed to delete user media', userId });
      throw new InternalError('Failed to delete user media', 'FILE_DELETE_FAILED');
    }
  }

  /**
   * Gets the full file system path for an avatar
   *
   * @param userId - User's unique ID
   * @param filename - Avatar filename
   * @returns Absolute file path
   */
  getAvatarPath(userId: string, filename: string): string {
    return path.join(this.getUserAvatarDir(userId), filename);
  }

  /**
   * Gets the public URL for an avatar
   *
   * @param userId - User's unique ID
   * @param filename - Avatar filename
   * @returns Public URL path
   */
  getAvatarUrl(userId: string, filename: string): string {
    return `/uploads/users/${userId}/avatar/${filename}`;
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
   * Checks if a file exists
   *
   * @param filePath - Full file path
   * @returns True if file exists
   */
  async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
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
}

// Export singleton instance
export const fileStorageService = new FileStorageService();
