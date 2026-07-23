#!/usr/bin/env node
/**
 * Apply all supabase/migrations/*.sql to the project in .env
 * Requires: SUPABASE_DB_PASSWORD (Dashboard → Settings → Database)
 *
 * Usage: node scripts/apply-supabase-migrations.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(root, '.env');
const envText = fs.readFileSync(envPath, 'utf8');
const env = Object.fromEntries(
  envText
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i), l.slice(i + 1)];
    }),
);

const url = env.EXPO_PUBLIC_SUPABASE_URL || '';
const ref = url.match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1];
const password = env.SUPABASE_DB_PASSWORD || process.env.SUPABASE_DB_PASSWORD;
if (!ref) {
  console.error('EXPO_PUBLIC_SUPABASE_URL missing/invalid in .env');
  process.exit(1);
}
if (!password) {
  console.error(
    'Add SUPABASE_DB_PASSWORD to .env (Dashboard → Project Settings → Database)',
  );
  process.exit(1);
}

const migrationsDir = path.join(root, 'supabase', 'migrations');
const files = fs
  .readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .sort();

const combined = files
  .map((f) => `-- >>> ${f}\n` + fs.readFileSync(path.join(migrationsDir, f), 'utf8'))
  .join('\n\n');

const sqlPath = path.join(root, 'supabase', '.rebuild_all.tmp.sql');
fs.writeFileSync(sqlPath, combined);

const dbUrl = `postgresql://postgres.${ref}:${encodeURIComponent(password)}@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres`;

console.log(`Applying ${files.length} migrations to ${ref} ...`);
const result = spawnSync(
  'psql',
  [dbUrl, '-v', 'ON_ERROR_STOP=1', '-f', sqlPath],
  { stdio: 'inherit', encoding: 'utf8' },
);
fs.unlinkSync(sqlPath);
if (result.status !== 0) {
  console.error('Migration failed. If region pooler host is wrong, set SUPABASE_DB_URL in .env to the URI from Dashboard → Database → Connection string (URI).');
  process.exit(result.status || 1);
}
console.log('Migrations applied.');
