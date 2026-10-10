/**
 * Image Optimization Service
 *
 * Handles image processing, optimization, and validation using Sharp.
 *
 * Safety rules for user-uploaded images (avatars are public):
 *  - PRIVACY: the output carries NO metadata. sharp strips EXIF/XMP/IPTC by
 *    default; never call `.withMetadata()` / `.keepMetadata()` here — it keeps
 *    the uploader's GPS location, device and capture time in a public file.
 *    Orientation is applied to the pixels first (autoOrient) so photos don't
 *    end up sideways once the orientation tag is gone.
 *  - MEMORY: a small file can describe a huge picture (a one-colour 16k×16k
 *    PNG is ~100 KB but ~1 GB once decoded). The upload size limit only bounds
 *    the compressed bytes, so we also cap the decoded pixel count BEFORE
 *    decoding, accept only real JPEG/PNG/WebP/HEIF content (judged from the
 *    bytes, not the client's filename or MIME type), and time out slow work.
 */

import sharp from 'sharp';
import { FILE_UPLOAD_CONSTANTS } from './file-validator.js';
import { ValidationError, InternalError } from '@shared/errors/errors.js';
import { logger } from '@libs/logger.js';

/**
 * Largest image we agree to decode: 50 megapixels. Covers 48 MP phone photos
 * (8064×6048); normal photos are 12–24 MP. Bounds decode memory to roughly
 * 200 MB per upload instead of sharp's default ~1 GB (268 MP).
 */
export const MAX_INPUT_PIXELS = 50_000_000;

/** Formats sharp detects from the file's bytes that we accept for avatars. */
export const ALLOWED_INPUT_FORMATS = ['jpeg', 'png', 'webp', 'heif'] as const;

/** Hard stop for a single image's processing time. */
const PROCESSING_TIMEOUT_SECONDS = 10;

/** sharp options shared by the probe and the pipeline so both enforce the same limit. */
const INPUT_OPTIONS = { limitInputPixels: MAX_INPUT_PIXELS, autoOrient: true } as const;

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
   * 1. Check the real format and the pixel count before decoding
   * 2. Apply EXIF orientation to the pixels
   * 3. Resize to max 512x512 (preserves aspect ratio)
   * 4. Convert to WebP (~85% quality) with ALL metadata stripped
   *
   * @param buffer - Original image buffer
   * @returns Optimized image buffer in WebP format
   * @throws ValidationError if the image is invalid, too large or an unsupported format
   * @throws InternalError if optimization fails unexpectedly
   */
  async optimizeAvatar(buffer: Buffer): Promise<Buffer> {
    try {
      // Reads only the header: cheap, and enforces the pixel limit up front.
      const metadata = await sharp(buffer, INPUT_OPTIONS).metadata();

      if (!metadata.width || !metadata.height) {
        throw new ValidationError('Unable to read image dimensions', 'INVALID_IMAGE');
      }
      if (!metadata.format || !(ALLOWED_INPUT_FORMATS as readonly string[]).includes(metadata.format)) {
        throw new ValidationError(
          'Image format is not supported. Use JPEG, PNG or WebP.',
          'UNSUPPORTED_IMAGE_FORMAT',
        );
      }
      if (metadata.width * metadata.height > MAX_INPUT_PIXELS) {
        throw new ValidationError('Image dimensions are too large', 'IMAGE_TOO_LARGE');
      }

      logger.info({
        msg: 'Optimizing avatar image',
        originalFormat: metadata.format,
        originalSize: buffer.length,
        originalDimensions: `${metadata.width}x${metadata.height}`,
      });

      const optimized = await sharp(buffer, INPUT_OPTIONS)
        .timeout({ seconds: PROCESSING_TIMEOUT_SECONDS })
        // Resize to max 512x512, preserve aspect ratio
        .resize(FILE_UPLOAD_CONSTANTS.AVATAR_MAX_DIMENSION, FILE_UPLOAD_CONSTANTS.AVATAR_MAX_DIMENSION, {
          fit: 'inside', // Preserve aspect ratio, fit within bounds
          withoutEnlargement: true, // Don't upscale smaller images
        })
        // Convert to WebP. No withMetadata(): the output keeps no EXIF/GPS/XMP.
        .webp({
          quality: 85, // Balance between quality and file size
          effort: 4, // Compression effort (0-6, higher = better compression but slower)
        })
        .toBuffer();

      logger.info({
        msg: 'Avatar optimization complete',
        optimizedSize: optimized.length,
        compressionRatio: `${((1 - optimized.length / buffer.length) * 100).toFixed(1)}%`,
      });

      return optimized;
    } catch (error) {
      if (error instanceof ValidationError) {
        throw error;
      }

      // sharp rejects bad input with plain Errors; map them to client errors.
      if (error instanceof Error) {
        const message = error.message.toLowerCase();
        if (message.includes('pixel limit')) {
          throw new ValidationError('Image dimensions are too large', 'IMAGE_TOO_LARGE');
        }
        if (message.includes('timeout')) {
          throw new ValidationError('Image is too complex to process', 'IMAGE_TOO_COMPLEX');
        }
        if (
          message.includes('unsupported image format') ||
          message.includes('input file is missing') ||
          message.includes('bad seek') ||
          message.includes('corrupt') ||
          message.includes('heif')
        ) {
          throw new ValidationError('Invalid or unsupported image', 'INVALID_IMAGE');
        }
      }

      // Wrap unexpected errors
      logger.error({ err: error, msg: 'Image optimization failed' });
      throw new InternalError('Failed to optimize image', 'IMAGE_OPTIMIZATION_FAILED');
    }
  }
}

// Export singleton instance
export const imageOptimizerService = new ImageOptimizerService();
