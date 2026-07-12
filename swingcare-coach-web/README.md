# SwingCare Coach Web

코치 전용 Next.js 앱. Express API를 거치지 않고 Supabase 클라이언트로 직접 인증·조회합니다.

## 실행

```bash
cp .env.example .env.local
# NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY 설정
npm install
npm run dev
```

기본: http://localhost:3000 → `/coach/login`

## 코치 계정 준비

1. Supabase Auth에서 코치 유저 생성
2. `public.users.role = 'coach'` (service role로 업데이트)
3. `public.coaches.auth_user_id` 에 해당 Auth UID 연결

## 라우트

| 경로 | 설명 |
|------|------|
| `/coach/login` | 이메일/비밀번호 로그인 + role 게이트 |
| `/coach/requests` | 인박스 (pending / accepted / in_review / completed) |
| `/coach/requests/[id]` | 클립 재생(서명 URL) + 회신·상태 변경 |

클립은 Storage RLS상 배정 코치만 `createSignedUrl` 가능합니다. Express 재사용은 필요 없습니다.
