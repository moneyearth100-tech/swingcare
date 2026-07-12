from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class Landmark(BaseModel):
    """Matches on-device landmarkTypes.Landmark (field names 1:1)."""

    model_config = ConfigDict(extra="forbid")

    x: float
    y: float
    z: float
    visibility: float


class LandmarkFrame(BaseModel):
    model_config = ConfigDict(extra="forbid")

    timestampMs: int = Field(ge=0)
    landmarks: list[Landmark] = Field(min_length=33, max_length=33)


class ExtractErrorBody(BaseModel):
    code: Literal[
        "NO_POSE",
        "FFMPEG_FAILED",
        "INVALID_VIDEO",
        "MODEL_MISSING",
        "INTERNAL",
    ]
    message: str


class ExtractSuccessResponse(BaseModel):
    ok: Literal[True] = True
    fps: float
    frameCount: int
    durationMs: int
    frames: list[LandmarkFrame]


class ExtractFailureResponse(BaseModel):
    ok: Literal[False] = False
    error: ExtractErrorBody
