# SwingCare Vision — C2 landmark extract service

ffmpeg로 상수 fps 프레임을 뽑고, MediaPipe Tasks Pose Landmarker로
`LandmarkFrame[]` JSON을 반환한다. 판정(TS)은 Node 워커가 담당.

계약: [`docs/c2-vision-landmark-contract.md`](../docs/c2-vision-landmark-contract.md)

## Setup

```bash
cd swingcare-vision
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python scripts/download_model.py
```

시스템 `ffmpeg`가 없으면 `imageio-ffmpeg` 번들 바이너리를 사용한다.

## Run

```bash
cd swingcare-vision
source .venv/bin/activate
uvicorn app.main:app --reload --port 8090
```

## API

- `GET /health`
- `POST /v1/extract` — multipart `file` (+ optional form `fps`, default 30)

성공 응답은 계약의 `{ ok, fps, frameCount, durationMs, frames }` 형태다.

## Env

| 변수 | 기본 |
|------|------|
| `SWINGCARE_EXTRACT_FPS` | `30` |
| `SWINGCARE_POSE_MODEL` | `models/pose_landmarker_lite.task` |
