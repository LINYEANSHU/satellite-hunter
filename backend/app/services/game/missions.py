"""任务系统：创建、执行（惰性确定性仿真）、结算、奖励。

核心设计：
- 任务执行状态是仿真时间的确定性函数，无需后台线程；客户端轮询
  telemetry 时按需计算并推进状态机（与前端锚点时钟天然一致）。
- 接收结果由"整段过境的链路积分 + 种子化指向抖动"决定（模拟模式，
  SIMULATED_RF）；真实模式（RECORDED_IQ / LIVE_SDR）在 Phase 3/5。
"""
from __future__ import annotations

import math
import random
from datetime import datetime, timedelta

import numpy as np
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.db.models import CollectionEntry, Equipment, GameEvent, Mission, PlayerState, Station
from app.services.game import rf_model
from app.services.game.equipment import find_def, station_by_category
from app.services.orbit import passes as passes_mod
from app.services.orbit.catalog import catalog_service
from app.services.orbit.propagator import Propagator
from app.services.orbit.transforms import geodetic_to_ecef, look_angles

REWARDS = {
    "tutorial": {"credits": 150, "rp": 5, "xp": 20},
    "track": {"credits": 200, "rp": 8, "xp": 30},
    "plan": {"credits": 250, "rp": 10, "xp": 30},
    "capture": {"credits": 350, "rp": 15, "xp": 50},
    "auto": {"credits": 280, "rp": 12, "xp": 40},
    "collection": {"credits": 120, "rp": 6, "xp": 20},
}

MISSION_TYPES = list(REWARDS.keys())

# 仿真采样：任务积分步长（秒）
_INTEGRATION_STEP_S = 20.0


def _seed_for(save_id: str, satellite_id: int, aos: datetime) -> int:
    base = f"{save_id}:{satellite_id}:{aos.isoformat()}"
    return abs(hash(base)) % (2**31)


def _entry_of(satellite_id: int):
    return catalog_service.find(satellite_id)


def _storage_used_mb(db: Session, station_id: str) -> float:
    rows = (
        db.query(Mission)
        .filter(Mission.station_id == station_id, Mission.status == "completed")
        .all()
    )
    return sum(m.data_produced_mb for m in rows)


def _storage_capacity_gb(db: Session, station) -> float:
    eq = station_by_category(db, station.id)
    sto = eq.get("storage")
    if sto is None:
        return 0.0
    d = find_def(sto.catalog_id) or {}
    return d.get("capacity_gb", 0.0)


def _station_propagator(satellite_id: int) -> Propagator:
    entry = _entry_of(satellite_id)
    if entry is None:
        raise AppError(404, "SATELLITE_NOT_FOUND", f"卫星 {satellite_id} 不在目录中")
    return Propagator([entry])


def _next_pass(satellite_id: int, station, start: datetime, min_el: float):
    prop = _station_propagator(satellite_id)
    sat = prop.get_satrec(satellite_id)
    ps = passes_mod.predict_passes(
        sat, satellite_id, station.lat, station.lon, station.alt_m / 1000.0,
        start, start + timedelta(hours=72), max(min_el, 5.0), max_passes=5,
    )
    return ps[0] if ps else None


def create_mission(
    db: Session,
    save_id: str,
    station_id: str,
    satellite_id: int,
    mission_type: str,
    priority: int = 5,
    at: datetime | None = None,
    auto: bool = False,
) -> Mission:
    """创建任务。校验：类型、设备频段覆盖、可见性、站内冲突、计算机并发。"""
    if mission_type not in MISSION_TYPES:
        raise AppError(400, "BAD_TYPE", f"未知任务类型: {mission_type}")
    station = db.get(Station, station_id)
    if station is None or station.save_id != save_id:
        raise AppError(404, "STATION_NOT_FOUND", "地面站不存在")
    if station.status != "active":
        raise AppError(409, "STATION_OFFLINE", "地面站非活动状态")

    entry = _entry_of(satellite_id)
    if entry is None:
        raise AppError(404, "SATELLITE_NOT_FOUND", f"卫星 {satellite_id} 不在目录中")
    group = next(iter(entry.groups), "active")

    # 需求 5.1/2.2：设备无法覆盖频段时，接收任务不能创建
    sig = rf_model.signal_assumptions(satellite_id, group)
    eq = station_by_category(db, station_id)
    rf = rf_model.station_rf(eq)
    band = rf_model.band_of_freq(sig.freq_mhz)
    if rf.sdr_max_bw_khz <= 0:
        raise AppError(422, "NO_SDR", "该站缺少 SDR 接收机，无法执行接收任务")
    if not (rf.sdr_min_mhz <= sig.freq_mhz <= rf.sdr_max_mhz):
        raise AppError(422, "FREQ_NOT_COVERED", f"SDR 不覆盖 {sig.freq_mhz} MHz")
    if rf.antenna_bands and band not in rf.antenna_bands and band != "other":
        raise AppError(422, "ANT_BAND_NOT_COVERED", f"天线不覆盖 {band} 频段")
    for issue in rf.issues:
        if "转台" in issue and rf.antenna_directional:
            raise AppError(422, "ROTATOR_REQUIRED", issue)

    now = datetime.utcnow()
    if at is not None:
        # 指定时刻：必须在可视窗口内
        prop = _station_propagator(satellite_id)
        pos = prop.positions_ecef(at).get(satellite_id)
        la = (
            look_angles(geodetic_to_ecef(station.lat, station.lon, station.alt_m / 1000.0), pos.r_ecef)
            if pos and not pos.error
            else None
        )
        if la is None or la.elevation_deg < max(station.min_elevation_deg, 0.0):
            raise AppError(422, "NOT_VISIBLE", "指定时刻卫星不在可视范围内")
        aos, los = at, at + timedelta(seconds=300)
        max_el = la.elevation_deg
    else:
        ps = _next_pass(satellite_id, station, now, station.min_elevation_deg)
        if ps is None:
            raise AppError(422, "NO_PASS", "72 小时内无可用过境")
        aos, los, max_el = ps.aos, ps.los, ps.max_elevation_deg

    # 冲突检查：同站时间窗重叠
    conflicts = (
        db.query(Mission)
        .filter(
            Mission.station_id == station_id,
            Mission.status.in_(("planned", "active", "scheduled")),
            Mission.aos < los,
            Mission.los > aos,
        )
        .count()
    )
    if conflicts:
        raise AppError(409, "MISSION_CONFLICT", "该时段已有任务占用此地面站")

    mult = 1.0 + (max_el / 90.0) * 0.5
    base = REWARDS[mission_type]
    m = Mission(
        save_id=save_id,
        station_id=station_id,
        satellite_id=satellite_id,
        satellite_name=entry.name,
        type=mission_type,
        status="planned",
        priority=priority,
        aos=aos,
        los=los,
        max_elevation_deg=max_el,
        frequency_hz=sig.freq_mhz * 1e6,
        required_equipment=[{"category": c} for c in ("antenna", "sdr")],
        planned_duration_s=(los - aos).total_seconds(),
        estimated_data_mb=round(sig.data_rate_kbps * (los - aos).total_seconds() / 8 / 1024, 3),
        reward_credits=round(base["credits"] * mult),
        reward_rp=round(base["rp"] * mult),
        reward_xp=round(base["xp"] * mult),
        seed=_seed_for(save_id, satellite_id, aos),
        auto=auto,
    )
    db.add(m)
    db.flush()
    db.add(GameEvent(save_id=save_id, kind="mission_created", payload={"mission_id": m.id, "type": mission_type}))
    _discover(db, save_id, satellite_id, entry.name, group)
    db.flush()
    return m


def _discover(db: Session, save_id: str, satellite_id: int, name: str, group: str) -> None:
    """图鉴：首次交互标记 tracked（需求 7.1）。"""
    row = (
        db.query(CollectionEntry)
        .filter(CollectionEntry.save_id == save_id, CollectionEntry.satellite_id == satellite_id)
        .one_or_none()
    )
    if row is None:
        db.add(
            CollectionEntry(
                save_id=save_id,
                satellite_id=satellite_id,
                satellite_name=name,
                category=_category_label(group),
                status="tracked",
                first_observed_at=datetime.utcnow(),
            )
        )
        player = db.get(PlayerState, save_id)
        if player:
            player.satellites_discovered += 1


def _category_label(group: str) -> str:
    from app.services.orbit.catalog import GROUP_LABELS

    for key, label in {
        "stations": "space_station",
        "weather": "weather",
        "amateur": "amateur",
        "science": "science",
        "geo": "communications",
    }.items():
        if key == group:
            return label
    return "other"


def start_mission(db: Session, mission_id: str) -> Mission:
    m = db.get(Mission, mission_id)
    if m is None:
        raise AppError(404, "MISSION_NOT_FOUND", "任务不存在")
    if m.status not in ("planned", "scheduled"):
        raise AppError(409, "BAD_STATE", f"任务状态 {m.status} 不能启动")
    station = db.get(Station, m.station_id)
    if station is None or station.status != "active":
        raise AppError(409, "STATION_OFFLINE", "地面站不可用")

    # 设备故障时不能启动（需求 8.3：故障需维修）
    from app.services.game.equipment import station_equipment

    faulty = [e for e in station_equipment(db, m.station_id) if e.status == "fault"]
    if faulty:
        raise AppError(409, "EQUIPMENT_FAULT", "站内有故障设备，请先在设备管理页维修")

    # 计算机并发限制
    eq = station_by_category(db, m.station_id)
    pc = eq.get("computer")
    conc = (find_def(pc.catalog_id) or {}).get("concurrent_missions", 1) if pc else 1
    active_n = (
        db.query(Mission)
        .filter(Mission.station_id == m.station_id, Mission.status == "active")
        .count()
    )
    if active_n >= conc:
        raise AppError(409, "COMPUTER_BUSY", f"计算机并发已达上限（{conc}）")

    m.status = "active"
    m.started_at = datetime.utcnow()
    db.flush()
    return m


def cancel_mission(db: Session, mission_id: str) -> Mission:
    m = db.get(Mission, mission_id)
    if m is None:
        raise AppError(404, "MISSION_NOT_FOUND", "任务不存在")
    if m.status not in ("planned", "active", "scheduled"):
        raise AppError(409, "BAD_STATE", f"任务状态 {m.status} 不能取消")
    m.status = "cancelled"
    m.ended_at = datetime.utcnow()
    db.flush()
    return m


def _pointing_error(rf: rf_model.StationRF, rng: random.Random, el: float, az_rate: float, el_rate: float) -> float:
    """指向误差模型（度）。转台精度 + 角速度超限惩罚 + 种子抖动。"""
    if not rf.antenna_directional:
        return 0.0
    if not rf.has_rotator:
        return 45.0  # 固定天顶，随仰角降低在 compute_link 中折算损失
    rate = math.hypot(az_rate, el_rate)
    over = max(0.0, rate - rf.rotator_max_speed)
    jitter = rng.uniform(0, rf.rotator_accuracy_deg)
    return rf.rotator_accuracy_deg * 0.5 + jitter * 0.5 + over * 5.0


def _pass_samples(db: Session, mission: Mission, station, sig, until: datetime):
    """从 AOS 到 until（≤LOS）按步长采样：仰角/链路/数据率。"""
    from app.services.game.events import player_effects

    prop = _station_propagator(mission.satellite_id)
    sat = prop.get_satrec(mission.satellite_id)
    entry = _entry_of(mission.satellite_id)
    group = next(iter(entry.groups), "active")
    sig = sig or rf_model.signal_assumptions(mission.satellite_id, group)

    eq = station_by_category(db, mission.station_id)
    rf = rf_model.station_rf(eq)
    effects = player_effects(db, mission.save_id)
    snr_bonus = float(effects.get("snr_bonus_db", 0.0))
    data_bonus = float(effects.get("data_bonus", 0.0))

    duration = (mission.los - mission.aos).total_seconds()
    n = max(2, int(duration / _INTEGRATION_STEP_S))
    t0 = mission.aos
    t_end = min(until, mission.los)

    samples = []
    prev_az = prev_el = None
    for i in range(n + 1):
        t = t0 + timedelta(seconds=duration * i / n)
        if t > t_end:
            break
        pos = prop.positions_ecef(t).get(mission.satellite_id)
        if pos is None or pos.error:
            continue
        st_ecef = geodetic_to_ecef(station.lat, station.lon, station.alt_m / 1000.0)
        la = look_angles(st_ecef, pos.r_ecef, pos.v_ecef)
        az_rate = el_rate = 0.0
        if prev_az is not None:
            daz = abs(((la.azimuth_deg - prev_az + 180) % 360) - 180)
            az_rate = daz / _INTEGRATION_STEP_S
            el_rate = abs(la.elevation_deg - prev_el) / _INTEGRATION_STEP_S
        prev_az, prev_el = la.azimuth_deg, la.elevation_deg

        pe = _pointing_error(rf, random.Random(f"{mission.seed}:{i}"), la.elevation_deg, az_rate, el_rate)
        link = rf_model.compute_link(rf, sig, la.elevation_deg, la.range_km, la.range_rate_km_s, pe, snr_bonus)
        samples.append(
            {
                "t": t,
                "el": la.elevation_deg,
                "az": la.azimuth_deg,
                "range_km": la.range_km,
                "link": link,
                "dt": duration / n,
                "data_bonus": data_bonus,
            }
        )
    return samples


def telemetry(db: Session, mission_id: str, sim_time: datetime) -> dict:
    """任务实时状态（惰性推进状态机；结算发生在仿真时间越过 LOS 时）。"""
    m = db.get(Mission, mission_id)
    if m is None:
        raise AppError(404, "MISSION_NOT_FOUND", "任务不存在")
    station = db.get(Station, m.station_id)
    entry = _entry_of(m.satellite_id)
    group = next(iter(entry.groups), "active") if entry else "active"
    sig = rf_model.signal_assumptions(m.satellite_id, group)

    if m.status == "planned":
        return {"status": "planned", "phase": "waiting", "mission": _mission_view(m)}

    if m.status == "active":
        if sim_time < m.aos:
            return {
                "status": "active",
                "phase": "waiting",
                "seconds_to_aos": (m.aos - sim_time).total_seconds(),
                "mission": _mission_view(m),
            }
        if sim_time <= m.los:
            samples = _pass_samples(db, m, station, sig, sim_time)
            if samples:
                cur = samples[-1]
                total_dt = (sim_time - m.aos).total_seconds()
                data_mb = _integrate_data(samples, sig)
                progress = total_dt / max((m.los - m.aos).total_seconds(), 1.0)
                return {
                    "status": "active",
                    "phase": "receiving",
                    "progress": round(min(1.0, progress), 4),
                    "azimuth_deg": round(cur["az"], 1),
                    "elevation_deg": round(cur["el"], 1),
                    "range_km": round(cur["range_km"], 1),
                    "snr_db": cur["link"].snr_db,
                    "margin_db": cur["link"].margin_db,
                    "doppler_hz": cur["link"].doppler_hz,
                    "quality": cur["link"].quality,
                    "data_mb": round(data_mb, 3),
                    "frequency_mhz": sig.freq_mhz,
                    "modulation": sig.modulation,
                    "source": "SIMULATED_RF",
                    "mission": _mission_view(m),
                }
        # 越过 LOS：结算
        _finalize(db, m, station, sig)
        db.flush()

    return {"status": m.status, "phase": "done", "mission": _mission_view(m)}


def duration_ratio(samples, m) -> float:
    duration = max((m.los - m.aos).total_seconds(), 1.0)
    covered = sum(s["dt"] for s in samples)
    return min(1.0, covered / duration)


def _integrate_data(samples, sig) -> float:
    """累计数据量 MB = Σ rate_kbps × quality/100 × dt / 8 / 1024（含研究加成）。"""
    mb = 0.0
    for s in samples:
        kbps = sig.data_rate_kbps * (s["link"].quality / 100.0) * (1.0 + s.get("data_bonus", 0.0))
        mb += kbps * s["dt"] / 8.0 / 1024.0
    return mb


def _finalize(db: Session, m: Mission, station, sig) -> None:
    """结算：整段过境积分 → 成败判定 → 奖励 → 图鉴 → 事件。"""
    samples = _pass_samples(db, m, station, sig, m.los)
    duration = max((m.los - m.aos).total_seconds(), 1.0)
    covered = sum(s["dt"] for s in samples)
    ratio = min(1.0, covered / duration)
    data_mb = _integrate_data(samples, sig) * (duration / covered if covered else 0.0)
    avg_margin = 0.0
    if samples and covered:
        avg_margin = sum(s["link"].margin_db * s["dt"] for s in samples) / covered

    # 存储容量检查
    cap_gb = _storage_capacity_gb(db, station)
    used = _storage_used_mb(db, m.station_id)
    stored_mb = min(data_mb, max(0.0, cap_gb * 1024 - used))

    success = ratio >= 0.9 and stored_mb > 0 and avg_margin > 0
    ratio_data = stored_mb / max(m.estimated_data_mb, 1e-9)

    # 特殊事件：奖励窗口 + 研究加成
    from app.services.game.events import player_effects

    effects = player_effects(db, m.save_id)
    credit_mult = 1.0 + float(effects.get("credit_bonus", 0.0))

    m.status = "completed" if success else "failed"
    m.ended_at = datetime.utcnow()
    m.data_produced_mb = round(stored_mb, 3)
    if success:
        m.result = {
            "avg_margin_db": round(avg_margin, 2),
            "coverage": round(ratio, 3),
            "data_ratio": round(ratio_data, 3),
            "stored_mb": round(stored_mb, 3),
            "source": "SIMULATED_RF",
        }
        # 奖励按数据完成度缩放
        player = db.get(PlayerState, m.save_id)
        if player:
            player.credits += round(m.reward_credits * min(1.0, 0.4 + 0.6 * ratio_data) * credit_mult)
            player.research_points += round(m.reward_rp * min(1.0, 0.4 + 0.6 * ratio_data))
            player.xp += m.reward_xp
            player.total_missions_done += 1
            player.level = 1 + int(player.xp // 500)
        ce = (
            db.query(CollectionEntry)
            .filter(CollectionEntry.save_id == m.save_id, CollectionEntry.satellite_id == m.satellite_id)
            .one_or_none()
        )
        if ce:
            ce.successful_missions += 1
            if ce.status in ("tracked",):
                ce.status = "received"
        db.add(GameEvent(save_id=m.save_id, kind="mission_completed", payload={
            "mission_id": m.id, "satellite_id": m.satellite_id, "data_mb": m.data_produced_mb,
        }))
    else:
        reasons = []
        if ratio < 0.9:
            reasons.append("过境覆盖不足")
        if avg_margin <= 0:
            reasons.append("链路余量不足（SNR 达标率低）")
        if stored_mb <= 0:
            reasons.append("存储空间已满")
        m.failure_reason = "；".join(reasons) or "接收质量不达标"
        db.add(GameEvent(save_id=m.save_id, kind="mission_failed", payload={"mission_id": m.id}))


def _mission_view(m: Mission) -> dict:
    return {
        "id": m.id,
        "save_id": m.save_id,
        "station_id": m.station_id,
        "satellite_id": m.satellite_id,
        "satellite_name": m.satellite_name,
        "type": m.type,
        "status": m.status,
        "priority": m.priority,
        "aos": m.aos.isoformat() + "Z" if m.aos else None,
        "los": m.los.isoformat() + "Z" if m.los else None,
        "max_elevation_deg": round(m.max_elevation_deg, 1),
        "frequency_hz": m.frequency_hz,
        "planned_duration_s": m.planned_duration_s,
        "estimated_data_mb": m.estimated_data_mb,
        "reward_credits": m.reward_credits,
        "reward_rp": m.reward_rp,
        "reward_xp": m.reward_xp,
        "auto": m.auto,
        "result": m.result,
        "failure_reason": m.failure_reason,
        "data_produced_mb": m.data_produced_mb,
    }
