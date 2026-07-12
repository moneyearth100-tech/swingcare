'use client';

import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';

import { createClient } from '@/lib/supabase/client';

/** 아이디만 입력해도 @swingcare.app 을 붙여 Auth 이메일로 로그인 */
function resolveLoginEmail(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return trimmed;
  }
  if (trimmed.includes('@')) {
    return trimmed;
  }
  return `${trimmed}@swingcare.app`;
}

export function LoginForm() {
  const router = useRouter();
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const supabase = createClient();
      const email = resolveLoginEmail(loginId);
      const { error: signError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (signError) {
        setError(signError.message);
        return;
      }

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setError('로그인에 실패했습니다');
        return;
      }

      const [profileRes, coachRes] = await Promise.all([
        supabase.from('users').select('role').eq('id', user.id).maybeSingle(),
        supabase
          .from('coaches')
          .select('id')
          .eq('auth_user_id', user.id)
          .maybeSingle(),
      ]);

      if (profileRes.data?.role !== 'coach') {
        await supabase.auth.signOut();
        setError('코치 계정이 아닙니다. 관리자에게 role 설정을 요청하세요.');
        return;
      }

      if (!coachRes.data) {
        await supabase.auth.signOut();
        setError(
          'coaches.auth_user_id 가 연결되지 않았습니다. 관리자에게 문의하세요.',
        );
        return;
      }

      router.replace('/coach/requests');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : '로그인 오류');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="login-form" onSubmit={onSubmit}>
      <label className="field">
        <span>아이디</span>
        <input
          type="text"
          autoComplete="username"
          required
          placeholder="swingmaster"
          value={loginId}
          onChange={(e) => setLoginId(e.target.value)}
        />
      </label>
      <label className="field">
        <span>비밀번호</span>
        <input
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      {error ? <p className="error">{error}</p> : null}
      <button type="submit" className="btn primary" disabled={busy}>
        {busy ? '확인 중…' : '로그인'}
      </button>
    </form>
  );
}
