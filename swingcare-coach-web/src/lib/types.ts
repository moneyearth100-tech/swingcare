export type CoachRequestStatus =
  | 'draft'
  | 'pending'
  | 'accepted'
  | 'in_review'
  | 'completed'
  | 'canceled'
  | 'expired';

export type CoachingRequestRow = {
  id: string;
  status: CoachRequestStatus;
  clip_url: string | null;
  clip_start_ms: number;
  clip_end_ms: number;
  issue_phase: string | null;
  diagnosis_pattern_id: string | null;
  diagnosis_summary: string | null;
  price_krw: number | null;
  coach_reply_text: string | null;
  coach_replied_at: string | null;
  created_at: string;
  updated_at: string;
  user_id: string;
};

export const INBOX_STATUSES: CoachRequestStatus[] = [
  'pending',
  'accepted',
  'in_review',
  'completed',
];

export const STATUS_LABEL: Record<string, string> = {
  pending: '대기',
  accepted: '수락',
  in_review: '검토 중',
  completed: '완료',
  canceled: '취소',
  expired: '만료',
  draft: '초안',
};
