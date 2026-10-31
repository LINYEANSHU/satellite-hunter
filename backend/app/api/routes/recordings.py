"""录波文件管理（Phase 3 完整实现，Phase 0 先提供接口骨架与能力检查）。"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.db import get_db
from app.db.models import Recording

router = APIRouter(tags=["recordings"])


@router.get("/recordings")
def list_recordings(save_id: str, db: Session = Depends(get_db)) -> list[dict]:
    rows = db.query(Recording).filter(Recording.save_id == save_id).all()
    return [
        {
            "id": r.id,
            "filename": r.filename,
            "size_bytes": r.size_bytes,
            "format": r.format,
            "sample_rate_hz": r.sample_rate_hz,
            "center_frequency_hz": r.center_frequency_hz,
            "satellite_id": r.satellite_id,
            "source": r.source,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }
        for r in rows
    ]


@router.get("/recordings/{recording_id}")
def get_recording(recording_id: str, db: Session = Depends(get_db)) -> dict:
    r = db.get(Recording, recording_id)
    if r is None:
        raise AppError(404, "RECORDING_NOT_FOUND", "录波不存在")
    return {
        "id": r.id,
        "filename": r.filename,
        "path": r.path,
        "size_bytes": r.size_bytes,
        "format": r.format,
        "sample_rate_hz": r.sample_rate_hz,
        "center_frequency_hz": r.center_frequency_hz,
        "satellite_id": r.satellite_id,
        "source": r.source,
        "notes": r.notes,
        "created_at": r.created_at.isoformat() if r.created_at else None,
    }
