import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';

const prisma = new PrismaClient();

// Well-known dev-only fallbacks. NEVER used in production — the guard in
// main() seeds only when NODE_ENV is explicitly development or test, and even
// then you can override via SEED_ADMIN_PASSWORD / SEED_USER_PASSWORD.
const DEV_ADMIN_PASSWORD = 'Admin123!';
const DEV_USER_PASSWORD = 'User123!';

// Environments where demo accounts are acceptable. Anything else, including an
// unset NODE_ENV, is treated as production (matching src/config/env.ts).
const SEEDABLE_ENVS = new Set(['development', 'test']);

async function main(): Promise<void> {
  // Refuse to seed production: this script creates a well-known admin account
  // (admin@example.com). On a production database that is a backdoor, not a
  // convenience. Seed data belongs to dev/test environments only, so the guard
  // is an allowlist: a missing NODE_ENV must not slip through.
  if (!SEEDABLE_ENVS.has(process.env.NODE_ENV ?? '')) {
    console.error(
      `Refusing to seed: NODE_ENV is "${process.env.NODE_ENV ?? '(unset)'}" (seeding needs development or test).\n` +
      'The seed script creates well-known demo accounts (admin@example.com) and must never run against a production database.\n' +
      'If you really need initial data in production, create it manually or write a dedicated, audited provisioning script.',
    );
    process.exit(1);
  }

  const adminPassword = await argon2.hash(process.env.SEED_ADMIN_PASSWORD || DEV_ADMIN_PASSWORD);
  const userPassword = await argon2.hash(process.env.SEED_USER_PASSWORD || DEV_USER_PASSWORD);

  const admin = await prisma.user.upsert({
    where: { email: 'admin@example.com' },
    update: {},
    create: {
      email: 'admin@example.com',
      password: adminPassword,
      firstName: 'Admin',
      lastName: 'User',
      role: 'ADMIN',
      // Demo accounts are pre-verified so they can log in with email verification on.
      emailVerifiedAt: new Date(),
    },
  });

  const user = await prisma.user.upsert({
    where: { email: 'user@example.com' },
    update: {},
    create: {
      email: 'user@example.com',
      password: userPassword,
      firstName: 'Test',
      lastName: 'User',
      role: 'USER',
      emailVerifiedAt: new Date(),
    },
  });

  console.log('Seeded users:', { admin: admin.email, user: user.email });
}

main()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
