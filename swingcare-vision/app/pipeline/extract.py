from __future__ import annotations

import tempfile
from pathlib import Path

from app.config import DEFAULT_EXTRACT_FPS, MODEL_PATH
from app.pipeline.ffmpeg_frames import FfmpegError, extract_frames_constant_fps
from app.pipeline.pose_extract import PoseLandmarkerSession
from app.schemas import (
    ExtractErrorBody,
    ExtractFailureResponse,
    ExtractSuccessResponse,
)


class ExtractPipelineError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def extract_landmarks_from_video(
    video_path: Path,
    *,
    fps: float = DEFAULT_EXTRACT_FPS,
) -> ExtractSuccessResponse:
    if not video_path.is_file():
        raise ExtractPipelineError("INVALID_VIDEO", "영상 파일이 없습니다.")

    if not MODEL_PATH.is_file():
        raise ExtractPipelineError(
            "MODEL_MISSING",
            f"MediaPipe 모델이 없습니다: {MODEL_PATH}. "
            "python scripts/download_model.py 를 실행하세요.",
        )

    with tempfile.TemporaryDirectory(prefix="swingcare-frames-") as tmp:
        frame_dir = Path(tmp)
        try:
            frame_paths = extract_frames_constant_fps(
                video_path, frame_dir, fps=fps
            )
        except FfmpegError as exc:
            detail = str(exc)
            if exc.stderr:
                detail = f"{detail}: {exc.stderr}"
            raise ExtractPipelineError("FFMPEG_FAILED", detail) from exc

        try:
            with PoseLandmarkerSession(MODEL_PATH) as session:
                frames, stats = session.extract_frames(frame_paths, fps=fps)
        except Exception as exc:  # noqa: BLE001
            raise ExtractPipelineError(
                "INTERNAL", f"MediaPipe 추출 실패: {exc}"
            ) from exc

        if stats.pose_detected_frames == 0:
            raise ExtractPipelineError(
                "NO_POSE",
                "모든 프레임에서 포즈를 검출하지 못했습니다.",
            )

        n = len(frames)
        duration_ms = int(round((n - 1) * (1000.0 / fps))) if n > 0 else 0
        return ExtractSuccessResponse(
            fps=fps,
            frameCount=n,
            durationMs=duration_ms,
            frames=frames,
        )


def failure_response(code: str, message: str) -> ExtractFailureResponse:
    return ExtractFailureResponse(
        error=ExtractErrorBody(code=code, message=message)  # type: ignore[arg-type]
    )
