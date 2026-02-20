import argon2 from 'argon2';

// OWASP recommended argon2id configuration
const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 65536, // 64 MB
  timeCost: 3,
  parallelism: 4,
};

/**
 * Hash a password using argon2id
 */
export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON2_OPTIONS);
}

/**
 * Verify a password against a hash.
 * Supports both argon2 and legacy bcrypt hashes.
 * Returns { valid, needsRehash } so the caller can transparently upgrade bcrypt hashes.
 */
export async function verifyPassword(
  password: string,
  hash: string,
): Promise<{ valid: boolean; needsRehash: boolean }> {
  const isBcryptHash = hash.startsWith('$2a$') || hash.startsWith('$2b$') || hash.startsWith('$2y$');

  if (isBcryptHash) {
    // Lazy-import bcryptjs only for legacy hash verification
    const bcrypt = await import('bcryptjs');
    const valid = await bcrypt.default.compare(password, hash);
    return { valid, needsRehash: valid }; // rehash only if password is correct
  }

  const valid = await argon2.verify(hash, password);
  return { valid, needsRehash: false };
}
