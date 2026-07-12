import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Suspense } from 'react';

import { ReplyForm } from '@/app/coach/requests/[id]/ReplyForm';
import { CoachShell } from '@/components/CoachShell';
import {
  createClipSignedUrl,
  getCoachSession,
  getServerSupabase,
} from '@/lib/coachAuth';
import { STATUS_LABEL, type CoachingRequestRow } from '@/lib/types';

type Params = Promise<{ id: string }>;

async function ClipPanel({
  clipUrl,
}: {
  clipUrl: string | null;
}) {
  const supabase = await getServerSupabase();
  if (!supabase) {
    return (
      <p className="error">클립을 불러올 수 없습니다. 환경 설정을 확인하세요.</p>
    );
  }
  const signedUrl = await createClipSignedUrl(supabase, clipUrl);
  if (!signedUrl) {
    return (
      <p className="error">클립을 불러올 수 없습니다. Storage RLS를 확인하세요.</p>
    );
  }
  return (
    <video
      className="clip-player"
      src={signedUrl}
      controls
      playsInline
      preload="metadata"
    />
  );
}

export default async function CoachRequestDetailPage({
  params,
}: {
  params: Params;
}) {
  const { id } = await params;
  const session = await getCoachSession();
  if (!session) {
    redirect('/coach/login');
  }
  const supabase = await getServerSupabase();
  if (!supabase) {
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

  return (
    <CoachShell title="요청 상세" session={session}>
      <p className="back-row">
        <Link href="/coach/requests" prefetch>
          ← 목록
        </Link>
      </p>

      <div className="detail-grid">
        <section className="panel">
          <h2>클립</h2>
          <Suspense
            fallback={<p className="muted">클립 불러오는 중…</p>}
          >
            <ClipPanel clipUrl={row.clip_url} />
          </Suspense>
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
