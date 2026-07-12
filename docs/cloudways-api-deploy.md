# SwingCare Analyze/Coaching API — Cloudways 배포 가이드

기존 **4GB High Frequency 서버에 Application만 추가**하는 기준 절차다.  
새 서버를 만들지 않고, 사용량이 크지 않은 기존 서버에 API용 Custom App을 올린다.

실행 구성:

- `swingcare-vision`: FastAPI + MediaPipe, 내부 `127.0.0.1:8090`
- `swingcare-api`: Express + BullMQ 분석/코칭 API, 내부 `8091`
- 외부 공개: `https://api.example.com`의 **443만**

> Cloudways는 일반 VPS처럼 root/`apt`/`ufw`를 자유롭게 쓸 수 없다.  
> ffmpeg, `mod_proxy`, 재부팅 후 PM2 자동시작은 **지원팀 요청**이 필요할 수 있다.

---

## 0. 배포 전에 준비할 값

```text
API_DOMAIN=api.example.com
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
GIT_REPOSITORY_URL=<repository-url>
```

주의:

- `SUPABASE_SERVICE_ROLE_KEY`는 서버 전용 비밀값이다. 앱/`eas.json`/Git에 넣지 않는다.
- `EXPO_PUBLIC_ANALYZE_API_URL`은 공개 HTTPS 도메인만 넣는다 (비밀값 아님).
- 저장소에 Docker Compose 배포 구성은 없다. 이 문서는 **PM2** 방식이다.

---

## 1. 기존 서버에 Application 추가

### 1-1. 앱 생성

1. Cloudways에서 기존 **4GB HF 서버** 선택
2. **Add Application**
3. 타입: **Custom App** 또는 **Custom PHP App**
4. 앱 이름 예: `swingcare-api`
5. 생성 완료 후 Applications 목록에 나타나는지 확인

기존 사이트와 **문서 루트/도메인은 분리**되지만, CPU·RAM·Redis는 서버를 공유한다.  
Vision 분석 중 부하가 올라갈 수 있으니 Monitoring을 본다. PM2 cluster는 쓰지 말고 프로세스 각 1개만 띄운다.

### 1-2. SSH 접속

**Server Management → Master Credentials**에서 IP/Username 확인.

```bash
ssh <CLOUDWAYS_USERNAME>@<SERVER_PUBLIC_IP>
```

앱 경로 확인:

```bash
ls ~/applications
```

일반적인 형태:

```text
/home/master/applications/<APPLICATION_ID>/public_html
```

### 1-3. API 도메인 연결

권장 서브도메인:

```text
api.example.com
```

DNS:

```text
Type: A
Name: api
Value: <SERVER_PUBLIC_IP>
TTL: 300 또는 Auto
```

Cloudways:

1. **Applications → swingcare-api → Domain Management**
2. Primary Domain에 `api.example.com` 입력 후 저장

```bash
dig +short api.example.com
```

출력이 서버 IP와 같아야 한다.

### 1-4. SSL

1. **Applications → swingcare-api → SSL Certificate**
2. **Let's Encrypt** 설치
3. Auto Renewal ON
4. HTTPS Redirection ON (가능하면)

DNS가 서버를 가리킨 뒤에 SSL을 설치한다.

---

## 2. 서버 필수 구성 (SSH)

필요한 것: Node.js 22, Python3+venv, Redis, ffmpeg, PM2, Git

```bash
node -v || true
npm -v || true
python3 --version
git --version
ffmpeg -version || true
redis-cli --version || true
```

### 2-1. Node.js 22 (nvm)

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
nvm install 22
nvm alias default 22
node -v
npm -v
```

새 SSH 세션에서 `node`를 못 찾으면:

```bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
```

### 2-2. PM2

```bash
npm install -g pm2
pm2 -v
```

`pm2 startup`은 root가 필요할 수 있다. 우선 `pm2 save`까지 하고, 재부팅 자동시작은 지원팀에 문의한다.

### 2-3. Redis

1. 서버 → **Settings & Packages / Packages** 또는 **Manage Services**
2. Redis 활성화 → Running 확인

```bash
redis-cli -h 127.0.0.1 -p 6379 ping
```

정상: `PONG`  
외부 공개하지 말고 `127.0.0.1:6379`만 사용한다.

### 2-4. Python

```bash
python3 --version
python3 -m venv --help >/dev/null && echo "venv OK"
```

`venv`가 없으면 지원팀에 Python3 / `python3-venv` 가능 여부를 문의한다.

### 2-5. ffmpeg · 프록시 지원 요청

티켓/채팅 예시:

```text
기존 4GB HF 서버에 Custom App으로 Node.js API와 Python FastAPI를 운영하려 합니다.

1) ffmpeg 및 ffprobe 설치/실행 가능 여부 (libx264, aac)
2) 해당 애플리케이션 Apache mod_proxy / mod_rewrite 활성화
3) HTTPS → 127.0.0.1:8091 reverse proxy
4) Authorization 헤더가 upstream으로 전달되는지 확인
5) 외부에서 8090, 8091, 6379 차단 / 80·443만 허용
6) PM2 재부팅 후 자동 복원(startup) 방법 안내
```

설치 후 확인:

```bash
command -v ffmpeg
ffmpeg -hide_banner -version
ffmpeg -hide_banner -encoders 2>/dev/null | grep -E 'libx264|aac' || true
```

---

## 3. 코드 올리기

### 중요: 저장소 상대 경로 유지

`swingcare-api`는 루트의 다음 경로를 import한다.

```text
src/features/swing-capture/lib/scoring/
src/features/swing-capture/lib/phaseSegmentation.ts
```

`swingcare-api`만 복사하면 실행되지 않는다. 저장소 전체를 올린다.

```text
~/swingcare/
├── swingcare-api/
├── swingcare-vision/
├── src/
└── ...
```

### Git clone 권장

```bash
cd "$HOME"
git clone <GIT_REPOSITORY_URL> swingcare
cd "$HOME/swingcare"
git status
```

업데이트:

```bash
cd "$HOME/swingcare"
git pull --ff-only
```

SFTP를 쓸 경우에도 `swingcare-api`, `swingcare-vision`, 루트 `src` 상대 위치를 유지한다.  
올리지 않아도 되는 것: `node_modules/`, `.expo/`, `.venv/`, 실제 `.env`, 로컬 빌드 산출물.

---

## 4. Vision 설치 및 기동

```bash
export DEPLOY_DIR="$HOME/swingcare"
cd "$DEPLOY_DIR/swingcare-vision"
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
pip install -r requirements.txt
python scripts/download_model.py
deactivate
```

모델 확인:

```bash
ls -lh "$DEPLOY_DIR/swingcare-vision/models/pose_landmarker_lite.task"
```

수동 테스트 (외부 노출 금지, localhost만):

```bash
cd "$DEPLOY_DIR/swingcare-vision"
source .venv/bin/activate
uvicorn app.main:app --host 127.0.0.1 --port 8090
```

다른 세션:

```bash
curl -fsS http://127.0.0.1:8090/health
```

예: `{"ok":true,"modelPresent":true,...}`  
확인 후 `Ctrl+C`.

PM2:

```bash
export DEPLOY_DIR="$HOME/swingcare"
pm2 start "$DEPLOY_DIR/swingcare-vision/.venv/bin/uvicorn" \
  --name swingcare-vision \
  --cwd "$DEPLOY_DIR/swingcare-vision" \
  --interpreter none \
  -- app.main:app --host 127.0.0.1 --port 8090

pm2 status
curl -fsS http://127.0.0.1:8090/health
```

선택 env:

```text
SWINGCARE_EXTRACT_FPS=30
SWINGCARE_POSE_MODEL=/absolute/path/to/pose_landmarker_lite.task
```

기본값이면 생략 가능.

---

## 5. API 설치 · 환경변수 · 기동

```bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
export DEPLOY_DIR="$HOME/swingcare"
cd "$DEPLOY_DIR/swingcare-api"
npm ci
```

`.env`:

```bash
cd "$DEPLOY_DIR/swingcare-api"
cp .env.example .env
nano .env
```

예시:

```dotenv
# 필수
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<SUPABASE_SERVICE_ROLE_KEY>

# 권장
REDIS_URL=redis://127.0.0.1:6379
VISION_EXTRACT_URL=http://127.0.0.1:8090/v1/extract
PORT=8091
PENDING_POLL_MS=15000
ANALYZE_JOB_ATTEMPTS=3
VISION_EXTRACT_FPS=30

# ffmpeg가 PATH에 없을 때만
FFMPEG_PATH=/absolute/path/to/ffmpeg

# 코치 이메일 알림 (선택)
RESEND_API_KEY=<RESEND_API_KEY>
COACHING_NOTIFY_FROM=SwingCare <verified-sender@example.com>
```

```bash
chmod 600 "$DEPLOY_DIR/swingcare-api/.env"
```

수동 테스트:

```bash
cd "$DEPLOY_DIR/swingcare-api"
npm start
# 다른 세션
curl -fsS http://127.0.0.1:8091/health
```

PM2:

```bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
export DEPLOY_DIR="$HOME/swingcare"

pm2 start npm \
  --name swingcare-api \
  --cwd "$DEPLOY_DIR/swingcare-api" \
  -- start

pm2 save
pm2 status
curl -fsS http://127.0.0.1:8091/health
```

API는 기본 바인딩상 인터페이스에 열릴 수 있으므로, **8091 외부 차단**을 반드시 확인한다.

재배포:

```bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
export DEPLOY_DIR="$HOME/swingcare"

cd "$DEPLOY_DIR" && git pull --ff-only
cd "$DEPLOY_DIR/swingcare-api" && npm ci
cd "$DEPLOY_DIR/swingcare-vision"
source .venv/bin/activate
pip install -r requirements.txt
python scripts/download_model.py
deactivate

pm2 restart swingcare-vision
pm2 restart swingcare-api --update-env
pm2 save
```

---

## 6. HTTPS → 내부 8091 프록시

지원팀이 `mod_proxy` / `mod_rewrite` 사용 가능하다고 확인한 뒤, 해당 앱 `public_html/.htaccess`:

```apache
DirectoryIndex disabled
RewriteEngine On
RewriteBase /
RewriteRule ^(.*)$ http://127.0.0.1:8091/$1 [P,L,QSA]
```

```bash
nano "$HOME/applications/<APPLICATION_ID>/public_html/.htaccess"
```

확인:

```bash
curl -i https://api.example.com/health
```

`502`이면 API 다운이거나 프록시/모듈 문제다.

필수:

- `Authorization` 헤더 upstream 전달
- `/health`, `/sessions/...`, `/coaching/...` 경로 그대로 전달
- 외부는 443만, 8091 직접 공개 금지

---

## 7. 방화벽 · 노출 범위

```text
외부 허용: 443 (및 필요 시 80)
관리: 22 (가능하면 본인 IP만)
외부 차단: 6379, 8090, 8091
```

흐름:

```text
앱 → HTTPS 443 → Cloudways → 127.0.0.1:8091 API
                              → 127.0.0.1:6379 Redis
                              → 127.0.0.1:8090 Vision
```

외부 PC에서 아래는 실패해야 한다.

```bash
curl --connect-timeout 5 http://api.example.com:8090/health
curl --connect-timeout 5 http://api.example.com:8091/health
```

서버 내부에서는 성공:

```bash
curl -fsS http://127.0.0.1:8090/health
curl -fsS http://127.0.0.1:8091/health
redis-cli -h 127.0.0.1 -p 6379 ping
```

---

## 8. 헬스체크

```bash
pm2 status
pm2 logs swingcare-api --lines 100
pm2 logs swingcare-vision --lines 100

curl -fsS http://127.0.0.1:8090/health; echo
curl -fsS http://127.0.0.1:8091/health; echo
curl -fsS https://api.example.com/health; echo
```

분석 enqueue (테스트 세션 ID):

```bash
curl -i -X POST \
  "https://api.example.com/sessions/<TEST_SESSION_UUID>/analyze" \
  -H "Accept: application/json"
```

코칭 API는 사용자 JWT 필요:

```bash
curl -X POST https://api.example.com/coaching/extract \
  -H "Authorization: Bearer <USER_JWT>" \
  -H "Content-Type: application/json" \
  -d '{"sessionId":"<SESSION_ID>"}'
```

---

## 9. 앱에 URL 넣고 APK 재빌드

앱이 쓰는 경로:

- `POST /sessions/:id/analyze`
- `POST /coaching/extract`
- `POST /coaching/requests/:id/assign`
- `POST /coaching/requests/:id/send`

```text
정상: https://api.example.com
잘못: http://api.example.com:8091
잘못: https://api.example.com/
```

`eas.json` preview `env`에 추가하거나 EAS Environment:

```bash
npx eas-cli@latest env:create \
  --name EXPO_PUBLIC_ANALYZE_API_URL \
  --value https://api.example.com \
  --environment preview \
  --visibility plaintext
```

```bash
npx eas-cli@latest build --platform android --profile preview
```

URL은 빌드 시 번들에 들어가므로, 변경 후 **새 APK 설치**가 필요하다.

---

## 10. 체크리스트

### Cloudways / 네트워크

- [ ] 기존 4GB 서버에 Custom App 추가 완료
- [ ] DNS A 레코드 → 서버 IP
- [ ] Let's Encrypt + HTTPS redirect
- [ ] `mod_proxy` / `mod_rewrite` 활성
- [ ] Authorization upstream 전달
- [ ] 외부에서 6379/8090/8091 불가
- [ ] 재부팅 후 PM2 복원 확인

### Vision / API

- [ ] 저장소 전체(`src` 포함) 구조 유지
- [ ] Node 22, Redis PONG
- [ ] Vision `modelPresent: true`, host `127.0.0.1:8090`
- [ ] API `.env`에 service_role, `PORT=8091`
- [ ] 코칭용 ffmpeg (`libx264`/`aac`) 또는 `FFMPEG_PATH`
- [ ] PM2 인스턴스 Vision 1 + API 1

### 모바일

- [ ] `EXPO_PUBLIC_ANALYZE_API_URL=https://api.example.com`
- [ ] URL 변경 후 APK 재빌드·재설치
- [ ] service_role을 앱/EAS에 넣지 않음

---

## 장애 빠른 진단

### 502 Bad Gateway

```bash
pm2 status
curl -v http://127.0.0.1:8091/health
pm2 logs swingcare-api --lines 200
```

내부 health OK → 프록시 문제. 실패 → API/`.env`/Redis.

### API 즉시 종료

흔한 원인: `SUPABASE_*` 누락, Redis 미실행, 루트 `src` 없음, nvm PATH.

### Vision `MODEL_MISSING`

```bash
cd "$HOME/swingcare/swingcare-vision"
source .venv/bin/activate
python scripts/download_model.py
```

### 코칭 클립만 실패

Node는 Vision 번들 ffmpeg와 별개로 시스템 `ffmpeg`가 필요하다.  
없으면 `.env`에 `FFMPEG_PATH` 넣고 `pm2 restart swingcare-api --update-env`.

### 앱만 네트워크 실패

1. `https://api.../health` 브라우저/ curl
2. EAS preview에 URL 있는지
3. 새 APK 설치했는지
4. URL에 `:8091`/경로 잘못 붙였는지

---

## 운영 주의

- 기존 사이트와 같은 서버면 분석 피크 시 CPU/RAM을 Monitoring으로 본다.
- `/health`는 내부 설정 일부를 노출할 수 있다. 공개 전 검토.
- 영상 원본은 Supabase Storage를 거친다. Redis·Vision은 localhost 전용 유지.
- `POST /sessions/:id/analyze`는 인증이 약할 수 있으니 운영 전 레이트 리밋/인증 강화를 검토한다.
