# C2 Vision API — LandmarkFrame 계약 스펙

상태: **계약 확정 · 서비스 구현 중** (`swingcare-vision/`)  
대상: `swingcare-vision` (Python FastAPI) → Node BullMQ 워커  
온디바이스 기준 타입: `src/features/swing-capture/lib/landmarkTypes.ts`

이 문서는 Python 추출 결과와 온디바이스 `LandmarkFrame[]`를 **1:1 동일**하게 맞추기 위한 계약이다.  
판정(`phaseSegmentation` / `balanceScore` / `diagnosisTemplates`)은 Node가 기존 TS를 호출하므로, vision API는 **추출만** 담당한다.

---

## 1. 응답 JSON 형태

### 1.1 HTTP 응답 봉투 (권장)

```json
{
  "ok": true,
  "fps": 30,
  "frameCount": 2,
  "durationMs": 33,
  "frames": [ /* LandmarkFrame[] — 아래 스키마 */ ]
}
```

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `ok` | `boolean` | ✅ | 성공 시 `true` |
| `fps` | `number` | ✅ | 프레임 추출·`timestampMs` 계산에 쓴 **상수 fps** |
| `frameCount` | `number` | ✅ | `frames.length`와 동일해야 함 |
| `durationMs` | `number` | ✅ | 마지막 프레임 기준 대략 `timestampMs` 상한. 권장: `round((N-1) * 1000 / fps)` (`N === frameCount`) |
| `frames` | `LandmarkFrame[]` | ✅ | 아래 코어 스키마 |

실패 시 (예):

```json
{
  "ok": false,
  "error": {
    "code": "NO_POSE" | "FFMPEG_FAILED" | "INVALID_VIDEO" | "INTERNAL",
    "message": "human-readable"
  }
}
```

### 1.2 코어: `LandmarkFrame` (온디바이스와 동일)

TypeScript 정의 그대로:

```ts
interface Landmark {
  x: number;          // 이미지 너비 기준 정규화 (목표 구간 ~[0, 1])
  y: number;          // 이미지 높이 기준 정규화 (목표 구간 ~[0, 1])
  z: number;          // 깊이 (힙 중점 기준, x와 대략 같은 스케일)
  visibility: number; // 가시성 확률 [0, 1]
}

interface LandmarkFrame {
  timestampMs: number;     // 영상/세션 시작 기준 상대 ms (정수 권장)
  landmarks: Landmark[];   // 길이 정확히 33
}
```

**서버 계약에서는 온디바이스 Partial 허용을 쓰지 않는다.**  
앱 live 경로는 ThinkSys가 일부만 줄 수 있어 Partial을 허용하지만, **업로드 분석 API는 매 프레임 `landmarks.length === 33`을 강제**한다. 미검출 인덱스는 `{ x:0, y:0, z:0, visibility:0 }`으로 패딩한다 (온디바이스 `normalizeLandmarkEvent`와 동일 패턴).

### 1.3 예시 (2프레임)

```json
{
  "ok": true,
  "fps": 30,
  "frameCount": 2,
  "durationMs": 33,
  "frames": [
    {
      "timestampMs": 0,
      "landmarks": [
        { "x": 0.512, "y": 0.210, "z": -0.031, "visibility": 0.99 },
        { "x": 0.520, "y": 0.195, "z": -0.028, "visibility": 0.98 }
        /* …총 33개, 인덱스 0=nose … 32=right_foot_index */
      ]
    },
    {
      "timestampMs": 33,
      "landmarks": [
        { "x": 0.513, "y": 0.211, "z": -0.030, "visibility": 0.99 }
        /* …33개 */
      ]
    }
  ]
}
```

### 1.4 BlazePose 33 인덱스 (필드 순서 = 배열 인덱스)

온디바이스 `BLAZEPOSE_LANDMARK_NAMES`와 동일. **이름 필드는 JSON에 넣지 않는다** — 배열 순서만 계약한다.

| index | name |
|------:|------|
| 0 | nose |
| 1 | left_eye_inner |
| 2 | left_eye |
| 3 | left_eye_outer |
| 4 | right_eye_inner |
| 5 | right_eye |
| 6 | right_eye_outer |
| 7 | left_ear |
| 8 | right_ear |
| 9 | mouth_left |
| 10 | mouth_right |
| 11 | left_shoulder |
| 12 | right_shoulder |
| 13 | left_elbow |
| 14 | right_elbow |
| 15 | left_wrist |
| 16 | right_wrist |
| 17 | left_pinky |
| 18 | right_pinky |
| 19 | left_index |
| 20 | right_index |
| 21 | left_thumb |
| 22 | right_thumb |
| 23 | left_hip |
| 24 | right_hip |
| 25 | left_knee |
| 26 | right_knee |
| 27 | left_ankle |
| 28 | right_ankle |
| 29 | left_heel |
| 30 | right_heel |
| 31 | left_foot_index |
| 32 | right_foot_index |

### 1.5 JSON Schema (검증용)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://swingcare.local/schemas/vision-extract-response.json",
  "title": "SwingCareVisionExtractResponse",
  "type": "object",
  "required": ["ok", "fps", "frameCount", "durationMs", "frames"],
  "properties": {
    "ok": { "const": true },
    "fps": { "type": "number", "exclusiveMinimum": 0 },
    "frameCount": { "type": "integer", "minimum": 1 },
    "durationMs": { "type": "integer", "minimum": 0 },
    "frames": {
      "type": "array",
      "minItems": 1,
      "items": { "$ref": "#/$defs/LandmarkFrame" }
    }
  },
  "$defs": {
    "Landmark": {
      "type": "object",
      "additionalProperties": false,
      "required": ["x", "y", "z", "visibility"],
      "properties": {
        "x": { "type": "number" },
        "y": { "type": "number" },
        "z": { "type": "number" },
        "visibility": { "type": "number" }
      }
    },
    "LandmarkFrame": {
      "type": "object",
      "additionalProperties": false,
      "required": ["timestampMs", "landmarks"],
      "properties": {
        "timestampMs": { "type": "integer", "minimum": 0 },
        "landmarks": {
          "type": "array",
          "minItems": 33,
          "maxItems": 33,
          "items": { "$ref": "#/$defs/Landmark" }
        }
      }
    }
  }
}
```

### 1.6 금지 / 주의

| 금지 | 이유 |
|------|------|
| `world_landmarks` / `worldLandmarks`를 `landmarks`에 넣기 | 미터 단위 월드 좌표 — 온디바이스·채점은 **이미지 정규화** 좌표만 사용 |
| `x`/`y`를 픽셀로 넣기 | 판정 로직이 정규화 가정 |
| `presence`만 넣고 `visibility` 생략 | 온디바이스 `Landmark`에 `presence` 필드 없음 |
| 프레임마다 landmark 개수 ≠ 33 | 서버 계약 위반 |
| 키 이름을 `X`/`Visibility` 등으로 바꾸기 | 필드명 1:1 (`x`,`y`,`z`,`visibility`) |
| `timestampMs`를 절대 epoch로 넣기 | 세션 시작 상대 ms여야 함 |

온디바이스 매핑 참고 (`normalizeLandmarkEvent.ts`):

```ts
visibility: toFiniteNumber(raw.visibility ?? raw.presence, 0)
```

Python도 동일: **`visibility` 우선, 없으면 `presence`를 `visibility`에 복사**. `presence` 키는 응답 JSON에 **포함하지 않는다**.

### 1.7 실측: `visibility` / `presence` (mediapipe 0.10.35)

측정일: 2026-07-12  
환경: `mediapipe==0.10.35`, Tasks `PoseLandmarker` + `pose_landmarker_lite.task`, `RunningMode.IMAGE`  
입력: Google `pose.jpg`, Unsplash 인물 JPEG (각 1인 검출)

| 항목 | 결과 |
|------|------|
| Python 타입 | `NormalizedLandmark` dataclass |
| 필드 | `x`, `y`, `z`, `visibility`, `presence`, `name` (전부 존재; `name`은 `None`) |
| `visibility` | **채워짐** — 33점 모두 non-None, 0이 아님 |
| `presence` | 마찬가지로 채워짐 |
| 샘플 통계 (girl-pose) | visibility mean≈0.987, min≈0.937 / presence mean≈0.998 |
| 샘플 통계 (person) | visibility mean≈0.934, min≈0.686 / presence mean≈0.999 |

결론 (이 버전 기준):

- `visibility`가 항상 0/None인 문제는 **재현되지 않음**.
- `visibility`와 `presence`는 **둘 다 유효한 float**이며 값이 다를 수 있음 (예: 손목 visibility≈0.86 vs presence≈0.999).
- 계약 JSON에는 **`visibility`만** 넣고, 온디바이스와 같이 `visibility ?? presence` 폴백만 유지한다.
- `jointAngles` / `balanceScore`는 `MIN_LANDMARK_VISIBILITY = 0.35` 미만이면 샘플 제외 → **잘못된 매핑으로 visibility=0이면 각도 샘플이 비어 점수가 왜곡**될 수 있으므로, 구현 시 위 실드를 그대로 복사해야 한다.

버전을 올리면 한 번 더 스모크하는 것을 권장한다 (`scripts` 또는 임시 프로브).

### 1.8 `MIN_LANDMARK_VISIBILITY(0.35)` 여유 & 판정 처리

실측 person 샘플 최저 visibility ≈ **0.686** (손목) → 임계값 0.35 대비 **약 2× 여유**.  
조명/각도 불량으로 0.35 미만이 나와도:

1. `jointAngles.isUsable`이 해당 랜드마크를 **각도 계산에서 제외** (`null` 반환). 좌표를 0으로 바꾸거나 각도를 0°로 넣지 **않음**.
2. `computeBalanceScore`는 프레임별 각도가 `null`이면 그 프레임을 샘플에 넣지 않음. 구간 내 유효 샘플이 없으면 그 phase 점수 스킵.
3. 관절 `sampleCount === 0`이면 해당 관절 점수 0, overall 가중에서도 제외. 전체 샘플이 너무 적으면 (`totalSamples < 8`) `warning`만 설정.

`phaseSegmentation`은 visibility를 보지 않음 (손목 y/속도만).

---

## 2. MediaPipe Python — 좌표 규약 (확인 결과)

기준 API: **MediaPipe Tasks — Pose Landmarker (Python)**  
문서: [Pose landmark detection guide for Python](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/python)

### 2.1 결론

| 출력 | 좌표계 | 이 계약에서의 사용 |
|------|--------|-------------------|
| `pose_landmarks` (`NormalizedLandmark`) | **이미지 정규화** — `x`,`y`는 너비/높이 기준 **[0.0, 1.0] 목표** (오프스크린 추정 시 범위 밖 가능) | ✅ **그대로 사용** (`x`,`y`,`z`,`visibility`) |
| `pose_world_landmarks` | **미터 단위** 월드 좌표 (힙 중점 원점) | ❌ 사용 금지 |

즉, **Tasks Pose Landmarker의 `pose_landmarks`는 기본적으로 픽셀이 아니라 정규화 좌표**이다.  
구현 시 **폭·높이로 한 번 더 나누는 변환은 하지 않는다** (이중 정규화 금지).

### 2.2 구현 체크리스트

1. `result.pose_landmarks[0]` (첫 번째 인물, `num_poses=1`)만 사용.
2. 각 포인트에서 `lm.x`, `lm.y`, `lm.z`, `lm.visibility`를 float로 복사.
3. `visibility`가 없고 `presence`만 있으면 → `visibility = presence`.
4. 길이가 33 미만이면 0-패딩; 33 초과면 앞 33만 사용.
5. 해당 프레임에 포즈가 없으면 → 33개 전부 zero landmark로 넣거나, 정책상 프레임 skip.  
   **권장:** 타임라인 연속성을 위해 **zero 프레임 유지** (인덱스·`timestampMs` 정렬 유지). 전 구간 zero면 `NO_POSE` 에러.

### 2.3 레거시 `mp.solutions.pose`를 쓸 경우

구 Solutions API의 `pose_landmarks.landmark[i].x/y`도 문서상 **정규화 [0,1]** 이다. 역시 픽셀 변환 없이 동일 필드로 매핑하면 된다.  
**신규 구현은 Tasks Pose Landmarker를 권장**한다.

### 2.4 “정규화가 아니면?” (방어 조항)

만약 선택한 파이프라인/래퍼가 **픽셀**을 준다면 (예: OpenCV 그리기용으로 이미 `x * width` 한 값):

```text
x_norm = x_px / image_width
y_norm = y_px / image_height
```

계약 JSON에는 **정규화 값만** 넣는다.  
픽셀인지 여부는 샘플 로그로 확인: 사람 전신이 프레임 안이면 `x`,`y`가 대략 0~1이어야 한다. 수백~수천이면 픽셀 → 위 변환 필요.

---

## 3. `timestampMs` 계산 (ffmpeg + 상수 fps)

온디바이스 녹화는 `Date.now() - startedAtMs`로 상대 ms를 붙인다.  
서버는 **추출 fps를 고정**하고 프레임 인덱스로 동일 스케일을 만든다.  
레포 샘플(`phaseSegmentation.sampleCheck.ts`)과 동일:

```ts
timestampMs = Math.round(i * (1000 / fps))
```

### 3.1 권장 파이프라인

1. **상수 fps로 프레임 추출** (가변 PTS 무시하고 균일 타임라인):

```bash
ffmpeg -y -i input.mp4 -vf "fps=30" -vsync vfr frame_%06d.jpg
# 또는 raw/pipe; fps=30 이 EXTRACT_FPS
```

2. 추출된 프레임을 **파일명 순서 = 인덱스 `i = 0 .. N-1`** 로 MediaPipe에 투입.
3. 각 프레임:

```python
EXTRACT_FPS = 30.0  # 응답의 fps 와 동일해야 함
timestamp_ms = int(round(i * (1000.0 / EXTRACT_FPS)))
```

4. 응답 메타:

```python
fps = EXTRACT_FPS
frame_count = N
duration_ms = int(round((N - 1) * (1000.0 / EXTRACT_FPS))) if N > 0 else 0
```

### 3.2 규칙

| 규칙 | 내용 |
|------|------|
| `frames[i].timestampMs` | `round(i * 1000 / fps)` (정수) |
| 단조 증가 | `i < j` ⇒ `timestampMs[i] <= timestampMs[j]` |
| `fps` 일치 | JSON `fps` ≡ ffmpeg `-vf fps=` ≡ timestamp 분모 |
| 원본 영상 fps | 원본이 60이어도 **추출 fps(예: 30)** 기준으로 타임스탬프를 잡는다 (온디바이스 목표 fps와 맞출 것) |
| MediaPipe VIDEO 모드 | `detect_for_video(image, timestamp_ms)`에 **같은 `timestamp_ms`** 를 넘긴다 |

### 3.3 대안 (비권장 — 계약 이탈 위험)

원본 PTS/`ffprobe` 패킷 시간을 쓰면 VFR·B-frame에서 간격이 불균일해지고, 온디바이스 균일 샘플링과 어긋날 수 있다.  
C2 MVP는 **상수 fps 추출 + 인덱스 기반 `timestampMs`** 만 사용한다.

### 3.4 수치 예 (fps = 30)

| i | timestampMs |
|--:|------------:|
| 0 | 0 |
| 1 | 33 |
| 2 | 67 |
| 29 | 967 |
| 30 | 1000 |

---

## 4. Node 워커와의 경계

```
Python POST/응답.frames  →  LandmarkFrame[]
Node: segmentSwingPhases(frames)
Node: computeBalanceScore(frames, phases)
Node: matchDiagnosis(score, phases)
Node: swing_reports upsert + swing_sessions.status = 'done'
```

워커는 응답의 `frames`만 판정 입력으로 쓴다. `fps`/`durationMs`는 세션 메타·디버그에 사용 가능.

패키지 분리(`packages/swing-analysis`)는 이번 스코프에서 **스킵** — 워커는 앱 레포의 `src/features/swing-capture/lib/...`를 상대경로/`tsx`로 import한다.

---

## 5. 승인 체크리스트

- [ ] 응답 `frames[]`가 `timestampMs` + `landmarks[33]` + `x/y/z/visibility`만 사용하는가
- [ ] MediaPipe **`pose_landmarks`(정규화)** 를 쓰고 world/픽셀을 넣지 않는가
- [ ] `timestampMs = round(i * 1000 / fps)` 이고 `fps`가 ffmpeg 추출과 같은가
- [ ] 포즈 미검출 프레임도 33 zero로 길이를 유지하는가 (또는 전원 실패 시 `NO_POSE`)

승인 후: `swingcare-vision` FastAPI 스캐폴딩 + ffmpeg/MediaPipe 추출 구현 착수.
