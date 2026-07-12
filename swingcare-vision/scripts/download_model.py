#!/usr/bin/env python3
"""Download MediaPipe Pose Landmarker lite model into models/."""

from __future__ import annotations

import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.config import MODEL_PATH, MODEL_URL  # noqa: E402


def main() -> None:
    MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    if MODEL_PATH.is_file() and MODEL_PATH.stat().st_size > 1_000_000:
        print(f"already present: {MODEL_PATH}")
        return
    print(f"downloading {MODEL_URL}")
    print(f" → {MODEL_PATH}")
    urllib.request.urlretrieve(MODEL_URL, MODEL_PATH)
    print(f"done ({MODEL_PATH.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
