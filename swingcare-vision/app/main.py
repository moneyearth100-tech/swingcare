from __future__ import annotations

import tempfile
from pathlib import Path

from fastapi import FastAPI, File, Form, UploadFile
from fastapi.responses import JSONResponse

from app.config import DEFAULT_EXTRACT_FPS, MODEL_PATH
from app.pipeline.extract import (
    ExtractPipelineError,
    extract_landmarks_from_video,
    failure_response,
)

app = FastAPI(
    title="SwingCare Vision",
    description="ffmpeg + MediaPipe Pose Landmarker → LandmarkFrame[]",
    version="0.1.0",
)


@app.get("/health")
def health() -> dict[str, object]:
    return {
        "ok": True,
        "modelPresent": MODEL_PATH.is_file(),
        "defaultFps": DEFAULT_EXTRACT_FPS,
    }


@app.post("/v1/extract")
async def extract(
    file: UploadFile = File(..., description="스윙 영상 (mp4/mov 등)"),
    fps: float = Form(DEFAULT_EXTRACT_FPS),
) -> JSONResponse:
    if fps <= 0:
        body = failure_response("INVALID_VIDEO", "fps must be > 0")
        return JSONResponse(status_code=400, content=body.model_dump())

    suffix = Path(file.filename or "upload.mp4").suffix or ".mp4"
    try:
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp_path = Path(tmp.name)
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                tmp.write(chunk)
    except Exception as exc:  # noqa: BLE001
        body = failure_response("INTERNAL", f"업로드 저장 실패: {exc}")
        return JSONResponse(status_code=500, content=body.model_dump())

    try:
        result = extract_landmarks_from_video(tmp_path, fps=fps)
        return JSONResponse(content=result.model_dump())
    except ExtractPipelineError as exc:
        status = {
            "INVALID_VIDEO": 400,
            "FFMPEG_FAILED": 422,
            "NO_POSE": 422,
            "MODEL_MISSING": 503,
            "INTERNAL": 500,
        }.get(exc.code, 500)
        body = failure_response(exc.code, exc.message)
        return JSONResponse(status_code=status, content=body.model_dump())
    except Exception as exc:  # noqa: BLE001
        body = failure_response("INTERNAL", str(exc))
        return JSONResponse(status_code=500, content=body.model_dump())
    finally:
        try:
            tmp_path.unlink(missing_ok=True)
        except Exception:  # noqa: BLE001
            pass
