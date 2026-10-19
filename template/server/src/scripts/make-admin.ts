/**
 * make-admin: promote an existing account to ADMIN.
 *
 *   Production (Coolify: the server app's Terminal):  node dist/scripts/make-admin.js you@example.com
 *   Local development:                                 npm run make-admin -- you@example.com
 *
 * The person signs up in the app first, with their own password; this only
 * changes that account's role (and marks its email verified). No password is
 * asked for, stored or printed, and nothing else is printed but the email and
 * the result, never DATABASE_URL. Uses the same env as the server (the
 * container's variables, or server/.env locally).
 * Exit code 0: promoted or already an admin. 1: anything else.
 */
import { prisma } from '@libs/prisma.js';
import { adminService } from '@modules/admin/admin.service.js';

const MESSAGES = {
  promoted: (email: string) => `${email} is now an admin.`,
  'already-admin': (email: string) => `${email} is already an admin.`,
  'not-found': () => 'No account with that email. Sign up in the app first, then run this again.',
  deleted: () => 'That account is deleted. Restore it first.',
  banned: () => 'That account is banned. Unban it first.',
} as const;

async function main(): Promise<number> {
  const email = process.argv[2];
  if (!email || !email.includes('@')) {
    console.error('Usage: node dist/scripts/make-admin.js <email>   (local: npm run make-admin -- <email>)');
    return 1;
  }
  const outcome = await adminService.promoteToAdmin(email);
  const message = MESSAGES[outcome](email.trim().toLowerCase());
  const ok = outcome === 'promoted' || outcome === 'already-admin';
  (ok ? console.log : console.error)(message);
  return ok ? 0 : 1;
}

main()
  .then(async (code) => {
    await prisma.$disconnect();
    process.exit(code);
  })
  .catch(async (error: unknown) => {
    // The message only (a Prisma connection error can carry the database host).
    console.error(`make-admin failed: ${error instanceof Error ? error.message.split('\n')[0] : 'unknown error'}`);
    await prisma.$disconnect().catch(() => undefined);
    process.exit(1);
  });
