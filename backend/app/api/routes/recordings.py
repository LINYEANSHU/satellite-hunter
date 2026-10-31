"""录波文件管理与信号分析 API（Phase 3）。

上传限制：单文件 ≤ 512 MB，仅保存到服务端录波目录。
DSP 接口全部分块按需计算（需求 12.2）。
"""
from __future__ import annotations

import re
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.errors import AppError
from app.db import get_db
from app.db.models import CollectionEntry, CollectionItem, Recording, SatdumpJob
from app.services.dsp import (
    IQ_FORMATS,
    compute_spectrum,
    compute_waterfall,
    freq_offset_estimate,
    iq_meta,
    iq_stats,
    read_iq_block,
)
from app.services.satdump import adapter as satdump

router = APIRouter(tags=["recordings", "satdump"])

MAX_UPLOAD_BYTES = 512 * 1024 * 1024
_SAFE_NAME = re.compile(r"[^\w.\- ]")


def _rec_path(rec: Recording) -> Path:
    return Path(rec.path)


def _recording_view(r: Recording) -> dict:
    return {
        "id": r.id,
        "save_id": r.save_id,
        "filename": r.filename,
        "size_bytes": r.size_bytes,
        "format": r.format,
        "sample_rate_hz": r.sample_rate_hz,
        "center_frequency_hz": r.center_frequency_hz,
        "satellite_id": r.satellite_id,
        "source": r.source,
        "notes": r.notes,
        "created_at": r.created_at.isoformat() if r.created_at else None,
    }


# ---------------------------------------------------------------- 导入与管理
@router.post("/recordings/import")
async def import_recording(
    save_id: str = Form(...),
    file: UploadFile = File(...),
    format: str = Form("cf32"),
    sample_rate_hz: float = Form(0),
    center_frequency_hz: float = Form(0),
    satellite_id: int | None = Form(None),
    notes: str = Form(""),
    db: Session = Depends(get_db),
) -> dict:
    if format not in IQ_FORMATS:
        raise AppError(400, "BAD_FORMAT", f"不支持的 IQ 格式: {format}（支持: {', '.join(IQ_FORMATS)}）")
    name = _SAFE_NAME.sub("_", file.filename or "recording.iq")[:200] or "recording.iq"

    dest = settings.recordings_dir / f"{save_id[:8]}_{name}"
    size = 0
    with open(dest, "wb") as f:
        while chunk := await file.read(1024 * 1024):
            size += len(chunk)
            if size > MAX_UPLOAD_BYTES:
                f.close()
                dest.unlink(missing_ok=True)
                raise AppError(413, "TOO_LARGE", "录波超过 512 MB 上限")
            f.write(chunk)
    if size == 0:
        dest.unlink(missing_ok=True)
        raise AppError(400, "EMPTY_FILE", "空文件")

    rec = Recording(
        save_id=save_id,
        filename=name,
        path=str(dest),
        size_bytes=size,
        format=format,
        sample_rate_hz=sample_rate_hz,
        center_frequency_hz=center_frequency_hz,
        satellite_id=satellite_id,
        source="RECORDED_IQ",
        notes=notes,
    )
    db.add(rec)
    db.commit()
    return _recording_view(rec)


@router.get("/recordings")
def list_recordings(save_id: str, db: Session = Depends(get_db)) -> list[dict]:
    rows = db.query(Recording).filter(Recording.save_id == save_id).all()
    return [_recording_view(r) for r in rows]


@router.get("/recordings/{recording_id}")
def get_recording(recording_id: str, db: Session = Depends(get_db)) -> dict:
    r = db.get(Recording, recording_id)
    if r is None:
        raise AppError(404, "RECORDING_NOT_FOUND", "录波不存在")
    view = _recording_view(r)
    try:
        meta = iq_meta(r.path, r.format)
        view["samples"] = meta.samples
        view["duration_s"] = (meta.samples / r.sample_rate_hz) if r.sample_rate_hz else None
    except (OSError, ValueError) as ex:
        view["error"] = str(ex)
    return view


@router.delete("/recordings/{recording_id}")
def delete_recording(recording_id: str, db: Session = Depends(get_db)) -> dict:
    r = db.get(Recording, recording_id)
    if r is None:
        raise AppError(404, "RECORDING_NOT_FOUND", "录波不存在")
    Path(r.path).unlink(missing_ok=True)
    db.delete(r)
    db.commit()
    return {"deleted": recording_id}


def _get_rec(db: Session, recording_id: str) -> Recording:
    r = db.get(Recording, recording_id)
    if r is None:
        raise AppError(404, "RECORDING_NOT_FOUND", "录波不存在")
    return r


# ---------------------------------------------------------------- DSP 分析
@router.get("/recordings/{recording_id}/stats")
def recording_stats(recording_id: str, offset: int = 0, n: int = 65536, db: Session = Depends(get_db)) -> dict:
    r = _get_rec(db, recording_id)
    iq = read_iq_block(r.path, r.format, max(0, offset), max(1, min(n, 1_000_000)))
    s = iq_stats(iq)
    if r.sample_rate_hz:
        s["freq_offset_hz"] = freq_offset_estimate(iq, r.sample_rate_hz)
    return s


@router.get("/recordings/{recording_id}/spectrum")
def recording_spectrum(
    recording_id: str,
    offset: int = 0,
    n: int = 65536,
    fft: int = 1024,
    avg: int = 8,
    db: Session = Depends(get_db),
) -> dict:
    r = _get_rec(db, recording_id)
    fft = max(64, min(4096, fft))
    iq = read_iq_block(r.path, r.format, max(0, offset), max(fft, min(n, 1_000_000)))
    spec = compute_spectrum(iq, fft, max(1, min(64, avg)))
    return {
        "fft_size": fft,
        "offset": offset,
        "db": [round(float(x), 2) for x in spec],
        "freq_span_hz": r.sample_rate_hz if r.sample_rate_hz else None,
        "center_frequency_hz": r.center_frequency_hz,
    }


@router.get("/recordings/{recording_id}/waterfall")
def recording_waterfall(
    recording_id: str,
    rows: int = 128,
    fft: int = 256,
    t0: float = 0.0,
    t1: float = 1.0,
    db: Session = Depends(get_db),
) -> dict:
    r = _get_rec(db, recording_id)
    rows = max(16, min(512, rows))
    fft = max(64, min(1024, fft))
    mat, meta = compute_waterfall(r.path, r.format, fft, rows, t0, t1)
    lo, hi = float(mat.min()), float(mat.max())
    return {
        "rows": rows,
        "fft_size": fft,
        "db_min": round(lo, 1),
        "db_max": round(hi, 1),
        "db": [[round(float(x), 1) for x in row] for row in mat],
        **meta,
        "freq_span_hz": r.sample_rate_hz if r.sample_rate_hz else None,
    }


@router.get("/recordings/{recording_id}/constellation")
def recording_constellation(
    recording_id: str,
    offset: int = 0,
    n: int = 2000,
    db: Session = Depends(get_db),
) -> dict:
    r = _get_rec(db, recording_id)
    n = max(16, min(20000, n))
    iq = read_iq_block(r.path, r.format, max(0, offset), n)
    # 抽取到 ≤2000 点
    step = max(1, len(iq) // 2000)
    pts = iq[::step]
    return {
        "offset": offset,
        "points": [[round(float(p.real), 4), round(float(p.imag), 4)] for p in pts[:2000]],
    }


@router.get("/recordings/{recording_id}/waveform")
def recording_waveform(
    recording_id: str,
    offset: int = 0,
    n: int = 2000,
    db: Session = Depends(get_db),
) -> dict:
    r = _get_rec(db, recording_id)
    n = max(16, min(20000, n))
    iq = read_iq_block(r.path, r.format, max(0, offset), n)
    step = max(1, len(iq) // 2000)
    pts = iq[::step]
    return {
        "offset": offset,
        "i": [round(float(p.real), 4) for p in pts[:2000]],
        "q": [round(float(p.imag), 4) for p in pts[:2000]],
    }


# ---------------------------------------------------------------- SatDump
@router.get("/satdump/status")
def satdump_status(db: Session = Depends(get_db)) -> dict:
    from app.api.routes.system import detect_satdump

    base = detect_satdump()
    known = _pipelines_cache.get("list", [])
    base["pipelines_count"] = len(known)
    base["pipelines_note"] = _pipelines_cache.get("note", "")
    return base


_pipelines_cache: dict = {"list": [], "note": "", "ts": 0.0}


@router.post("/satdump/pipelines")
def satdump_pipelines() -> dict:
    pipes, note = satdump.list_pipelines()
    _pipelines_cache["list"] = pipes
    _pipelines_cache["note"] = note
    _pipelines_cache["ts"] = __import__("time").time()
    return {
        "pipelines": [{"name": p.name, "desc": p.desc} for p in pipes],
        "note": note,
    }


class SatdumpJobCreate(BaseModel):
    save_id: str
    recording_id: str
    pipeline: str
    samplerate: float | None = None
    frequency: float | None = None
    baseband_format: str | None = None
    sat_name: str | None = None


@router.post("/satdump/jobs")
def create_satdump_job(body: SatdumpJobCreate, db: Session = Depends(get_db)) -> dict:
    rec = _get_rec(db, body.recording_id)
    known = _pipelines_cache.get("list", [])
    if not known:
        pipes, _ = satdump.list_pipelines()
        known = pipes
        _pipelines_cache["list"] = pipes

    job = SatdumpJob(
        save_id=body.save_id,
        recording_id=rec.id,
        pipeline=body.pipeline,
        params={
            "samplerate": body.samplerate or rec.sample_rate_hz,
            "frequency": body.frequency or rec.center_frequency_hz,
            "baseband_format": body.baseband_format or rec.format,
            "sat_name": body.sat_name or rec.filename,
        },
        status="pending",
    )
    db.add(job)
    db.commit()

    try:
        satdump.start_job(
            job.id, rec.path, body.pipeline, job.params, [p.name for p in known]
        )
    except Exception as ex:
        job.status = "failed"
        job.error = str(ex)
        db.commit()
        raise AppError(422, "SATDUMP_JOB_FAILED", str(ex))
    return _job_view(job)


def _job_view(j: SatdumpJob) -> dict:
    return {
        "id": j.id,
        "recording_id": j.recording_id,
        "pipeline": j.pipeline,
        "params": j.params,
        "status": j.status,
        "progress": j.progress,
        "error": j.error,
        "result_files": j.result_files,
        "log_path": j.log_path,
        "output_dir": j.output_dir,
        "created_at": j.created_at.isoformat() if j.created_at else None,
    }


@router.get("/satdump/jobs")
def list_satdump_jobs(save_id: str, db: Session = Depends(get_db)) -> list[dict]:
    rows = (
        db.query(SatdumpJob)
        .filter(SatdumpJob.save_id == save_id)
        .order_by(SatdumpJob.created_at.desc())
        .limit(50)
        .all()
    )
    return [_job_view(j) for j in rows]


@router.get("/satdump/jobs/{job_id}")
def get_satdump_job(job_id: str, db: Session = Depends(get_db)) -> dict:
    j = db.get(SatdumpJob, job_id)
    if j is None:
        raise AppError(404, "JOB_NOT_FOUND", "解码任务不存在")
    return _job_view(j)


@router.get("/satdump/jobs/{job_id}/log")
def get_satdump_job_log(job_id: str, tail: int = 8000, db: Session = Depends(get_db)) -> dict:
    j = db.get(SatdumpJob, job_id)
    if j is None:
        raise AppError(404, "JOB_NOT_FOUND", "解码任务不存在")
    text = ""
    if j.log_path and Path(j.log_path).exists():
        with open(j.log_path, "r", encoding="utf-8", errors="replace") as f:
            text = f.read()[-tail:]
    return {"log": text}


@router.post("/satdump/jobs/{job_id}/cancel")
def cancel_satdump_job(job_id: str, db: Session = Depends(get_db)) -> dict:
    j = db.get(SatdumpJob, job_id)
    if j is None:
        raise AppError(404, "JOB_NOT_FOUND", "解码任务不存在")
    ok = satdump.cancel_job(job_id)
    if not ok and j.status in ("pending", "running"):
        j.status = "cancelled"
        db.commit()
    return {"cancelled": True, "was_running": ok}


class CollectCreate(BaseModel):
    save_id: str
    title: str
    notes: str = ""
    satellite_id: int | None = None


@router.post("/satdump/jobs/{job_id}/collect")
def collect_job_output(job_id: str, body: CollectCreate, db: Session = Depends(get_db)) -> dict:
    """把完成的解码输出收藏到图鉴（来源 DECODED_OUTPUT，需求 7.2）。"""
    j = db.get(SatdumpJob, job_id)
    if j is None:
        raise AppError(404, "JOB_NOT_FOUND", "解码任务不存在")
    if j.status != "done":
        raise AppError(409, "JOB_NOT_DONE", "任务尚未成功完成")
    item = CollectionItem(
        save_id=body.save_id,
        satellite_id=body.satellite_id,
        kind="decoded_image",
        source="DECODED_OUTPUT",
        title=body.title,
        file_path=j.output_dir,
        data={"job_id": job_id, "pipeline": j.pipeline, "files": j.result_files},
        notes=body.notes,
    )
    db.add(item)
    if body.satellite_id:
        ce = (
            db.query(CollectionEntry)
            .filter(
                CollectionEntry.save_id == body.save_id,
                CollectionEntry.satellite_id == body.satellite_id,
            )
            .one_or_none()
        )
        if ce:
            ce.status = "decoded"
    db.commit()
    return {"id": item.id, "kind": item.kind, "source": item.source}
