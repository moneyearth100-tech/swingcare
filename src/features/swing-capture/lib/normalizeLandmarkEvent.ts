/** @thinksys/react-native-mediapipe onLandmark 이벤트를 PoseLandmarks로 정규화 */

import type { Landmark, PoseLandmarks } from './landmarkTypes';
import { BLAZEPOSE_LANDMARK_COUNT } from './landmarkTypes';

/** 네이티브 콜백에서 오는 단일 키포인트 (필드 일부 누락 가능) */
interface RawLandmark {
  x?: unknown;
  y?: unknown;
  z?: unknown;
  visibility?: unknown;
  presence?: unknown;
}

interface LandmarkEventPayload {
  landmarks?: unknown;
  worldLandmarks?: unknown;
  additionalData?: unknown;
}

function toFiniteNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

function parsePayload(event: unknown): LandmarkEventPayload | null {
  if (event == null) {
    return null;
  }

  // Android DeviceEventEmitter는 Gson JSON 문자열을 보낼 수 있음
  if (typeof event === 'string') {
    try {
      const parsed: unknown = JSON.parse(event);
      if (parsed && typeof parsed === 'object') {
        return parsed as LandmarkEventPayload;
      }
      return null;
    } catch {
      return null;
    }
  }

  if (typeof event === 'object') {
    return event as LandmarkEventPayload;
  }

  return null;
}

function normalizePoint(raw: RawLandmark): Landmark {
  return {
    x: toFiniteNumber(raw.x, 0),
    y: toFiniteNumber(raw.y, 0),
    z: toFiniteNumber(raw.z, 0),
    visibility: toFiniteNumber(raw.visibility ?? raw.presence, 0),
  };
}

/**
 * MediaPipe 콜백 → 길이 최대 33의 PoseLandmarks.
 * 파싱 실패 또는 landmarks 비어 있으면 null.
 */
export function normalizeLandmarkEvent(event: unknown): PoseLandmarks | null {
  const payload = parsePayload(event);
  if (!payload || !Array.isArray(payload.landmarks)) {
    return null;
  }

  if (payload.landmarks.length === 0) {
    return null;
  }

  const points: Landmark[] = [];
  const limit = Math.min(payload.landmarks.length, BLAZEPOSE_LANDMARK_COUNT);

  for (let i = 0; i < limit; i += 1) {
    const item = payload.landmarks[i];
    if (!item || typeof item !== 'object') {
      points.push({ x: 0, y: 0, z: 0, visibility: 0 });
      continue;
    }
    points.push(normalizePoint(item as RawLandmark));
  }

  return points;
}

/** 평균 visibility (저조도 경고 등에 사용) */
export function averageVisibility(landmarks: PoseLandmarks): number {
  if (landmarks.length === 0) {
    return 0;
  }
  const sum = landmarks.reduce((acc, point) => acc + point.visibility, 0);
  return sum / landmarks.length;
}
