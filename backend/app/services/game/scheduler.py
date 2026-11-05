"""自动化任务调度（需求 8.2 / 8.4）：确定性规则算法。

不使用 LLM 判定；规则全部确定性可解释：
- 候选 = 窗口内所有过境（分组可选）
- 硬过滤：设备频段覆盖、最小仰角、与已计划任务冲突、计算机并发
- 评分 = Σ(规则权重 × 归一化指标)：仰角、未收藏加成、奖励、信号质量
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.db.models import CollectionEntry, Mission, Station
from app.services.game import rf_model
from app.services.game.equipment import station_by_category
from app.services.orbit import passes as passes_mod
from app.services.orbit.catalog import catalog_service
from app.services.orbit.propagator import group_propagator_cache


@dataclass
class ScheduleRule:
    prefer_uncollected: float = 1.0   # 优先尚未收藏的卫星
    prefer_high_elevation: float = 1.0
    prefer_reward: float = 0.5
    prefer_signal_quality: float = 0.5
    min_max_elevation: float = 20.0
    max_missions: int = 8
    group: str = "stations"
    daily_credit_limit: float = 0.0  # 0 = 不限（预留 8.4）


def parse_rules(d: dict | None) -> ScheduleRule:
    r = ScheduleRule()
    if not d:
        return r
    for k in (
        "prefer_uncollected",
        "prefer_high_elevation",
        "prefer_reward",
        "prefer_signal_quality",
        "min_max_elevation",
        "max_missions",
        "daily_credit_limit",
    ):
        if k in d and d[k] is not None:
            setattr(r, k, float(d[k]))
    if d.get("group"):
        r.group = str(d["group"])
    if d.get("max_missions"):
        r.max_missions = int(d["max_missions"])
    return r


def preview_schedule(db: Session, station_id: str, hours: float, rules: ScheduleRule, start: datetime) -> list[dict]:
    """生成调度建议（不落库）。"""
    from app.services.game.events import player_effects

    station = db.get(Station, station_id)
    if station is None:
        raise AppError(404, "STATION_NOT_FOUND", "地面站不存在")
    data = catalog_service.get_group(rules.group)
    if len(data.entries) > 300:
        data_entries = data.entries[:300]
    else:
        data_entries = data.entries

    max_missions = int(rules.max_missions + player_effects(db, station.save_id).get("scheduler_plus", 0))

    eq = station_by_category(db, station.id)
    rf = rf_model.station_rf(eq)
    end = start + timedelta(hours=hours)

    collected = {
        c.satellite_id
        for c in db.query(CollectionEntry).filter(CollectionEntry.save_id == station.save_id).all()
    }
    busy = (
        db.query(Mission)
        .filter(
            Mission.station_id == station_id,
            Mission.status.in_(("planned", "active", "scheduled")),
        )
        .all()
    )

    candidates: list[dict] = []
    # 整组共用一个传播器（原先每颗卫星重建 Satrec），并把扫描窗口收敛到
    # min(end, start+72h)：首个 aos ≥ end 的过境本来就会被过滤，结果等价。
    prop = group_propagator_cache.get(rules.group, data.fetched_at, data_entries)
    scan_end = min(end, start + timedelta(hours=72))
    for entry in data_entries:
        try:
            sat = prop.get_satrec(entry.norad_id)
            ps = passes_mod.predict_passes(
                sat, entry.norad_id, station.lat, station.lon, station.alt_m / 1000.0,
                start, scan_end, max(station.min_elevation_deg, 5.0), max_passes=1,
            )
            p = ps[0] if ps else None
        except Exception:
            continue
        if p is None or p.aos >= end:
            continue
        if p.max_elevation_deg < max(rules.min_max_elevation, station.min_elevation_deg):
            continue
        # 频段覆盖
        group = next(iter(entry.groups), "active")
        sig = rf_model.signal_assumptions(entry.norad_id, group)
        if rf.sdr_max_bw_khz > 0 and not (rf.sdr_min_mhz <= sig.freq_mhz <= rf.sdr_max_mhz):
            continue
        # 冲突（与已有任务）
        if any(m.aos < p.los and m.los > p.aos for m in busy):
            continue

        base = {"tutorial": 150, "track": 200, "plan": 250, "capture": 350, "auto": 280, "collection": 120}
        reward = base["auto"] * (1 + (p.max_elevation_deg / 90.0) * 0.5)
        quality = min(100.0, max(0.0, 60.0 + p.max_elevation_deg))
        score = (
            rules.prefer_high_elevation * (p.max_elevation_deg / 90.0)
            + rules.prefer_uncollected * (0.0 if entry.norad_id in collected else 1.0)
            + rules.prefer_reward * (reward / 500.0)
            + rules.prefer_signal_quality * (quality / 100.0)
        )
        candidates.append(
            {
                "satellite_id": entry.norad_id,
                "satellite_name": entry.name,
                "aos": p.aos,
                "los": p.los,
                "max_elevation_deg": round(p.max_elevation_deg, 1),
                "frequency_mhz": sig.freq_mhz,
                "reward_credits": round(reward),
                "score": round(score, 3),
                "new_satellite": entry.norad_id not in collected,
            }
        )

    candidates.sort(key=lambda c: (-c["score"], c["aos"]))

    # 顺序选择互不冲突的组合
    chosen: list[dict] = []
    for c in candidates:
        if len(chosen) >= max_missions:
            break
        if any(c["aos"] < x["los"] and c["los"] > x["aos"] for x in chosen):
            continue
        chosen.append(c)
    chosen.sort(key=lambda c: c["aos"])
    for c in chosen:
        c["aos"] = c["aos"].isoformat() + "Z"
        c["los"] = c["los"].isoformat() + "Z"
    return chosen


def apply_schedule(db: Session, station_id: str, hours: float, rules: ScheduleRule, start: datetime) -> list[Mission]:
    """按建议创建 auto 任务。"""
    from app.services.game import missions as mission_service

    suggestions = preview_schedule(db, station_id, hours, rules, start)
    created: list[Mission] = []
    for s in suggestions:
        try:
            m = mission_service.create_mission(
                db,
                save_id=db.get(Station, station_id).save_id,
                station_id=station_id,
                satellite_id=s["satellite_id"],
                mission_type="auto",
                priority=5,
                at=None,
                auto=True,
            )
            m.status = "scheduled"
            created.append(m)
        except Exception:
            continue  # 单个失败不影响整体（如竞态冲突）
    db.flush()
    return created
