'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { updateRequestAction } from '@/app/coach/actions';

type Props = {
  requestId: string;
  currentStatus: string;
  initialReply: string;
};

export function ReplyForm({ requestId, currentStatus, initialReply }: Props) {
  const router = useRouter();
  const [reply, setReply] = useState(initialReply);
  const [status, setStatus] = useState(
    currentStatus === 'pending' ? 'accepted' : currentStatus,
  );
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMessage(null);
    const fd = new FormData();
    fd.set('requestId', requestId);
    fd.set('reply', reply);
    fd.set('status', status);
    startTransition(async () => {
      const result = await updateRequestAction(fd);
      if (!result.ok) {
        setMessage(result.error);
        return;
      }
      setMessage('저장되었습니다');
      router.refresh();
    });
  }

  return (
    <form className="reply-form" onSubmit={onSubmit}>
      <label className="field">
        <span>상태</span>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="accepted">수락</option>
          <option value="in_review">검토 중</option>
          <option value="completed">완료</option>
          <option value="canceled">취소</option>
        </select>
      </label>
      <label className="field">
        <span>코치 회신</span>
        <textarea
          rows={8}
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          placeholder="회원에게 전달할 코칭 피드백을 작성하세요"
        />
      </label>
      {message ? <p className="form-msg">{message}</p> : null}
      <button type="submit" className="btn primary" disabled={pending}>
        {pending ? '저장 중…' : '저장'}
      </button>
    </form>
  );
}
