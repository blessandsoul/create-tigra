/**
 * File Upload Validator
 *
 * Size and count limits for uploads. Which image formats are accepted is NOT
 * decided here: the browser-sent type and filename are not trusted, and are
 * often wrong for real photos (a browser that does not know .heic sends
 * application/octet-stream). The image's own bytes decide, in
 * image-optimizer.service.ts, and the output is always a re-encoded WebP.
 */

import type { MultipartFile } from '@fastify/multipart';
import { ValidationError } from '@shared/errors/errors.js';
import { env } from '@config/env.js';

/**
 * File upload constants and constraints
 */
export const FILE_UPLOAD_CONSTANTS = {
  MAX_FILE_SIZE: env.MAX_FILE_SIZE_MB * 1024 * 1024, // ENV-configurable (default 10MB)
  AVATAR_MAX_DIMENSION: 512, // pixels
} as const;

/**
 * Limits for the non-file parts of a multipart upload (passed to
 * @fastify/multipart in app.ts, next to the file size and count).
 *
 * Form fields that arrive BEFORE the file are kept in memory while the parser
 * looks for the file. The library defaults (1 MB per field, 1,000 parts) let one
 * request make the server hold about 1 GB, and any signed-in user (registration
 * is free) can send that to the avatar upload. Proven live: 300 fields of 1 MB
 * grew the server by 429 MB. These caps bound it to about 2 MB:
 * - more fields or parts than allowed: 413 MULTIPART_LIMIT (libs/error-handler.ts);
 * - a field longer than fieldSize is truncated, never buffered whole.
 * Raise them only for a route that really sends many or large fields.
 */
export const MULTIPART_LIMITS = {
  fields: 20,
  fieldSize: 100 * 1024, // bytes per field
  parts: 25, // fields + files, a backstop behind the two limits above
} as const;

/**
 * Checks that an upload carries a file.
 *
 * The browser-sent MIME type and filename are deliberately ignored: they are
 * the client's claim, not the content. imageOptimizerService.optimizeAvatar
 * judges the real format from the bytes and re-encodes the image, so a file
 * named photo.exe that is really a PNG becomes a plain WebP, and a text file
 * named photo.jpg is refused.
 *
 * @param file - Fastify multipart file object
 * @throws ValidationError (FILE_REQUIRED) when no file was sent
 */
export function validateImageFile(file: MultipartFile | undefined): void {
  if (!file) {
    throw new ValidationError('No file was uploaded', 'FILE_REQUIRED');
  }
}

/**
 * Validates file buffer size
 *
 * @param buffer - File buffer
 * @throws ValidationError if buffer exceeds max size
 */
export function validateFileSize(buffer: Buffer): void {
  if (buffer.length === 0) {
    throw new ValidationError('Uploaded file is empty', 'FILE_EMPTY');
  }

  if (buffer.length > FILE_UPLOAD_CONSTANTS.MAX_FILE_SIZE) {
    const maxSizeMB = FILE_UPLOAD_CONSTANTS.MAX_FILE_SIZE / (1024 * 1024);
    throw new ValidationError(
      `File size exceeds maximum allowed size of ${maxSizeMB}MB`,
      'FILE_TOO_LARGE'
    );
  }
}
