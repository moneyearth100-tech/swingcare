-- Supabase Edge Function: notify-coach-pending
-- Deploy: supabase functions deploy notify-coach-pending
-- Secrets: RESEND_API_KEY, COACHING_NOTIFY_FROM, SUPABASE_SERVICE_ROLE_KEY
-- Optional DB Webhook: coaching_requests UPDATE when status becomes pending → this function

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors });
  }

  try {
    const resendKey = Deno.env.get('RESEND_API_KEY');
    const from =
      Deno.env.get('COACHING_NOTIFY_FROM') ??
      'SwingCare <onboarding@resend.dev>';
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    if (!resendKey || !supabaseUrl || !serviceKey) {
      return new Response(
        JSON.stringify({ ok: false, error: 'missing_secrets' }),
        { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } },
      );
    }

    const payload = await req.json();
    const requestId =
      payload?.record?.id ??
      payload?.requestId ??
      payload?.coaching_request_id;
    if (!requestId) {
      return new Response(
        JSON.stringify({ ok: false, error: 'requestId_required' }),
        { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } },
      );
    }

    const status = payload?.record?.status ?? payload?.status;
    if (status && status !== 'pending') {
      return new Response(
        JSON.stringify({ ok: true, skipped: true, reason: 'not_pending' }),
        { headers: { ...cors, 'Content-Type': 'application/json' } },
      );
    }

    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: request, error } = await supabase
      .from('coaching_requests')
      .select(
        'id, issue_phase, diagnosis_summary, coach_id, coaches ( name, auth_user_id )',
      )
      .eq('id', requestId)
      .maybeSingle();

    if (error || !request) {
      return new Response(
        JSON.stringify({ ok: false, error: error?.message ?? 'not_found' }),
        { status: 404, headers: { ...cors, 'Content-Type': 'application/json' } },
      );
    }

    const coachRaw = request.coaches as
      | { name: string; auth_user_id: string | null }
      | { name: string; auth_user_id: string | null }[]
      | null;
    const coach = Array.isArray(coachRaw) ? coachRaw[0] : coachRaw;
    if (!coach?.auth_user_id) {
      return new Response(
        JSON.stringify({ ok: false, error: 'coach_no_auth' }),
        { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } },
      );
    }

    const { data: authUser, error: authErr } =
      await supabase.auth.admin.getUserById(coach.auth_user_id);
    if (authErr || !authUser.user?.email) {
      return new Response(
        JSON.stringify({ ok: false, error: 'coach_no_email' }),
        { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } },
      );
    }

    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [authUser.user.email],
        subject: '[SwingCare] 새 코칭 요청이 도착했어요',
        text: [
          `${coach.name} 코치님, 안녕하세요.`,
          '',
          '새로운 스윙 코칭 요청이 pending 상태입니다.',
          `요청 ID: ${request.id}`,
          `구간: ${request.issue_phase ?? '-'}`,
          `요약: ${request.diagnosis_summary ?? '-'}`,
          '',
          '코치 웹에서 확인해 주세요.',
        ].join('\n'),
      }),
    });

    if (!emailRes.ok) {
      const text = await emailRes.text();
      return new Response(
        JSON.stringify({ ok: false, error: text }),
        { status: 502, headers: { ...cors, 'Content-Type': 'application/json' } },
      );
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      }),
      { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } },
    );
  }
});
