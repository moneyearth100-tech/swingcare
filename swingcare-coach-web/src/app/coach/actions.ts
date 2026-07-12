'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { getCoachSession, getServerSupabase } from '@/lib/coachAuth';
import type { CoachRequestStatus } from '@/lib/types';

export async function signOutAction() {
  const supabase = await getServerSupabase();
  if (supabase) {
    await supabase.auth.signOut();
  }
  redirect('/coach/login');
}

export async function updateRequestAction(formData: FormData) {
  const requestId = String(formData.get('requestId') ?? '');
  const reply = String(formData.get('reply') ?? '').trim();
  const nextStatus = String(formData.get('status') ?? '') as CoachRequestStatus;

  if (!requestId) {
    return { ok: false as const, error: '요청 ID가 없습니다' };
  }

  const allowed: CoachRequestStatus[] = [
    'accepted',
    'in_review',
    'completed',
    'canceled',
  ];
  if (!allowed.includes(nextStatus)) {
    return { ok: false as const, error: '허용되지 않은 상태입니다' };
  }

  const supabase = await getServerSupabase();
  if (!supabase) {
    return { ok: false as const, error: 'Supabase 환경 변수가 없습니다' };
  }
  const session = await getCoachSession();
  if (!session) {
    return { ok: false as const, error: '코치 권한이 없습니다' };
  }

  const patch: {
    status: CoachRequestStatus;
    coach_reply_text?: string;
    coach_replied_at?: string;
  } = { status: nextStatus };

  if (reply.length > 0) {
    patch.coach_reply_text = reply;
    patch.coach_replied_at = new Date().toISOString();
  } else if (nextStatus === 'completed') {
    return {
      ok: false as const,
      error: '완료하려면 회신 내용을 입력해 주세요',
    };
  }

  const { error } = await supabase
    .from('coaching_requests')
    .update(patch)
    .eq('id', requestId)
    .eq('coach_id', session.coachId);

  if (error) {
    return { ok: false as const, error: error.message };
  }

  revalidatePath('/coach/requests');
  revalidatePath(`/coach/requests/${requestId}`);
  return { ok: true as const };
}
