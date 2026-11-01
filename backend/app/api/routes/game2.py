"""Phase 2 游戏 API：设备、任务、图鉴、成就、存档。"""
from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.db import get_db
from app.db.models import CollectionEntry, CollectionItem, Equipment, Mission, PlayerState, Save, Station
from app.services.game import achievements as ach_service
from app.services.game import equipment as eq_service
from app.services.game import missions as mission_service

router = APIRouter(tags=["game"])


# ================================================================ 存档
class SaveCreate(BaseModel):
    name: str = Field(min_length=1, max_length=64)


@router.get("/saves")
def list_saves(db: Session = Depends(get_db)) -> list[dict]:
    rows = db.query(Save).order_by(Save.last_played_at.desc()).all()
    out = []
    for s in rows:
        p = db.get(PlayerState, s.id)
        out.append(
            {
                "id": s.id,
                "name": s.name,
                "last_played_at": s.last_played_at.isoformat() if s.last_played_at else None,
                "credits": p.credits if p else 0,
                "research_points": p.research_points if p else 0,
                "level": p.level if p else 1,
                "total_missions_done": p.total_missions_done if p else 0,
                "satellites_discovered": p.satellites_discovered if p else 0,
            }
        )
    return out


@router.post("/saves")
def create_save(body: SaveCreate, db: Session = Depends(get_db)) -> dict:
    exists = db.query(Save).filter(Save.name == body.name).one_or_none()
    if exists:
        raise AppError(409, "SAVE_EXISTS", "同名存档已存在")
    s = Save(name=body.name)
    db.add(s)
    db.flush()
    db.add(PlayerState(save_id=s.id))
    db.commit()
    return {"id": s.id, "name": s.name}


@router.delete("/saves/{save_id}")
def delete_save(save_id: str, db: Session = Depends(get_db)) -> dict:
    s = db.get(Save, save_id)
    if s is None:
        raise AppError(404, "SAVE_NOT_FOUND", "存档不存在")
    db.delete(s)
    db.commit()
    return {"deleted": save_id}


@router.get("/game/state")
def game_state(save_id: str, db: Session = Depends(get_db)) -> dict:
    """完整会话状态（进入存档时加载）。"""
    s = db.get(Save, save_id)
    if s is None:
        raise AppError(404, "SAVE_NOT_FOUND", "存档不存在")
    s.last_played_at = datetime.utcnow()
    db.commit()
    p = db.get(PlayerState, save_id)
    stations = db.query(Station).filter(Station.save_id == save_id).all()
    return {
        "save": {"id": s.id, "name": s.name, "created_at": s.created_at.isoformat()},
        "player": {
            "credits": p.credits,
            "research_points": p.research_points,
            "xp": p.xp,
            "level": p.level,
            "total_missions_done": p.total_missions_done,
            "satellites_discovered": p.satellites_discovered,
        },
        "stations_count": len(stations),
    }


@router.get("/game/stats")
def game_stats(save_id: str, db: Session = Depends(get_db)) -> dict:
    """运营统计仪表盘（全部来自真实任务记录）。"""
    from app.services.game.stats import operator_stats

    return operator_stats(db, save_id)


# ================================================================ 新手任务链
@router.post("/game/tutorial/seed")
def tutorial_seed(body: dict, db: Session = Depends(get_db)) -> dict:
    """为新存档生成 3 步新手任务链（观测→追踪→捕获，目标优先 ISS）。

    幂等：已有新手任务时不重复生成。单步生成失败自动跳过
    （如当前无可见过境，玩家可稍后重试或自行规划）。
    """
    save_id = body.get("save_id", "")
    if not save_id:
        raise AppError(400, "BAD_REQUEST", "缺少 save_id")
    station = (
        db.query(Station)
        .filter(Station.save_id == save_id)
        .order_by(Station.created_at.asc())
        .first()
    )
    if station is None:
        raise AppError(409, "NO_STATION", "请先建立地面站")
    existing = (
        db.query(Mission)
        .filter(Mission.save_id == save_id, Mission.type == "tutorial")
        .count()
    )
    if existing >= 3:
        return {"created": 0, "note": "新手任务已存在"}

    created = []
    for sat_id in (25544, 48274, 25338):  # ISS → 天宫 → NOAA-15
        try:
            m = mission_service.create_mission(
                db, save_id, station.id, sat_id, "tutorial", priority=1
            )
            created.append(m.satellite_name or m.satellite_id)
            if len(created) >= 3 - existing:
                break
        except Exception:
            continue
    db.commit()
    return {"created": len(created), "targets": created}


# ================================================================ 设备
@router.get("/equipment/catalog")
def equipment_catalog() -> dict:
    return eq_service.catalog_view()


@router.get("/equipment")
def list_equipment(save_id: str, db: Session = Depends(get_db)) -> list[dict]:
    rows = db.query(Equipment).filter(Equipment.save_id == save_id).all()
    return [eq_service.equipment_view(e) for e in rows]


class EquipmentBuy(BaseModel):
    save_id: str
    catalog_id: str


@router.post("/equipment/buy")
def buy(body: EquipmentBuy, db: Session = Depends(get_db)) -> dict:
    eq = eq_service.buy_equipment(db, body.save_id, body.catalog_id)
    db.commit()
    return eq_service.equipment_view(eq)


class EquipmentInstall(BaseModel):
    save_id: str
    station_id: str


@router.post("/equipment/{equipment_id}/install")
def install(equipment_id: str, body: EquipmentInstall, db: Session = Depends(get_db)) -> dict:
    eq = eq_service.install_equipment(db, body.save_id, equipment_id, body.station_id)
    unlocked = ach_service.check_and_unlock(db, body.save_id)
    db.commit()
    view = eq_service.equipment_view(eq)
    view["achievements_unlocked"] = unlocked
    return view


@router.post("/equipment/{equipment_id}/unequip")
def unequip(equipment_id: str, body: EquipmentInstall, db: Session = Depends(get_db)) -> dict:
    eq = eq_service.unequip_equipment(db, body.save_id, equipment_id)
    db.commit()
    return eq_service.equipment_view(eq)


@router.delete("/equipment/{equipment_id}")
def sell(equipment_id: str, save_id: str, db: Session = Depends(get_db)) -> dict:
    refund = eq_service.sell_equipment(db, save_id, equipment_id)
    db.commit()
    return {"refund": refund}


# ================================================================ 任务
class MissionCreate(BaseModel):
    save_id: str
    station_id: str
    satellite_id: int
    type: str = "capture"
    priority: int = Field(default=5, ge=1, le=9)
    at: str | None = None  # ISO UTC；指定时刻创建
    auto: bool = False


@router.get("/missions")
def list_missions(
    save_id: str,
    status: str = Query("", description="空=全部；planned/active/completed/failed/cancelled"),
    db: Session = Depends(get_db),
) -> list[dict]:
    q = db.query(Mission).filter(Mission.save_id == save_id)
    if status:
        q = q.filter(Mission.status == status)
    rows = q.order_by(Mission.aos.desc().nullslast()).limit(200).all()
    return [mission_service._mission_view(m) for m in rows]


@router.post("/missions")
def create_mission(body: MissionCreate, db: Session = Depends(get_db)) -> dict:
    at = None
    if body.at:
        at = datetime.fromisoformat(body.at.replace("Z", "+00:00")).replace(tzinfo=None)
    m = mission_service.create_mission(
        db, body.save_id, body.station_id, body.satellite_id, body.type, body.priority, at, body.auto
    )
    db.commit()
    return mission_service._mission_view(m)


@router.get("/missions/{mission_id}")
def mission_detail(mission_id: str, db: Session = Depends(get_db)) -> dict:
    m = db.get(Mission, mission_id)
    if m is None:
        raise AppError(404, "MISSION_NOT_FOUND", "任务不存在")
    return mission_service._mission_view(m)


@router.post("/missions/{mission_id}/start")
def start_mission(mission_id: str, db: Session = Depends(get_db)) -> dict:
    m = mission_service.start_mission(db, mission_id)
    db.commit()
    return mission_service._mission_view(m)


@router.post("/missions/{mission_id}/cancel")
def cancel_mission(mission_id: str, db: Session = Depends(get_db)) -> dict:
    m = mission_service.cancel_mission(db, mission_id)
    db.commit()
    return mission_service._mission_view(m)


@router.get("/missions/{mission_id}/telemetry")
def mission_telemetry(
    mission_id: str,
    at: str = Query("", description="ISO UTC 仿真时间；默认现实当前"),
    db: Session = Depends(get_db),
) -> dict:
    at_dt = (
        datetime.fromisoformat(at.replace("Z", "+00:00")).replace(tzinfo=None)
        if at
        else datetime.utcnow()
    )
    result = mission_service.telemetry(db, mission_id, at_dt)
    unlocked = []
    m = db.get(Mission, mission_id)
    if m and m.status == "completed":
        unlocked = ach_service.check_and_unlock(db, m.save_id)
    db.commit()
    result["achievements_unlocked"] = unlocked
    return result


# ================================================================ 图鉴与收藏
@router.get("/collection")
def collection(save_id: str, db: Session = Depends(get_db)) -> list[dict]:
    rows = (
        db.query(CollectionEntry)
        .filter(CollectionEntry.save_id == save_id)
        .order_by(CollectionEntry.first_observed_at.desc())
        .limit(2000)
        .all()
    )
    return [
        {
            "satellite_id": c.satellite_id,
            "satellite_name": c.satellite_name,
            "category": c.category,
            "status": c.status,
            "first_observed_at": c.first_observed_at.isoformat() if c.first_observed_at else None,
            "successful_missions": c.successful_missions,
            "favorite": c.favorite,
            "notes": c.notes,
        }
        for c in rows
    ]


@router.post("/collection/{satellite_id}/favorite")
def toggle_favorite(satellite_id: int, save_id: str, db: Session = Depends(get_db)) -> dict:
    c = (
        db.query(CollectionEntry)
        .filter(CollectionEntry.save_id == save_id, CollectionEntry.satellite_id == satellite_id)
        .one_or_none()
    )
    if c is None:
        raise AppError(404, "NOT_DISCOVERED", "尚未发现该卫星")
    c.favorite = not c.favorite
    unlocked = ach_service.check_and_unlock(db, save_id)
    db.commit()
    return {"satellite_id": satellite_id, "favorite": c.favorite, "achievements_unlocked": unlocked}


class NoteCreate(BaseModel):
    save_id: str
    title: str
    notes: str = ""
    satellite_id: int | None = None
    kind: str = "note"
    source: str = "GAME_EVENT"


@router.post("/collection/items")
def add_collection_item(body: NoteCreate, db: Session = Depends(get_db)) -> dict:
    item = CollectionItem(
        save_id=body.save_id,
        satellite_id=body.satellite_id,
        kind=body.kind,
        source=body.source,
        title=body.title,
        notes=body.notes,
    )
    db.add(item)
    unlocked = ach_service.check_and_unlock(db, body.save_id)
    db.commit()
    return {"id": item.id, "achievements_unlocked": unlocked}


@router.get("/collection/items")
def list_collection_items(save_id: str, db: Session = Depends(get_db)) -> list[dict]:
    rows = (
        db.query(CollectionItem)
        .filter(CollectionItem.save_id == save_id)
        .order_by(CollectionItem.created_at.desc())
        .limit(200)
        .all()
    )
    return [
        {
            "id": i.id,
            "satellite_id": i.satellite_id,
            "kind": i.kind,
            "source": i.source,
            "title": i.title,
            "notes": i.notes,
            "created_at": i.created_at.isoformat() if i.created_at else None,
        }
        for i in rows
    ]


# ================================================================ 成就
@router.get("/achievements")
def achievements(save_id: str, db: Session = Depends(get_db)) -> dict:
    return ach_service.achievements_view(db, save_id)


@router.post("/achievements/check")
def check_achievements(save_id: str, db: Session = Depends(get_db)) -> dict:
    unlocked = ach_service.check_and_unlock(db, save_id)
    db.commit()
    return {"unlocked": unlocked}
