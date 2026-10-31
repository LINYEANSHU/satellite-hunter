"""卫星目录与轨道 API。"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.errors import AppError
from app.db import get_db
from app.services.orbit import passes as passes_mod
from app.services.orbit.catalog import GROUP_LABELS, catalog_service
from app.services.orbit.omm import parse_tle_text
from app.services.orbit.propagator import Propagator

router = APIRouter(prefix="/satellites", tags=["satellites"])


# ---------------------------------------------------------------- 分组状态
@router.get("/groups")
def list_groups() -> list[dict]:
    return catalog_service.status()


@router.post("/refresh")
def refresh_group(body: dict) -> dict:
    group = body.get("group", "")
    if not group:
        raise AppError(400, "BAD_REQUEST", "缺少 group")
    data = catalog_service.get_group(group, force=True)
    return data.as_status()


# ---------------------------------------------------------------- 列表与详情
@router.get("")
def list_satellites(
    group: str = Query("stations"),
    q: str = Query("", description="名称/目录号搜索"),
    limit: int = Query(200, le=2000),
    offset: int = Query(0, ge=0),
) -> dict:
    data = catalog_service.get_group(group)
    entries = data.entries
    if q:
        ql = q.strip().lower()
        if ql.isdigit():
            entries = [e for e in entries if str(e.norad_id).startswith(ql)]
        else:
            entries = [e for e in entries if ql in e.name.lower()]
    total = len(entries)
    page = entries[offset : offset + limit]

    return {
        "group": group,
        "label": GROUP_LABELS.get(group, group),
        "stale": data.stale,
        "fetched_at": data.fetched_at,
        "total": total,
        "items": [
            {
                "norad_id": e.norad_id,
                "name": e.name,
                "epoch": e.omm.get("EPOCH"),
                "origin": e.origin,
                "source": e.source,
            }
            for e in page
        ],
    }


@router.get("/{norad_id}")
def satellite_detail(
    norad_id: int,
    group: str = Query("", description="优先在该分组查找"),
) -> dict:
    entry = catalog_service.find(norad_id, group or None)
    if entry is None:
        raise AppError(404, "SATELLITE_NOT_FOUND", f"未找到卫星 {norad_id}（可能未缓存所在分组）")
    omm = entry.omm
    prop = Propagator([entry])
    now = datetime.utcnow()
    pos = prop.positions_ecef(now).get(norad_id)
    return {
        "norad_id": entry.norad_id,
        "name": entry.name,
        "groups": sorted(entry.groups),
        "origin": entry.origin,
        "source": entry.source,
        "omm": {
            k: omm.get(k)
            for k in (
                "NORAD_CAT_ID",
                "OBJECT_NAME",
                "EPOCH",
                "MEAN_MOTION",
                "ECCENTRICITY",
                "INCLINATION",
                "RA_OF_ASC_NODE",
                "ARG_OF_PERICENTER",
                "MEAN_ANOMALY",
                "BSTAR",
                "MEAN_MOTION_DOT",
                "EPHEMERIS_TYPE",
            )
        },
        "position": pos.as_dict() if pos else None,
        "data_age_hours": _epoch_age_hours(omm.get("EPOCH")),
    }


def _epoch_age_hours(epoch_str) -> float | None:
    ep = None
    if epoch_str:
        from app.services.orbit.omm import parse_epoch

        ep = parse_epoch(str(epoch_str))
    if ep is None:
        return None
    return round((datetime.utcnow() - ep).total_seconds() / 3600.0, 1)


# ---------------------------------------------------------------- 轨道跟踪
@router.get("/{norad_id}/track")
def satellite_track(
    norad_id: int,
    minutes: int = Query(180, le=1440, description="前后各推演的分钟数"),
    step_s: int = Query(60, ge=5, le=600),
    at: str = Query("", description="ISO UTC 时刻，默认当前游戏时间"),
) -> dict:
    """返回卫星未来/过去一段时间的轨迹点（含 ECEF 与大地坐标）。

    用于 3D 轨道线与地面投影轨迹。
    """
    entry = catalog_service.find(norad_id)
    if entry is None:
        raise AppError(404, "SATELLITE_NOT_FOUND", f"未找到卫星 {norad_id}")
    center = _parse_at(at)
    prop = Propagator([entry])
    from app.services.orbit import transforms as tf

    n = int(minutes * 60 / step_s)
    times = [center + timedelta(seconds=(i - n) * step_s) for i in range(2 * n + 1)]
    points = []
    for t in times:
        pos = prop.positions_ecef(t).get(norad_id)
        if pos is None or pos.error:
            continue
        points.append(
            {
                "t": t.isoformat() + "Z",
                "ecef_km": [round(float(x), 3) for x in pos.r_ecef],
                "lat": round(pos.lat, 4),
                "lon": round(pos.lon, 4),
                "alt_km": round(pos.alt_km, 2),
            }
        )
    return {"norad_id": norad_id, "step_s": step_s, "points": points}


# ---------------------------------------------------------------- 过境预测
@router.get("/{norad_id}/passes")
def satellite_passes(
    norad_id: int,
    station_id: str = Query(""),
    lat: float = Query(0.0, ge=-90, le=90),
    lon: float = Query(0.0, ge=-180, le=180),
    alt_km: float = Query(0.0, ge=-0.5, le=10),
    hours: float = Query(48.0, gt=0, le=168),
    min_el: float = Query(5.0, ge=-5, le=85),
    db: Session = Depends(get_db),
) -> dict:
    """单星过境预测。优先使用 station_id；否则使用传入坐标。"""
    s_lat, s_lon, s_alt, s_min_el = lat, lon, alt_km, min_el
    if station_id:
        from app.db.models import Station

        st = db.get(Station, station_id)
        if st is None:
            raise AppError(404, "STATION_NOT_FOUND", "地面站不存在")
        s_lat, s_lon, s_alt = st.lat, st.lon, st.alt_m / 1000.0
        s_min_el = st.min_elevation_deg
    entry = catalog_service.find(norad_id)
    if entry is None:
        raise AppError(404, "SATELLITE_NOT_FOUND", f"未找到卫星 {norad_id}")
    prop = Propagator([entry])
    try:
        sat = prop.get_satrec(norad_id)
    except KeyError:
        raise AppError(422, "ORBIT_INIT_FAILED", "该卫星轨道根数无法初始化 SGP4")

    start = datetime.utcnow()
    passes = passes_mod.predict_passes(
        sat, norad_id, s_lat, s_lon, s_alt, start, start + timedelta(hours=hours), s_min_el
    )
    return {
        "norad_id": norad_id,
        "station": {"lat": s_lat, "lon": s_lon, "alt_km": s_alt, "min_elevation_deg": s_min_el},
        "window_hours": hours,
        "passes": [p.as_dict() for p in passes],
    }


@router.post("/import_tle")
def import_tle(body: dict) -> dict:
    """导入 TLE 文本（兼容旧格式）。解析成功后并入 user_imported 分组。"""
    text = body.get("text", "")
    if not text.strip():
        raise AppError(400, "BAD_REQUEST", "缺少 TLE 文本")
    entries = parse_tle_text(text)
    if not entries:
        raise AppError(422, "TLE_PARSE_FAILED", "未能从文本中解析出有效 TLE")
    catalog_service.add_user_entries(entries)
    return {
        "imported": len(entries),
        "items": [
            {"norad_id": e.norad_id, "name": e.name, "epoch": e.omm.get("EPOCH")} for e in entries
        ],
    }


def _parse_at(at: str) -> datetime:
    if not at:
        return datetime.utcnow()
    try:
        dt = datetime.fromisoformat(at.replace("Z", "+00:00"))
        if dt.tzinfo:
            dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
        return dt
    except ValueError:
        raise AppError(400, "BAD_TIME", f"时间格式无效: {at!r}")
