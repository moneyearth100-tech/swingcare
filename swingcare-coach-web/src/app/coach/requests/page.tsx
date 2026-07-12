import Link from 'next/link';
import { redirect } from 'next/navigation';

import { CoachShell } from '@/components/CoachShell';
import { requireCoachSession } from '@/lib/coachAuth';
import { createClient } from '@/lib/supabase/server';
import {
  INBOX_STATUSES,
  STATUS_LABEL,
  type CoachRequestStatus,
  type CoachingRequestRow,
} from '@/lib/types';

type SearchParams = Promise<{ status?: string }>;

export default async function CoachRequestsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const filter =
    params.status && INBOX_STATUSES.includes(params.status as CoachRequestStatus)
      ? (params.status as CoachRequestStatus)
      : null;

  const supabase = await createClient();
  if (!supabase) {
    redirect('/coach/login');
  }
  const session = await requireCoachSession(supabase);
  if (!session) {
    redirect('/coach/login');
  }

  let query = supabase
    .from('coaching_requests')
    .select(
      'id, status, clip_url, clip_start_ms, clip_end_ms, issue_phase, diagnosis_pattern_id, diagnosis_summary, price_krw, coach_reply_text, coach_replied_at, created_at, updated_at, user_id',
    )
    .eq('coach_id', session.coachId)
    .neq('status', 'draft')
    .order('created_at', { ascending: false })
    .limit(100);

  if (filter) {
    query = query.eq('status', filter);
  }

  const { data, error } = await query;
  const rows = (data ?? []) as CoachingRequestRow[];

  return (
    <CoachShell title="요청 인박스">
      <div className="filters">
        <FilterChip href="/coach/requests" active={!filter} label="전체" />
        {INBOX_STATUSES.map((s) => (
          <FilterChip
            key={s}
            href={`/coach/requests?status=${s}`}
            active={filter === s}
            label={STATUS_LABEL[s] ?? s}
          />
        ))}
      </div>

      {error ? (
        <p className="error">목록을 불러오지 못했습니다: {error.message}</p>
      ) : null}

      {rows.length === 0 ? (
        <p className="empty">표시할 요청이 없습니다.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>상태</th>
              <th>구간</th>
              <th>요약</th>
              <th>가격</th>
              <th>요청일</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>
                  <span className={`badge status-${row.status}`}>
                    {STATUS_LABEL[row.status] ?? row.status}
                  </span>
                </td>
                <td>{row.issue_phase ?? '—'}</td>
                <td className="summary-cell">
                  <Link href={`/coach/requests/${row.id}`}>
                    {row.diagnosis_summary?.slice(0, 80) || '상세 보기'}
                  </Link>
                </td>
                <td>
                  {row.price_krw != null
                    ? `${row.price_krw.toLocaleString('ko-KR')}원`
                    : '—'}
                </td>
                <td className="muted">
                  {new Date(row.created_at).toLocaleString('ko-KR')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </CoachShell>
  );
}

function FilterChip({
  href,
  active,
  label,
}: {
  href: string;
  active: boolean;
  label: string;
}) {
  return (
    <Link href={href} className={`chip${active ? ' active' : ''}`}>
      {label}
    </Link>
  );
}
