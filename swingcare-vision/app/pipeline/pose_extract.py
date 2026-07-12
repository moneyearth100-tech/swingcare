from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import mediapipe as mp
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision

from app.config import BLAZEPOSE_LANDMARK_COUNT
from app.schemas import Landmark, LandmarkFrame


ZERO_LANDMARK = Landmark(x=0.0, y=0.0, z=0.0, visibility=0.0)


@dataclass(frozen=True)
class PoseExtractStats:
    pose_detected_frames: int
    total_frames: int


class PoseLandmarkerSession:
    """Owns a PoseLandmarker instance for VIDEO mode extraction."""

    def __init__(self, model_path: Path) -> None:
        if not model_path.is_file():
            raise FileNotFoundError(
                f"Pose model missing: {model_path}. "
                "Run scripts/download_model.py first."
            )
        options = vision.PoseLandmarkerOptions(
            base_options=mp_python.BaseOptions(
                model_asset_path=str(model_path)
            ),
            running_mode=vision.RunningMode.VIDEO,
            num_poses=1,
        )
        self._landmarker = vision.PoseLandmarker.create_from_options(options)

    def close(self) -> None:
        self._landmarker.close()

    def __enter__(self) -> PoseLandmarkerSession:
        return self

    def __exit__(self, *args: object) -> None:
        self.close()

    def extract_frames(
        self,
        frame_paths: list[Path],
        *,
        fps: float,
    ) -> tuple[list[LandmarkFrame], PoseExtractStats]:
        frames: list[LandmarkFrame] = []
        detected = 0

        for index, path in enumerate(frame_paths):
            timestamp_ms = int(round(index * (1000.0 / fps)))
            mp_image = mp.Image.create_from_file(str(path))
            result = self._landmarker.detect_for_video(mp_image, timestamp_ms)
            landmarks, had_pose = _to_landmarks(result)
            if had_pose:
                detected += 1
            frames.append(
                LandmarkFrame(timestampMs=timestamp_ms, landmarks=landmarks)
            )

        stats = PoseExtractStats(
            pose_detected_frames=detected,
            total_frames=len(frame_paths),
        )
        return frames, stats


def _visibility_of(lm: object) -> float:
    """visibility 우선, 없으면 presence (온디바이스 normalizeLandmarkEvent와 동일)."""
    visibility = getattr(lm, "visibility", None)
    if visibility is not None:
        return float(visibility)
    presence = getattr(lm, "presence", None)
    if presence is not None:
        return float(presence)
    return 0.0


def _to_landmarks(
    result: vision.PoseLandmarkerResult,
) -> tuple[list[Landmark], bool]:
    if not result.pose_landmarks:
        return [ZERO_LANDMARK] * BLAZEPOSE_LANDMARK_COUNT, False

    pose = result.pose_landmarks[0]
    out: list[Landmark] = []
    for i in range(BLAZEPOSE_LANDMARK_COUNT):
        if i < len(pose):
            lm = pose[i]
            out.append(
                Landmark(
                    x=float(lm.x),
                    y=float(lm.y),
                    z=float(lm.z),
                    visibility=_visibility_of(lm),
                )
            )
        else:
            out.append(ZERO_LANDMARK)
    return out, True
