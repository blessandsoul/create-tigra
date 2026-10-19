/**
 * Name rules at register and profile update: the name is trimmed BEFORE its
 * length is checked, so blanks never become an empty name, and an update that
 * sends nothing is wrong input (422 VALIDATION_FAILED naming both fields).
 */
import { describe, expect, it } from 'vitest';
import { registerSchema } from '@modules/auth/auth.schemas.js';
import { UpdateProfileSchema } from '../users.schemas.js';

const base = { email: 'qa@example.test', password: 'Passw0rd-123', lastName: 'Tester' };

describe('register name rules', () => {
  it.each(['   ', ' a ', '\t\n'])('refuses %j as a first name', (firstName) => {
    const result = registerSchema.safeParse({ ...base, firstName });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.path.join('.'))).toEqual(['firstName']);
  });

  it('stores the trimmed name', () => {
    expect(registerSchema.parse({ ...base, firstName: '  Ann  ' }).firstName).toBe('Ann');
  });

  it('judges the length after trimming (100 letters plus spaces is fine)', () => {
    expect(registerSchema.parse({ ...base, firstName: `${'a'.repeat(100)}   ` }).firstName).toHaveLength(100);
  });
});

describe('profile update rules', () => {
  it('refuses an update with nothing in it, naming both fields', () => {
    const result = UpdateProfileSchema.safeParse({});
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.path.join('.')).sort()).toEqual(['firstName', 'lastName']);
  });

  it('refuses a blank name instead of silently ignoring it', () => {
    expect(UpdateProfileSchema.safeParse({ firstName: '   ' }).success).toBe(false);
  });

  it('accepts and trims one field', () => {
    expect(UpdateProfileSchema.parse({ firstName: ' Bo ' })).toEqual({ firstName: 'Bo' });
  });

  it('drops fields it does not know (role cannot be set here)', () => {
    expect(UpdateProfileSchema.parse({ lastName: 'Lee', role: 'ADMIN' })).toEqual({ lastName: 'Lee' });
  });
});
