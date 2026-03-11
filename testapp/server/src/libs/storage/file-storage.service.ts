/**
 * File Storage Service
 *
 * Handles local file system operations for user-uploaded files.
 * Directory structure: uploads/users/{userId}/<media-type>/
 */

import fs from 'fs/promises';
import path from 'path';
import { logger } from '@libs/logger.js';
import { InternalError } from '@shared/errors/errors.js';
import { generateAvatarFilename } from './filename-sanitizer.js';

/**
 * File Storage Service
 *
 * Manages local file storage with per-user directories and SEO-friendly naming.
 * All user media lives under uploads/users/{userId}/ for easy per-user cleanup.
 */
class FileStorageService {
  private readonly uploadDir: string;
  private readonly usersDir: string;

  constructor() {
    // Base upload directory: server/uploads
    this.uploadDir = path.join(process.cwd(), 'uploads');
    // Users media directory: server/uploads/users
    this.usersDir = path.join(this.uploadDir, 'users');
  }

  /**
   * Gets the base directory for a user's media
   */
  private getUserDir(userId: string): string {
    return path.join(this.usersDir, userId);
  }

  /**
   * Gets the avatar directory for a user
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
   * Creates base uploads directory and users subdirectory if they don't exist.
   * Should be called at application startup.
   */
  async initialize(): Promise<void> {
    try {
      await this.ensureDirectoryExists(this.uploadDir);
      await this.ensureDirectoryExists(this.usersDir);
      logger.info({ msg: 'File storage initialized', uploadDir: this.uploadDir });
    } catch (error) {
      logger.error({ err: error, msg: 'Failed to initialize file storage' });
      throw new InternalError('Failed to initialize file storage', 'STORAGE_INIT_FAILED');
    }
  }
}

// Export singleton instance
export const fileStorageService = new FileStorageService();
