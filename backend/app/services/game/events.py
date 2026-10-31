"""特殊游戏事件（需求 8.3）+ 研究系统。

事件全部标记 GAME_EVENT（虚拟），绝不伪造现实卫星事件：
- 设备故障：随机种子（每游戏日、每站一次判定）→ 某设备 condition 骤降
- 电力波动 / 存储警告：提示性事件
- 临时挑战：24h 内任务奖励 ×1.5

研究系统：RP 解锁全局被动加成（确定性数值，见 RESEARCH 定义）。
"""
from __future__ import annotations

import random
from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from app.db.models import Equipment, GameEvent, PlayerState, Station
from app.services.game.equipment import find_def, station_equipment

# ---------------------------------------------------------------- 研究定义
RESEARCH = {
    "rf_front_end": {
        "name": "前端优化技术",
        "desc": "全站接收链路 SNR +2 dB（设备调校）",
        "cost_rp": 100,
        "requires": [],
        "effect": {"snr_bonus_db": 2.0},
    },
    "signal_processing": {
        "name": "信号处理算法",
        "desc": "任务数据产出 +15%",
        "cost_rp": 200,
        "requires": ["rf_front_end"],
        "effect": {"data_bonus": 0.15},
    },
    "ops_efficiency": {
        "name": "运营效率",
        "desc": "任务奖励 Credits +10%",
        "cost_rp": 300,
        "requires": ["rf_front_end"],
        "effect": {"credit_bonus": 0.10},
    },
    "predictive_maintenance": {
        "name": "预测性维护",
        "desc": "设备故障概率减半",
        "cost_rp": 250,
        "requires": ["ops_efficiency"],
        "effect": {"fault_halve": 1},
    },
    "constellation_awareness": {
        "name": "星座感知",
        "desc": "自动调度建议数量上限 +4",
        "cost_rp": 400,
        "requires": ["signal_processing"],
        "effect": {"scheduler_plus": 4},
    },
}


def player_effects(db: Session, save_id: str) -> dict:
    """汇总玩家已解锁的研究加成。"""
    rows = (
        db.query(GameEvent)
        .filter(GameEvent.save_id == save_id, GameEvent.kind == "research_unlocked")
        .all()
    )
    effects: dict = {}
    for r in rows:
        rid = r.payload.get("research_id")
        eff = RESEARCH.get(rid, {}).get("effect", {})
        for k, v in eff.items():
            if isinstance(v, (int, float)):
                effects[k] = effects.get(k, 0) + v
            else:
                effects[k] = v
    return effects


def unlock_research(db: Session, save_id: str, research_id: str) -> dict:
    from app.core.errors import AppError

    r = RESEARCH.get(research_id) or RESEARCH.get(research_id.strip())
    if r is None:
        raise AppError(404, "RESEARCH_NOT_FOUND", f"未知研究: {research_id}")
    rid = research_id.strip()
    player = db.get(PlayerState, save_id)
    if player is None:
        raise AppError(404, "SAVE_NOT_FOUND", "存档不存在")
    if player.research_points < r["cost_rp"]:
        raise AppError(402, "INSUFFICIENT_RP", f"研究点数不足（需要 {r['cost_rp']}）")
    done = {
        e.payload.get("research_id")
        for e in db.query(GameEvent)
        .filter(GameEvent.save_id == save_id, GameEvent.kind == "research_unlocked")
        .all()
    }
    if rid in done:
        raise AppError(409, "ALREADY_UNLOCKED", "该研究已解锁")
    for req in r["requires"]:
        if req not in done:
            raise AppError(409, "PREREQ_MISSING", f"需要先解锁: {RESEARCH[req]['name']}")
    player.research_points -= r["cost_rp"]
    db.add(GameEvent(save_id=save_id, kind="research_unlocked", payload={"research_id": rid}))
    db.flush()
    return {"unlocked": rid, "cost_rp": r["cost_rp"]}


# ---------------------------------------------------------------- 特殊事件
EVENT_KINDS = {
    "equipment_fault": "设备故障",
    "power_surge": "电力波动",
    "storage_warning": "存储空间警告",
    "bonus_window": "临时挑战（奖励 +50%，24h）",
}


def daily_event_check(db: Session, save_id: str, sim_time: datetime) -> list[dict]:
    """每个游戏日（UTC 日）对每座站做一次确定性事件判定（惰性调用）。

    种子 = hash(save_id, 站点id, 日期)，保证同一日重复调用结果一致。
    """
    fired: list[dict] = []
    stations = db.query(Station).filter(Station.save_id == save_id).all()
    player = db.get(PlayerState, save_id)
    effects = player_effects(db, save_id)

    day_key = sim_time.strftime("%Y%m%d")
    existing = {
        e.payload.get("day_key")
        for e in db.query(GameEvent)
        .filter(GameEvent.save_id == save_id, GameEvent.kind == "special_event", GameEvent.ts >= sim_time.replace(hour=0, minute=0, second=0, microsecond=0).timestamp())
        .all()
    }
    for st in stations:
        key = f"{day_key}:{st.id}"
        if key in existing:
            continue
        rng = random.Random(f"{save_id}:{key}")
        halved = effects.get("fault_halve", 0) >= 1
        roll = rng.random()
        fault_p = 0.12 * (0.5 if halved else 1.0)
        if roll < fault_p and st.status == "active":
            # 设备故障：站内一件设备受损
            eqs = station_equipment(db, st.id)
            if eqs:
                victim = rng.choice(eqs)
                d = find_def(victim.catalog_id) or {}
                victim.condition = max(5.0, victim.condition - rng.uniform(35, 60))
                victim.status = "fault"
                ev = {
                    "kind": "equipment_fault",
                    "station": st.name,
                    "equipment": d.get("name", victim.catalog_id),
                    "equipment_id": victim.id,
                    "hint": "在设备管理页维修该设备后任务才能正常执行",
                }
                db.add(GameEvent(save_id=save_id, kind="special_event", source="GAME_EVENT", payload={"day_key": key, **ev}))
                fired.append(ev)
        elif roll < fault_p + 0.10:
            ev = {"kind": "bonus_window", "station": st.name, "until": (sim_time + timedelta(hours=24)).isoformat(), "bonus": 1.5}
            db.add(GameEvent(save_id=save_id, kind="special_event", source="GAME_EVENT", payload={"day_key": key, **ev}))
            fired.append(ev)
            # 其余情形保持安静（不伪造现实事件）
    db.flush()
    return fired


def recent_events(db: Session, save_id: str, limit: int = 30) -> list[dict]:
    rows = (
        db.query(GameEvent)
        .filter(GameEvent.save_id == save_id, GameEvent.kind.in_(("special_event", "mission_completed", "mission_failed", "research_unlocked")))
        .order_by(GameEvent.ts.desc())
        .limit(limit)
        .all()
    )
    return [
        {"ts": r.ts, "kind": r.kind, "source": r.source, **(r.payload or {})}
        for r in rows
    ]


def repair_equipment(db: Session, save_id: str, equipment_id: str) -> dict:
    from app.core.errors import AppError

    eq = db.get(Equipment, equipment_id)
    if eq is None or eq.save_id != save_id:
        raise AppError(404, "EQUIPMENT_NOT_FOUND", "设备不存在")
    d = find_def(eq.catalog_id) or {}
    cost = round((d.get("price", 100) or 100) * 0.2 + 50)
    player = db.get(PlayerState, save_id)
    if player is None:
        raise AppError(404, "SAVE_NOT_FOUND", "存档不存在")
    if player.credits < cost:
        raise AppError(402, "INSUFFICIENT_CREDITS", f"维修需要 ₡{cost}")
    player.credits -= cost
    eq.condition = 100.0
    eq.status = "ok"
    db.add(GameEvent(save_id=save_id, kind="equipment_repaired", payload={"equipment_id": eq.id, "cost": cost}))
    db.flush()
    return {"repaired": eq.id, "cost": cost}
