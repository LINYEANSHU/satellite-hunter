"""游戏会话 API：Phase 1 提供默认存档引导；Phase 2 扩展为完整存档管理。"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db import get_db
from app.db.models import PlayerState, Save

router = APIRouter(prefix="/game", tags=["game"])

DEFAULT_SAVE_NAME = "默认存档"


@router.post("/bootstrap")
def bootstrap(db: Session = Depends(get_db)) -> dict:
    """确保存在一个默认存档并返回其完整会话状态（幂等）。"""
    save = db.query(Save).filter(Save.name == DEFAULT_SAVE_NAME).first()
    created = False
    if save is None:
        save = Save(name=DEFAULT_SAVE_NAME)
        db.add(save)
        db.flush()
        db.add(PlayerState(save_id=save.id))
        db.commit()
        created = True

    player = db.get(PlayerState, save.id)
    if player is None:
        player = PlayerState(save_id=save.id)
        db.add(player)
        db.commit()

    return {
        "created": created,
        "save": {
            "id": save.id,
            "name": save.name,
            "sim_time_mode": save.sim_time_mode,
            "sim_time_scale": save.sim_time_scale,
            "sim_time_offset_s": save.sim_time_offset_s,
        },
        "player": {
            "credits": player.credits,
            "research_points": player.research_points,
            "level": player.level,
            "xp": player.xp,
            "total_missions_done": player.total_missions_done,
            "satellites_discovered": player.satellites_discovered,
        },
    }
