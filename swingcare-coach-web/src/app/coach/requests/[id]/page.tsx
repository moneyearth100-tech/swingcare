import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { ReplyForm } from '@/app/coach/requests/[id]/ReplyForm';
import { CoachShell } from '@/components/CoachShell';
import { createClipSignedUrl, requireCoachSession } from '@/lib/coachAuth';
import { createClient } from '@/lib/supabase/server';
import { STATUS_LABEL, type CoachingRequestRow } from '@/lib/types';

type Params = Promise<{ id: string }>;

export default async function CoachRequestDetailPage({
  params,
}: {
  params: Params;
}) {
  const { id } = await params;
  const supabase = await createClient();
  if (!supabase) {
    redirect('/coach/login');
  }
  const session = await requireCoachSession(supabase);
  if (!session) {
    redirect('/coach/login');
  }

  const { data, error } = await supabase
    .from('coaching_requests')
    .select(
      'id, status, clip_url, clip_start_ms, clip_end_ms, issue_phase, diagnosis_pattern_id, diagnosis_summary, price_krw, coach_reply_text, coach_replied_at, created_at, updated_at, user_id',
    )
    .eq('id', id)
    .eq('coach_id', session.coachId)
    .maybeSingle();

  if (error || !data) {
    notFound();
  }

  const row = data as CoachingRequestRow;
  const signedUrl = await createClipSignedUrl(supabase, row.clip_url);

  return (
    <CoachShell title="요청 상세">
      <p className="back-row">
        <Link href="/coach/requests">← 목록</Link>
      </p>

      <div className="detail-grid">
        <section className="panel">
          <h2>클립</h2>
          {signedUrl ? (
            <video
              className="clip-player"
              src={signedUrl}
              controls
              playsInline
              preload="metadata"
            />
          ) : (
            <p className="error">클립을 불러올 수 없습니다. Storage RLS를 확인하세요.</p>
          )}
          <dl className="meta">
            <div>
              <dt>상태</dt>
              <dd>
                <span className={`badge status-${row.status}`}>
                  {STATUS_LABEL[row.status] ?? row.status}
                </span>
              </dd>
            </div>
            <div>
              <dt>구간</dt>
              <dd>{row.issue_phase ?? '—'}</dd>
            </div>
            <div>
              <dt>패턴</dt>
              <dd>{row.diagnosis_pattern_id ?? '—'}</dd>
            </div>
            <div>
              <dt>클립 범위</dt>
              <dd>
                {row.clip_start_ms}–{row.clip_end_ms} ms
              </dd>
            </div>
            <div>
              <dt>가격</dt>
              <dd>
                {row.price_krw != null
                  ? `${row.price_krw.toLocaleString('ko-KR')}원`
                  : '—'}
              </dd>
            </div>
            <div>
              <dt>요청일</dt>
              <dd>{new Date(row.created_at).toLocaleString('ko-KR')}</dd>
            </div>
          </dl>
        </section>

        <section className="panel">
          <h2>AI 요약</h2>
          <p className="summary-body">
            {row.diagnosis_summary ?? '요약이 없습니다.'}
          </p>

          <h2>회신</h2>
          <ReplyForm
            requestId={row.id}
            currentStatus={row.status}
            initialReply={row.coach_reply_text ?? ''}
          />
          {row.coach_replied_at ? (
            <p className="muted small">
              마지막 회신:{' '}
              {new Date(row.coach_replied_at).toLocaleString('ko-KR')}
            </p>
          ) : null}
        </section>
      </div>
    </CoachShell>
  );
}
