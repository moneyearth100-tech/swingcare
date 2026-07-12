# SwingCare API — BullMQ analyze worker

Uploads (`pending`) → enqueue → download Storage → `swingcare-vision` extract →
TS `segmentSwingPhases` / `computeBalanceScore` / `matchDiagnosis` →
`swing_reports` + `status=done` (or `error` after retries).

## Setup

1. Redis (`redis-server` or Docker) on `REDIS_URL` (default `redis://127.0.0.1:6379`)
2. `swingcare-vision` running on port 8090
3. Env (repo root `.env` or `swingcare-api/.env`):

```bash
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...   # Dashboard → Settings → API
REDIS_URL=redis://127.0.0.1:6379
VISION_EXTRACT_URL=http://127.0.0.1:8090/v1/extract
PORT=8091
```

App enqueue (optional, poller also picks `pending`):

```bash
EXPO_PUBLIC_ANALYZE_API_URL=http://<lan-ip>:8091
```

```bash
cd swingcare-api
npm install
npm start
```

## Retry note (vs §5.4)

- **§5.4 / Step 6–7**: client local session sync retry (`swingSessionStore` + foreground).
- **This worker**: BullMQ `attempts` + exponential backoff; after exhaustion → `status=error` + `analysis_error`.
  Same *spirit* (retry then mark error), different layer — not a shared module.

## API

- `GET /health`
- `POST /sessions/:id/analyze` — enqueue job
