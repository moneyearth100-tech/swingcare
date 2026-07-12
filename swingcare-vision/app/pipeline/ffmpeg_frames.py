from __future__ import annotations

import shutil
import subprocess
from pathlib import Path


class FfmpegError(RuntimeError):
    def __init__(self, message: str, *, stderr: str | None = None) -> None:
        super().__init__(message)
        self.stderr = stderr


def resolve_ffmpeg() -> str:
    """Prefer system ffmpeg; fall back to imageio-ffmpeg bundled binary."""
    found = shutil.which("ffmpeg")
    if found:
        return found
    try:
        import imageio_ffmpeg

        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception as exc:  # noqa: BLE001
        raise FfmpegError(
            "ffmpeg를 찾을 수 없습니다. 시스템에 설치하거나 "
            "imageio-ffmpeg를 설치하세요."
        ) from exc


def extract_frames_constant_fps(
    video_path: Path,
    output_dir: Path,
    *,
    fps: float,
) -> list[Path]:
    """
    Extract frames at constant fps.

    timestampMs for index i = round(i * 1000 / fps)
    """
    if fps <= 0:
        raise FfmpegError(f"invalid fps: {fps}")

    output_dir.mkdir(parents=True, exist_ok=True)
    pattern = output_dir / "frame_%06d.jpg"
    ffmpeg = resolve_ffmpeg()

    cmd = [
        ffmpeg,
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        str(video_path),
        "-vf",
        f"fps={fps}",
        "-q:v",
        "2",
        str(pattern),
    ]
    try:
        completed = subprocess.run(
            cmd,
            check=False,
            capture_output=True,
            text=True,
        )
    except OSError as exc:
        raise FfmpegError(f"ffmpeg 실행 실패: {exc}") from exc

    if completed.returncode != 0:
        raise FfmpegError(
            "ffmpeg 프레임 추출 실패",
            stderr=(completed.stderr or completed.stdout or "").strip(),
        )

    frames = sorted(output_dir.glob("frame_*.jpg"))
    if not frames:
        raise FfmpegError(
            "추출된 프레임이 없습니다 (영상 길이/코덱을 확인하세요).",
            stderr=(completed.stderr or "").strip() or None,
        )
    return frames
