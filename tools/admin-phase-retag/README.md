# Admin Phase Retag Tool

관리자용 스윙 구간 재태깅(라벨링) 도구입니다.

- `swing_sessions.phases` (AI 원본)은 유지
- 수정본은 `phases_verified` / `phases_verified_at` / `phases_verified_by` 에 저장
- 앱·리뷰는 `phases_verified ?? phases` 사용

## 사전 조건

1. `009_phases_verified_and_labeling_consent.sql` 대시보드 적용
2. 환경 변수 (프로젝트 루트 `.env` 또는 export)

```bash
export SUPABASE_URL="https://xxxx.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="eyJ..."   # service_role (절대 클라이언트에 넣지 말 것)
export ADMIN_RETAG_TOKEN="choose-a-secret" # 선택. 있으면 Authorization: Bearer 필요
```

## 실행

```bash
# 프로젝트 루트에서
export SUPABASE_URL="..."
export SUPABASE_SERVICE_ROLE_KEY="..."
node tools/admin-phase-retag/server.mjs
# http://127.0.0.1:8787
```

브라우저에서 세션 목록 → 구간 ms 수정 → 「정답 저장」.
