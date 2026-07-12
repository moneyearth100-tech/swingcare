export function MissingEnvNotice() {
  return (
    <main className="login-page">
      <div className="login-card">
        <p className="brand">SwingCare</p>
        <h1>환경 변수 필요</h1>
        <p className="muted">
          Vercel Project Settings → Environment Variables 에 아래를 추가한 뒤
          Redeploy 하세요.
        </p>
        <ul className="env-list">
          <li>
            <code>NEXT_PUBLIC_SUPABASE_URL</code>
          </li>
          <li>
            <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code>
          </li>
        </ul>
        <p className="muted small">
          앱 `.env` 의 EXPO_PUBLIC_SUPABASE_* 값과 동일합니다. Production /
          Preview 모두 선택하세요.
        </p>
      </div>
    </main>
  );
}
