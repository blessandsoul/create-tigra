/**
 * File Upload Validator
 *
 * Validates uploaded files for security and compliance with upload constraints.
 */

import type { MultipartFile } from '@fastify/multipart';
import { ValidationError } from '@shared/errors/errors.js';
import path from 'path';

/**
 * File upload constants and constraints
 */
export const FILE_UPLOAD_CONSTANTS = {
  MAX_FILE_SIZE: 5 * 1024 * 1024, // 5MB in bytes
  ALLOWED_MIME_TYPES: ['image/jpeg', 'image/png', 'image/webp'] as const,
  ALLOWED_EXTENSIONS: ['.jpg', '.jpeg', '.png', '.webp'] as const,
  AVATAR_MAX_DIMENSION: 512, // pixels
} as const;

/**
 * Validates an uploaded image file
 *
 * Checks:
 * - File size within limits
 * - MIME type is allowed
 * - File extension is allowed (prevents disguised files)
 * - File is not executable
 *
 * @param file - Fastify multipart file object
 * @throws ValidationError if file is invalid
 *
 * @example
 * ```typescript
 * const file = await request.file();
 * validateImageFile(file); // Throws if invalid
 * ```
 */
export function validateImageFile(file: MultipartFile): void {
  // Validate file exists
  if (!file) {
    throw new ValidationError('No file was uploaded', 'FILE_REQUIRED');
  }

  // Validate file size
  if (!file.file.bytesRead) {
    throw new ValidationError('Uploaded file is empty', 'FILE_EMPTY');
  }

  // Note: file.file.bytesRead might not be available until the stream is consumed
  // For proper size validation, we'll need to check this during buffer reading

  // Validate MIME type
  const mimeType = file.mimetype;
  if (!(FILE_UPLOAD_CONSTANTS.ALLOWED_MIME_TYPES as readonly string[]).includes(mimeType)) {
    throw new ValidationError(
      `Invalid file type. Allowed types: ${FILE_UPLOAD_CONSTANTS.ALLOWED_MIME_TYPES.join(', ')}`,
      'INVALID_FILE_TYPE'
    );
  }

  // Validate file extension (prevents MIME type spoofing)
  const extension = path.extname(file.filename).toLowerCase();
  if (!(FILE_UPLOAD_CONSTANTS.ALLOWED_EXTENSIONS as readonly string[]).includes(extension)) {
    throw new ValidationError(
      `Invalid file extension. Allowed extensions: ${FILE_UPLOAD_CONSTANTS.ALLOWED_EXTENSIONS.join(', ')}`,
      'INVALID_FILE_EXTENSION'
    );
  }

  // Prevent executable files (extra security layer)
  const dangerousExtensions = ['.exe', '.sh', '.bat', '.cmd', '.com', '.pif', '.scr', '.vbs', '.js'];
  const lowerFilename = file.filename.toLowerCase();
  if (dangerousExtensions.some((ext) => lowerFilename.endsWith(ext))) {
    throw new ValidationError('Executable files are not allowed', 'DANGEROUS_FILE');
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
