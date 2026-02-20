/**
 * Image Optimization Service
 *
 * Handles image processing, optimization, and validation using Sharp.
 */

import sharp from 'sharp';
import { FILE_UPLOAD_CONSTANTS } from './file-validator.js';
import { ValidationError, InternalError } from '@shared/errors/errors.js';
import { logger } from '@libs/logger.js';

/**
 * Image Optimizer Service
 *
 * Provides methods for optimizing and validating images for avatar uploads.
 */
class ImageOptimizerService {
  /**
   * Optimizes an image for avatar use
   *
   * Process:
   * 1. Resize to max 512x512 (preserves aspect ratio)
   * 2. Convert to WebP format for best compression
   * 3. Compress to ~85% quality
   * 4. Strip EXIF metadata for privacy
   *
   * @param buffer - Original image buffer
   * @returns Optimized image buffer in WebP format
   * @throws ValidationError if image is invalid
   * @throws InternalError if optimization fails
   *
   * @example
   * ```typescript
   * const optimized = await imageOptimizerService.optimizeAvatar(imageBuffer);
   * ```
   */
  async optimizeAvatar(buffer: Buffer): Promise<Buffer> {
    try {
      // Validate that buffer contains a valid image
      const metadata = await sharp(buffer).metadata();

      if (!metadata.width || !metadata.height) {
        throw new ValidationError('Unable to read image dimensions', 'INVALID_IMAGE');
      }

      logger.info({
        msg: 'Optimizing avatar image',
        originalFormat: metadata.format,
        originalSize: buffer.length,
        originalDimensions: `${metadata.width}x${metadata.height}`,
      });

      // Optimize image
      const optimized = await sharp(buffer)
        // Resize to max 512x512, preserve aspect ratio
        .resize(FILE_UPLOAD_CONSTANTS.AVATAR_MAX_DIMENSION, FILE_UPLOAD_CONSTANTS.AVATAR_MAX_DIMENSION, {
          fit: 'inside', // Preserve aspect ratio, fit within bounds
          withoutEnlargement: true, // Don't upscale smaller images
        })
        // Convert to WebP with quality optimization
        .webp({
          quality: 85, // Balance between quality and file size
          effort: 4, // Compression effort (0-6, higher = better compression but slower)
        })
        // Strip EXIF metadata for privacy
        .withMetadata({
          exif: {},
          icc: undefined,
        })
        .toBuffer();

      logger.info({
        msg: 'Avatar optimization complete',
        optimizedSize: optimized.length,
        compressionRatio: `${((1 - optimized.length / buffer.length) * 100).toFixed(1)}%`,
      });

      return optimized;
    } catch (error) {
      // Handle Sharp-specific errors
      if (error instanceof Error) {
        if (error.message.includes('Input buffer contains unsupported image format')) {
          throw new ValidationError('Image format is not supported', 'UNSUPPORTED_IMAGE_FORMAT');
        }

        if (error.message.includes('Input file is missing')) {
          throw new ValidationError('Invalid image data', 'INVALID_IMAGE');
        }
      }

      // Re-throw ValidationError as-is
      if (error instanceof ValidationError) {
        throw error;
      }

      // Wrap unexpected errors
      logger.error({ err: error, msg: 'Image optimization failed' });
      throw new InternalError('Failed to optimize image', 'IMAGE_OPTIMIZATION_FAILED');
    }
  }

  /**
   * Validates that a buffer contains a valid image
   *
   * @param buffer - Buffer to validate
   * @returns True if buffer is a valid image
   * @throws ValidationError if buffer is invalid
   *
   * @example
   * ```typescript
   * await imageOptimizerService.validateImageBuffer(buffer);
   * ```
   */
  async validateImageBuffer(buffer: Buffer): Promise<boolean> {
    try {
      const metadata = await sharp(buffer).metadata();

      if (!metadata.format || !metadata.width || !metadata.height) {
        throw new ValidationError('Buffer does not contain a valid image', 'INVALID_IMAGE');
      }

      // Check if format is supported
      const supportedFormats = ['jpeg', 'png', 'webp', 'gif'];
      if (!supportedFormats.includes(metadata.format)) {
        throw new ValidationError(
          `Image format '${metadata.format}' is not supported`,
          'UNSUPPORTED_IMAGE_FORMAT'
        );
      }

      return true;
    } catch (error) {
      if (error instanceof ValidationError) {
        throw error;
      }

      logger.error({ err: error, msg: 'Image validation failed' });
      throw new ValidationError('Unable to validate image', 'INVALID_IMAGE');
    }
  }
}

// Export singleton instance
export const imageOptimizerService = new ImageOptimizerService();
