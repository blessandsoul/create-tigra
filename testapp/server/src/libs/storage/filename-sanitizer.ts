/**
 * Filename Sanitizer Utility
 *
 * Generates SEO-friendly, URL-safe filenames from user names.
 * Supports international characters including Georgian letters.
 */

/**
 * Sanitizes text for use in filenames
 *
 * Rules:
 * - Convert to lowercase
 * - Replace spaces with hyphens
 * - Keep only: a-z, 0-9, hyphens, Georgian letters (ა-ჰ), common diacritics (à-ÿ)
 * - Replace multiple consecutive hyphens with single hyphen
 * - Remove leading/trailing hyphens
 *
 * @param text - Text to sanitize
 * @returns Sanitized filename-safe string
 *
 * @example
 * sanitizeForFilename("John Doe") // "john-doe"
 * sanitizeForFilename("მარიამ გელაშვილი") // "მარიამ-გელაშვილი"
 * sanitizeForFilename("José García-López") // "jose-garcia-lopez"
 * sanitizeForFilename("Anna  Marie O'Brien") // "anna-marie-obrien"
 */
export function sanitizeForFilename(text: string): string {
  return (
    text
      .toLowerCase()
      .trim()
      // Replace spaces with hyphens
      .replace(/\s+/g, '-')
      // Keep only: a-z, 0-9, hyphens, Georgian letters (ა-ჰ), common diacritics (à-ÿ)
      .replace(/[^a-z0-9\-ა-ჰà-ÿ]/g, '')
      // Replace multiple consecutive hyphens with single hyphen
      .replace(/-+/g, '-')
      // Remove leading/trailing hyphens
      .replace(/^-|-$/g, '')
  );
}

/**
 * Generates an SEO-friendly avatar filename based on user's name
 *
 * Format: {firstName}-{lastName}-avatar.{extension}
 *
 * @param firstName - User's first name
 * @param lastName - User's last name
 * @param extension - File extension (default: 'webp')
 * @returns SEO-friendly filename
 *
 * @example
 * generateAvatarFilename("John", "Doe") // "john-doe-avatar.webp"
 * generateAvatarFilename("მარიამ", "გელაშვილი") // "მარიამ-გელაშვილი-avatar.webp"
 * generateAvatarFilename("José", "García", "jpg") // "jose-garcia-avatar.jpg"
 */
export function generateAvatarFilename(
  firstName: string,
  lastName: string,
  extension: string = 'webp'
): string {
  const sanitizedFirst = sanitizeForFilename(firstName);
  const sanitizedLast = sanitizeForFilename(lastName);

  // Handle edge case where sanitization results in empty string
  const first = sanitizedFirst || 'user';
  const last = sanitizedLast || 'avatar';

  return `${first}-${last}-avatar.${extension}`;
}
