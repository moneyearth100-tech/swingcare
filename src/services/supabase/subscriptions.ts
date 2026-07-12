/**
 * subscriptions 조회 — RevenueCat 웹훅이 채우는 행. 없으면 free 취급.
 */

import {
  ensureAnonymousUserId,
  getSupabaseClient,
  isSupabaseConfigured,
} from './client';

export type SubscriptionPlan = 'free' | 'premium';
export type SubscriptionStatus =
  | 'active'
  | 'canceled'
  | 'expired'
  | 'billing_issue';

export type SubscriptionRow = {
  id: string;
  user_id: string;
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  revenuecat_id: string | null;
  current_period_end: string | null;
};

export type SubscriptionState = {
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  isPremium: boolean;
  revenuecatLinked: boolean;
  currentPeriodEnd: string | null;
};

const FREE_STATE: SubscriptionState = {
  plan: 'free',
  status: 'active',
  isPremium: false,
  revenuecatLinked: false,
  currentPeriodEnd: null,
};

export async function fetchMySubscription(): Promise<SubscriptionState> {
  if (!isSupabaseConfigured()) {
    return FREE_STATE;
  }
  const supabase = getSupabaseClient();
  if (!supabase) {
    return FREE_STATE;
  }

  await ensureAnonymousUserId();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) {
    return FREE_STATE;
  }

  const { data, error } = await supabase
    .from('subscriptions')
    .select(
      'id, user_id, plan, status, revenuecat_id, current_period_end',
    )
    .eq('user_id', user.id)
    .maybeSingle();

  if (error) {
    console.warn('[fetchMySubscription]', error.message);
    return FREE_STATE;
  }
  if (!data) {
    return FREE_STATE;
  }

  const row = data as SubscriptionRow;
  const isPremium =
    row.plan === 'premium' &&
    row.status === 'active' &&
    (row.current_period_end == null ||
      new Date(row.current_period_end).getTime() > Date.now());

  return {
    plan: row.plan,
    status: row.status,
    isPremium,
    revenuecatLinked: Boolean(row.revenuecat_id),
    currentPeriodEnd: row.current_period_end,
  };
}
