/**
 * drills 카탈로그 조회.
 */

import { getSupabaseClient, isSupabaseConfigured } from './client';

export type DrillRow = {
  id: string;
  name: string;
  description: string | null;
  video_url: string | null;
  target_issue: string | null;
  category: string | null;
};

export async function fetchDrillById(
  drillId: string,
): Promise<DrillRow | null> {
  if (!drillId || !isSupabaseConfigured()) {
    return null;
  }
  const supabase = getSupabaseClient();
  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase
    .from('drills')
    .select('id, name, description, video_url, target_issue, category')
    .eq('id', drillId)
    .maybeSingle();

  if (error) {
    console.warn('[fetchDrillById]', error.message);
    return null;
  }
  return (data as DrillRow | null) ?? null;
}
