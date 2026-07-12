from __future__ import annotations

import os
from pathlib import Path

SERVICE_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MODEL_PATH = SERVICE_ROOT / "models" / "pose_landmarker_lite.task"

# Contract default — keep in sync with docs/c2-vision-landmark-contract.md
DEFAULT_EXTRACT_FPS = float(os.environ.get("SWINGCARE_EXTRACT_FPS", "30"))
BLAZEPOSE_LANDMARK_COUNT = 33

MODEL_PATH = Path(
    os.environ.get("SWINGCARE_POSE_MODEL", str(DEFAULT_MODEL_PATH))
).expanduser()

MODEL_URL = os.environ.get(
    "SWINGCARE_POSE_MODEL_URL",
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/"
    "pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
)
