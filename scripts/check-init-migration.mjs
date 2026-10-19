#!/usr/bin/env node
/**
 * Template-maintainer check: the shipped first migration
 * (template/server/prisma/migrations/0_init/migration.sql) must create exactly
 * the tables template/server/prisma/schema.prisma describes.
 *
 * Why it exists: new projects get this migration so their first `migrate dev`
 * (local) and the container's `migrate deploy` (production) create the tables
 * with no extra step. If the template's schema changes and 0_init is not
 * regenerated, new projects would start with tables that do not match their
 * schema. This check fails loudly in that case.
 *
 * It compares against `prisma migrate diff --from-empty`, so it needs no
 * database, only template/server's installed node_modules (`npm ci` there).
 * Only the template is checked: in a generated project, 0_init stays as shipped
 * and later schema changes become new migrations.
 *
 * Usage: node scripts/check-init-migration.mjs [schema.prisma] [migration.sql]
 * (the optional paths let the check itself be tested against altered copies).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverDir = path.join(root, 'template', 'server');
const schema = path.resolve(process.argv[2] ?? path.join(serverDir, 'prisma', 'schema.prisma'));
const migration = path.resolve(process.argv[3] ?? path.join(serverDir, 'prisma', 'migrations', '0_init', 'migration.sql'));
const prismaCli = path.join(serverDir, 'node_modules', 'prisma', 'build', 'index.js');

const REGENERATE =
  'cd template/server && npx prisma migrate diff --from-empty --to-schema-datamodel ' +
  'prisma/schema.prisma --script > prisma/migrations/0_init/migration.sql';

// Line endings and trailing whitespace are not part of the SQL's meaning
// (Windows checkouts may hold CRLF); everything else must match exactly.
const normalize = (sql) => sql.replace(/\r\n/g, '\n').trimEnd();

let expected;
try {
  expected = execFileSync(
    process.execPath,
    [prismaCli, 'migrate', 'diff', '--from-empty', '--to-schema-datamodel', schema, '--script'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
} catch (error) {
  console.error(`check-init-migration: could not run prisma (run npm ci in template/server first): ${error.message}`);
  process.exit(2);
}

if (normalize(expected) !== normalize(readFileSync(migration, 'utf8'))) {
  console.error('check-init-migration: 0_init/migration.sql does not match schema.prisma.');
  console.error(`Regenerate it, review the diff, and commit:\n  ${REGENERATE}`);
  process.exit(1);
}
console.log('check-init-migration: 0_init matches schema.prisma');
