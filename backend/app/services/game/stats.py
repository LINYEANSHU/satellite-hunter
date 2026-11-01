"""运营统计（仪表盘数据源）。全部来自真实游戏事件流与任务记录。"""
from __future__ import annotations

from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from app.db.models import CollectionEntry, CollectionItem, GameEvent, Mission, Station
from app.services.game.achievements import _streak


def operator_stats(db: Session, save_id: str) -> dict:
    missions = db.query(Mission).filter(Mission.save_id == save_id).all()
    done = [m for m in missions if m.status == "completed"]
    failed = [m for m in missions if m.status == "failed"]
    stations = db.query(Station).filter(Station.save_id == save_id).count()
    collection = db.query(CollectionEntry).filter(CollectionEntry.save_id == save_id).all()
    items = db.query(CollectionItem).filter(CollectionItem.save_id == save_id).count()
    now = datetime.utcnow()
    last24 = [m for m in done if m.ended_at and m.ended_at >= now - timedelta(hours=24)]

    data_mb = sum(m.data_produced_mb for m in done)
    # 按图鉴类别统计已接收卫星
    by_category: dict[str, int] = {}
    for c in collection:
        by_category[c.category] = by_category.get(c.category, 0) + 1

    # 最近 7 天每日完成任务数（用于仪表盘迷你柱状图）
    daily: list[dict] = []
    for i in range(6, -1, -1):
        day = (now - timedelta(days=i)).date()
        daily.append(
            {
                "date": day.isoformat(),
                "completed": len([m for m in done if m.ended_at and m.ended_at.date() == day]),
            }
        )

    success_rate = len(done) / (len(done) + len(failed)) if (done or failed) else None
    return {
        "missions_total": len(missions),
        "missions_completed": len(done),
        "missions_failed": len(failed),
        "success_rate": round(success_rate, 3) if success_rate is not None else None,
        "completed_last_24h": len(last24),
        "success_streak": _streak(done),
        "data_total_mb": round(data_mb, 1),
        "stations": stations,
        "discovered": len(collection),
        "received": len([c for c in collection if c.status != "tracked"]),
        "decoded": len([c for c in collection if c.status == "decoded"]),
        "favorites": len([c for c in collection if c.favorite]),
        "collection_items": items,
        "by_category": by_category,
        "daily": daily,
    }
