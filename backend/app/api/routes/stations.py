"""地面站 API：选址、管理、批量过境预测。"""
from __future__ import annotations

from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.db import get_db
from app.db.models import Station
from app.services.orbit import passes as passes_mod
from app.services.orbit.catalog import catalog_service
from app.services.orbit.propagator import Propagator

router = APIRouter(prefix="/stations", tags=["stations"])


class StationCreate(BaseModel):
    save_id: str
    name: str = Field(min_length=1, max_length=64)
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    alt_m: float = Field(default=0.0, ge=-450, le=10000)
    min_elevation_deg: float = Field(default=5.0, ge=-5, le=85)
    is_virtual: bool = True


class StationUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=64)
    lat: float | None = Field(default=None, ge=-90, le=90)
    lon: float | None = Field(default=None, ge=-180, le=180)
    alt_m: float | None = Field(default=None, ge=-450, le=10000)
    min_elevation_deg: float | None = Field(default=None, ge=-5, le=85)
    status: str | None = Field(default=None, pattern="^(active|maintenance|offline)$")


@router.get("")
def list_stations(save_id: str, db: Session = Depends(get_db)) -> list[dict]:
    rows = db.query(Station).filter(Station.save_id == save_id).all()
    return [station_dict(s) for s in rows]


@router.post("")
def create_station(body: StationCreate, db: Session = Depends(get_db)) -> dict:
    s = Station(
        save_id=body.save_id,
        name=body.name,
        lat=round(body.lat, 6),
        lon=round(body.lon, 6),
        alt_m=round(body.alt_m, 1),
        min_elevation_deg=body.min_elevation_deg,
        is_virtual=body.is_virtual,
    )
    db.add(s)
    db.commit()
    db.refresh(s)
    return station_dict(s)


@router.patch("/{station_id}")
def update_station(station_id: str, body: StationUpdate, db: Session = Depends(get_db)) -> dict:
    s = db.get(Station, station_id)
    if s is None:
        raise AppError(404, "STATION_NOT_FOUND", "地面站不存在")
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(s, k, v)
    db.commit()
    db.refresh(s)
    return station_dict(s)


@router.delete("/{station_id}")
def delete_station(station_id: str, db: Session = Depends(get_db)) -> dict:
    s = db.get(Station, station_id)
    if s is None:
        raise AppError(404, "STATION_NOT_FOUND", "地面站不存在")
    db.delete(s)
    db.commit()
    return {"deleted": station_id}


@router.get("/{station_id}/passes")
def station_passes(
    station_id: str,
    group: str = Query("stations"),
    hours: float = Query(48.0, gt=0, le=168),
    min_el: float | None = Query(None, ge=-5, le=85),
    limit: int = Query(100, le=500),
    at: str = Query("", description="预测起始时刻（ISO UTC）；默认当前——支持游戏时间"),
    db: Session = Depends(get_db),
) -> dict:
    """地面站视野内一批卫星的未来过境（按 AOS 排序）。

    大分组（如 active，~2 万颗）计算量大，显式限制：单次最多计算 500 颗。
    """
    s = db.get(Station, station_id)
    if s is None:
        raise AppError(404, "STATION_NOT_FOUND", "地面站不存在")

    data = catalog_service.get_group(group)
    entries = data.entries[:500]
    prop = Propagator(entries)

    start = (
        datetime.fromisoformat(at.replace("Z", "+00:00")).replace(tzinfo=None)
        if at
        else datetime.utcnow()
    )
    end = start + timedelta(hours=hours)
    use_min_el = min_el if min_el is not None else s.min_elevation_deg

    all_passes = []
    for nid in prop.ids:
        sat = prop.get_satrec(nid)
        try:
            ps = passes_mod.predict_passes(
                sat, nid, s.lat, s.lon, s.alt_m / 1000.0, start, end, use_min_el, max_passes=20
            )
        except Exception:
            continue
        all_passes.extend(ps)

    all_passes.sort(key=lambda p: p.aos)
    return {
        "station_id": station_id,
        "group": group,
        "satellites_computed": len(prop.ids),
        "window_hours": hours,
        "min_elevation_deg": use_min_el,
        "passes": [p.as_dict() for p in all_passes[:limit]],
    }


def station_dict(s: Station) -> dict:
    return {
        "id": s.id,
        "save_id": s.save_id,
        "name": s.name,
        "lat": s.lat,
        "lon": s.lon,
        "alt_m": s.alt_m,
        "min_elevation_deg": s.min_elevation_deg,
        "status": s.status,
        "is_virtual": s.is_virtual,
        "maintenance": s.maintenance,
        "created_at": s.created_at.isoformat() if s.created_at else None,
    }
