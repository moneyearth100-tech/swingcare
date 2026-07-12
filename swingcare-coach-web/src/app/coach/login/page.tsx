import { redirect } from 'next/navigation';

import { LoginForm } from '@/app/coach/login/LoginForm';
import { MissingEnvNotice } from '@/components/MissingEnvNotice';
import { requireCoachSession } from '@/lib/coachAuth';
import { createClient } from '@/lib/supabase/server';

export default async function CoachLoginPage() {
  const supabase = await createClient();
  if (!supabase) {
    return <MissingEnvNotice />;
  }

  const session = await requireCoachSession(supabase);
  if (session) {
    redirect('/coach/requests');
  }

  return (
    <main className="login-page">
      <div className="login-card">
        <p className="brand">SwingCare</p>
        <h1>코치 로그인</h1>
        <p className="muted">
          배정된 코칭 요청을 확인하고 회신합니다. 아이디만 입력해도 됩니다.
        </p>
        <LoginForm />
      </div>
    </main>
  );
}
