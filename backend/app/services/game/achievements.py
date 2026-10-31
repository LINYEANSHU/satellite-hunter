"""成就系统：30+ 项，事件驱动判定。

所有成就由游戏事件触发（任务完成/设备安装/建站/收藏等），
check_and_unlock 在这些事件后调用，条件评估基于数据库聚合状态。
"""
from __future__ import annotations

import json
from datetime import timedelta
from pathlib import Path

from sqlalchemy.orm import Session

from app.db.models import (
    Achievement,
    CollectionEntry,
    CollectionItem,
    Equipment,
    Mission,
    PlayerState,
    Station,
)
from app.services.game.equipment import find_def

DATA_DIR = Path(__file__).resolve().parent.parent.parent / "data"

with open(DATA_DIR / "achievements.json", encoding="utf-8") as _f:
    _defs = json.load(_f)["achievements"]

ACHIEVEMENTS = {a["id"]: a for a in _defs}


def _cond(aid: str) -> dict:
    return ACHIEVEMENTS.get(aid, {}).get("condition", {})


def _continent(lat: float, lon: float) -> str:
    # 粗略大洲分区（成就用）
    if lat < -10:
        return "oceania" if lon > 110 or lon < -30 else "south_america"
    if lat > 35 and -30 < lon < 60:
        return "europe"
    if lat > 0 and 60 <= lon <= 150:
        return "asia"
    if lat > 30 and lon >= 150:
        return "asia"
    if lat > 15 and -170 <= lon <= -30:
        return "north_america"
    if lat <= 15 and -100 <= lon < -30:
        return "south_america"
    if 0 < lat <= 35 and -20 <= lon <= 60:
        return "africa"
    return "asia"


def check_and_unlock(db: Session, save_id: str) -> list[str]:
    """评估全部未解锁成就，解锁达标的。返回新解锁 id 列表。"""
    unlocked_now: list[str] = []
    have = {
        a.achievement_id
        for a in db.query(Achievement).filter(Achievement.save_id == save_id).all()
    }

    # 聚合状态
    player = db.get(PlayerState, save_id)
    missions_done = (
        db.query(Mission).filter(Mission.save_id == save_id, Mission.status == "completed").all()
    )
    missions_created_n = db.query(Mission).filter(Mission.save_id == save_id).count()
    stations = db.query(Station).filter(Station.save_id == save_id).all()
    equipment = db.query(Equipment).filter(Equipment.save_id == save_id).all()
    collection = db.query(CollectionEntry).filter(CollectionEntry.save_id == save_id).all()
    items_n = db.query(CollectionItem).filter(CollectionItem.save_id == save_id).count()

    def eq_installed_n(station_id=None) -> int:
        q = db.query(Equipment).filter(Equipment.save_id == save_id, Equipment.station_id.isnot(None))
        if station_id:
            q = q.filter(Equipment.station_id == station_id)
        return q.count()

    data_mb = sum(m.data_produced_mb for m in missions_done)
    cat_missions: dict[str, int] = {}
    for m in missions_done:
        ce = (
            db.query(CollectionEntry)
            .filter(CollectionEntry.save_id == save_id, CollectionEntry.satellite_id == m.satellite_id)
            .one_or_none()
        )
        cat = ce.category if ce else "other"
        cat_missions[cat] = cat_missions.get(cat, 0) + 1

    # 成就逐条评估
    for aid, cond in ((k, _cond(k)) for k in ACHIEVEMENTS if k not in have):
        t = cond.get("type")
        ok = False
        if t == "missions_completed":
            ms = [m for m in missions_done if not cond.get("mission_type") or m.type == cond["mission_type"]]
            ok = len(ms) >= cond.get("count", 1)
        elif t == "missions_created":
            ok = missions_created_n >= cond.get("count", 1)
        elif t == "discovered":
            ok = len(collection) >= cond.get("count", 1)
        elif t == "stations":
            ok = len(stations) >= cond.get("count", 1)
        elif t == "equipment_installed":
            ok = eq_installed_n() >= cond.get("count", 1)
        elif t == "auto_completed":
            ok = len([m for m in missions_done if m.auto]) >= cond.get("count", 1)
        elif t == "max_el_gt":
            ok = len([m for m in missions_done if m.max_elevation_deg >= cond.get("el", 0)]) >= cond.get("count", 1)
        elif t == "inclination_gt":
            ok = _inclination_check(db, missions_done, cond)
        elif t == "category_missions":
            ok = cat_missions.get(cond.get("category", ""), 0) >= cond.get("count", 1)
        elif t == "satellite_mission":
            ok = len([m for m in missions_done if m.satellite_id == cond.get("satellite_id")]) >= cond.get("count", 1)
        elif t == "data_mb":
            ok = data_mb >= cond.get("mb", 0)
        elif t == "credits_total":
            ok = bool(player and player.credits >= cond.get("amount", 0))
        elif t == "rp_total":
            ok = bool(player and player.research_points >= cond.get("amount", 0))
        elif t == "full_station":
            ok = any(_station_full(db, st) for st in stations)
        elif t == "rotator_missions":
            n = 0
            for st in stations:
                eqs = {e.catalog_id for e in equipment if e.station_id == st.id}
                if any((find_def(c) or {}).get("max_speed_deg_s", 0) > 0 for c in eqs):
                    n += len([m for m in missions_done if m.station_id == st.id])
            ok = n >= cond.get("count", 1)
        elif t == "success_streak":
            ok = _streak(missions_done) >= cond.get("count", 1)
        elif t == "continents":
            ok = len({_continent(s.lat, s.lon) for s in stations}) >= cond.get("count", 1)
        elif t == "favorites":
            ok = len([c for c in collection if c.favorite]) >= cond.get("count", 1)
        elif t == "level":
            ok = bool(player and player.level >= cond.get("level", 1))
        elif t == "categories":
            ok = len(set(cat_missions.keys()) | {c.category for c in collection}) >= cond.get("count", 1)
        elif t == "missions_in_day":
            ok = _missions_in_day(missions_done) >= cond.get("count", 1)
        elif t == "band_missions":
            ok = _band_check(db, missions_done, cond)
        elif t == "collection_items":
            ok = items_n >= cond.get("count", 1)

        if ok:
            db.add(Achievement(save_id=save_id, achievement_id=aid))
            unlocked_now.append(aid)

    if unlocked_now:
        db.flush()
    return unlocked_now


def _inclination_check(db: Session, missions_done, cond) -> bool:
    from app.services.orbit.omm import parse_epoch

    for m in missions_done:
        entry = None
        from app.services.orbit.catalog import catalog_service

        entry = catalog_service.find(m.satellite_id)
        if entry:
            try:
                if float(entry.omm.get("INCLINATION", 0)) > cond.get("incl", 90):
                    return True
            except (TypeError, ValueError):
                continue
    return False


def _band_check(db: Session, missions_done, cond) -> bool:
    from app.services.game import rf_model
    from app.services.orbit.catalog import catalog_service

    for m in missions_done:
        entry = catalog_service.find(m.satellite_id)
        if entry:
            group = next(iter(entry.groups), "active")
            sig = rf_model.signal_assumptions(m.satellite_id, group)
            if rf_model.band_of_freq(sig.freq_mhz) == cond.get("band"):
                return True
    return False


def _station_full(db: Session, st: Station) -> bool:
    from app.services.game.equipment import CATEGORIES, station_by_category

    eq = station_by_category(db, st.id)
    for cat in CATEGORIES:
        e = eq.get(cat)
        if e is None:
            return False
        d = find_def(e.catalog_id) or {}
        if d.get("price", 0) == 0:
            return False  # 初始型号不算
    return True


def _streak(missions_done) -> int:
    """按结束时间排序的当前最长连续成功数。"""
    done = sorted(
        [m for m in missions_done if m.ended_at], key=lambda m: m.ended_at
    )
    best = cur = 0
    for m in done:
        if m.status == "completed":
            cur += 1
            best = max(best, cur)
        else:
            cur = 0
    return best


def _missions_in_day(missions_done) -> int:
    from collections import Counter

    days = Counter()
    for m in missions_done:
        if m.ended_at:
            days[m.ended_at.date()] += 1
    return max(days.values()) if days else 0


def achievements_view(db: Session, save_id: str) -> dict:
    rows = {
        a.achievement_id: a.unlocked_at
        for a in db.query(Achievement).filter(Achievement.save_id == save_id).all()
    }
    return {
        "total": len(ACHIEVEMENTS),
        "unlocked": len(rows),
        "items": [
            {
                "id": aid,
                "name": a["name"],
                "desc": a["desc"],
                "icon": a["icon"],
                "unlocked": aid in rows,
                "unlocked_at": rows[aid].isoformat() if aid in rows else None,
            }
            for aid, a in ACHIEVEMENTS.items()
        ],
    }
