import path from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(apiRoot, '..');

dotenv.config({ path: path.join(apiRoot, '.env') });
dotenv.config({ path: path.join(repoRoot, '.env') });

function optional(name: string, fallback?: string): string | undefined {
  const value = process.env[name] ?? fallback;
  return value || undefined;
}

export const config = {
  port: Number(process.env.PORT ?? 8091),
  redisUrl: process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
  visionExtractUrl:
    process.env.VISION_EXTRACT_URL ?? 'http://127.0.0.1:8090/v1/extract',
  visionFps: Number(process.env.VISION_EXTRACT_FPS ?? 30),
  supabaseUrl:
    optional('SUPABASE_URL', process.env.EXPO_PUBLIC_SUPABASE_URL) ?? '',
  supabaseServiceRoleKey: optional('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  pendingPollMs: Number(process.env.PENDING_POLL_MS ?? 15_000),
  jobAttempts: Number(process.env.ANALYZE_JOB_ATTEMPTS ?? 3),
};

export function assertWorkerEnv(): void {
  if (!config.supabaseUrl) {
    throw new Error('Missing SUPABASE_URL (or EXPO_PUBLIC_SUPABASE_URL)');
  }
  if (!config.supabaseServiceRoleKey) {
    throw new Error(
      'Missing SUPABASE_SERVICE_ROLE_KEY — add to swingcare-api/.env or repo .env (Dashboard → Settings → API)',
    );
  }
}
