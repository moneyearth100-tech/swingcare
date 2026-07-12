/**
 * pending 전환 시 코치 이메일 알림 (Resend).
 * RESEND_API_KEY / COACHING_NOTIFY_FROM 없으면 no-op 로그.
 */

import { getAdminClient } from './supabaseAdmin.js';

export async function notifyCoachPendingEmail(
  requestId: string,
): Promise<{ sent: boolean; reason?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  const from =
    process.env.COACHING_NOTIFY_FROM ?? 'SwingCare <onboarding@resend.dev>';
  if (!apiKey) {
    console.warn('[notifyCoach] RESEND_API_KEY unset — skip');
    return { sent: false, reason: 'no_resend_key' };
  }

  const supabase = getAdminClient();
  const { data: request, error } = await supabase
    .from('coaching_requests')
    .select(
      'id, issue_phase, diagnosis_summary, coach_id, created_at, coaches ( id, name, auth_user_id )',
    )
    .eq('id', requestId)
    .maybeSingle();

  if (error || !request) {
    return { sent: false, reason: error?.message ?? 'not_found' };
  }

  const coachRaw = request.coaches as
    | { id: string; name: string; auth_user_id: string | null }
    | { id: string; name: string; auth_user_id: string | null }[]
    | null;
  const coach = Array.isArray(coachRaw) ? coachRaw[0] : coachRaw;
  if (!coach?.auth_user_id) {
    return { sent: false, reason: 'coach_no_auth_user' };
  }

  const { data: authUser, error: authErr } =
    await supabase.auth.admin.getUserById(coach.auth_user_id);
  if (authErr || !authUser.user?.email) {
    return { sent: false, reason: 'coach_no_email' };
  }

  const subject = `[SwingCare] 새 코칭 요청이 도착했어요`;
  const body = [
    `${coach.name} 코치님, 안녕하세요.`,
    '',
    '새로운 스윙 코칭 요청이 pending 상태입니다.',
    `요청 ID: ${request.id}`,
    `구간: ${request.issue_phase ?? '-'}`,
    `요약: ${request.diagnosis_summary ?? '-'}`,
    '',
    '코치 웹에서 확인해 주세요.',
  ].join('\n');

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [authUser.user.email],
      subject,
      text: body,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    console.warn('[notifyCoach] resend', response.status, text);
    return { sent: false, reason: `resend_${response.status}` };
  }
  return { sent: true };
}
