"""Phase 4 API：自动调度、特殊事件、研究系统。"""
from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db import get_db
from app.db.models import GameEvent, Station
from app.core.errors import AppError
from app.services.game import events as event_service
from app.services.game import scheduler as scheduler_service

router = APIRouter(prefix="/game", tags=["game4"])


class ScheduleReq(BaseModel):
    save_id: str
    station_id: str
    hours: float = Field(default=24, gt=0, le=168)
    rules: dict = Field(default_factory=dict)
    apply: bool = False
    at: str | None = None  # 固定起点（ISO UTC）——确定性重放


@router.post("/scheduler/plan")
def scheduler_plan(body: ScheduleReq, db: Session = Depends(get_db)) -> dict:
    """生成（或应用）自动调度建议。确定性规则（需求 8.2）。"""
    rules = scheduler_service.parse_rules(body.rules)
    start = (
        datetime.fromisoformat(body.at.replace("Z", "+00:00")).replace(tzinfo=None)
        if body.at
        else datetime.utcnow()
    )
    if body.apply:
        created = scheduler_service.apply_schedule(db, body.station_id, body.hours, rules, start)
        db.commit()
        return {
            "applied": True,
            "created": len(created),
            "suggestions": [s for s in scheduler_service.preview_schedule(db, body.station_id, body.hours, rules, start)],
        }
    suggestions = scheduler_service.preview_schedule(db, body.station_id, body.hours, rules, start)
    return {"applied": False, "created": 0, "suggestions": suggestions}


# ---------------------------------------------------------------- 事件
@router.get("/events")
def game_events(save_id: str, db: Session = Depends(get_db)) -> list[dict]:
    return event_service.recent_events(db, save_id)


@router.post("/events/check")
def events_check(body: dict, db: Session = Depends(get_db)) -> dict:
    """惰性日事件判定（前端在进入存档/时间跳转后调用）。"""
    save_id = body.get("save_id", "")
    at = body.get("at")
    sim_time = (
        datetime.fromisoformat(at.replace("Z", "+00:00")).replace(tzinfo=None)
        if at
        else datetime.utcnow()
    )
    if not save_id:
        raise AppError(400, "BAD_REQUEST", "缺少 save_id")
    fired = event_service.daily_event_check(db, save_id, sim_time)
    db.commit()
    return {"fired": fired}


class RepairReq(BaseModel):
    save_id: str


@router.post("/equipment/{equipment_id}/repair")
def repair(equipment_id: str, body: RepairReq, db: Session = Depends(get_db)) -> dict:
    result = event_service.repair_equipment(db, body.save_id, equipment_id)
    db.commit()
    return result


# ---------------------------------------------------------------- 研究
@router.get("/research")
def research_list(save_id: str, db: Session = Depends(get_db)) -> dict:
    from app.services.game.events import RESEARCH, player_effects

    unlocked = {
        e.payload.get("research_id")
        for e in db.query(GameEvent)
        .filter(GameEvent.save_id == save_id, GameEvent.kind == "research_unlocked")
        .all()
    }
    return {
        "items": [
            {"id": rid, **r, "unlocked": rid in unlocked} for rid, r in RESEARCH.items()
        ],
        "effects": player_effects(db, save_id),
    }


class ResearchReq(BaseModel):
    save_id: str


@router.post("/research/{research_id}/unlock")
def research_unlock(research_id: str, body: ResearchReq, db: Session = Depends(get_db)) -> dict:
    result = event_service.unlock_research(db, body.save_id, research_id)
    db.commit()
    return result
