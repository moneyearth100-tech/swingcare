import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

import { getSupabasePublicConfig } from '@/lib/supabase/config';

let browserClient: SupabaseClient | null = null;

export function createClient() {
  if (browserClient) {
    return browserClient;
  }
  const config = getSupabasePublicConfig();
  if (!config) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY 가 없습니다.',
    );
  }
  browserClient = createBrowserClient(config.url, config.anonKey);
  return browserClient;
}
