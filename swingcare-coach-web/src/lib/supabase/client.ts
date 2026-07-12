import { createBrowserClient } from '@supabase/ssr';

import { getSupabasePublicConfig } from '@/lib/supabase/config';

export function createClient() {
  const config = getSupabasePublicConfig();
  if (!config) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY 가 없습니다.',
    );
  }
  return createBrowserClient(config.url, config.anonKey);
}
