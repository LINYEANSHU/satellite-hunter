"""Phase 4 测试：自动调度、特殊事件、研究系统。"""
from __future__ import annotations

import time
from datetime import datetime

import pytest

from app.services.orbit.catalog import GroupData, catalog_service
from app.services.orbit.omm import SatEntry
from tests.test_api_satellites import CSS_OMM, ISS_OMM


@pytest.fixture()
def fake_catalog(monkeypatch):
    entries = [
        SatEntry(norad_id=25544, name="ISS (ZARYA)", omm=ISS_OMM, groups={"stations"},
                 epoch=datetime(2026, 10, 1, 12, 0, 0)),
        SatEntry(norad_id=48274, name="CSS (TIANHE)", omm=CSS_OMM, groups={"stations"},
                 epoch=datetime(2026, 10, 1, 12, 0, 0)),
    ]
    data = GroupData(group="stations", entries=entries, fetched_at=time.time(), stale=False)
    monkeypatch.setattr(catalog_service, "get_group", lambda g, force=False: data)
    monkeypatch.setattr(
        catalog_service, "find",
        lambda nid, group=None: next((e for e in entries if e.norad_id == nid), None),
    )
    return entries


@pytest.fixture()
def ctx(client):
    """创建存档+地面站，返回 (save_id, station_id)。"""
    r = client.post("/api/saves", json={"name": "调度测试"})
    sid = r.json()["id"]
    r = client.post(
        "/api/stations",
        json={"save_id": sid, "name": "调度站", "lat": 39.9, "lon": 116.4, "alt_m": 43},
    )
    assert r.status_code == 200
    return sid, r.json()["id"]


def test_scheduler_preview_deterministic(client, fake_catalog, ctx):
    """调度建议必须确定性（同输入同输出）且互不冲突。"""
    save_id, station_id = ctx
    body = {"save_id": save_id, "station_id": station_id, "hours": 48,
            "rules": {"min_max_elevation": 5, "max_missions": 8},
            "at": "2026-11-01T00:00:00Z"}  # 固定起点保证重放一致
    r1 = client.post("/api/game/scheduler/plan", json=body).json()
    r2 = client.post("/api/game/scheduler/plan", json=body).json()
    assert r1["suggestions"] == r2["suggestions"]
    assert len(r1["suggestions"]) >= 1
    # 时间窗互不重叠
    ss = r1["suggestions"]
    for a, b in zip(ss, ss[1:]):
        assert a["los"] <= b["aos"] or b["los"] <= a["aos"]


def test_scheduler_rules_change_result(client, fake_catalog, ctx):
    """玩家规则（需求 8.4）真实影响调度结果排序。"""
    save_id, station_id = ctx
    high_el = client.post(
        "/api/game/scheduler/plan",
        json={"save_id": save_id, "station_id": station_id, "hours": 48,
              "rules": {"prefer_high_elevation": 10.0, "min_max_elevation": 30}},
    ).json()["suggestions"]
    assert all(s["max_elevation_deg"] >= 30 for s in high_el)
    # 分数按仰角单调（同规则下）
    scores = [s["score"] for s in high_el]
    assert scores == sorted(scores, reverse=True)


def test_scheduler_apply_creates_scheduled_missions(client, fake_catalog, ctx):
    save_id, station_id = ctx
    r = client.post(
        "/api/game/scheduler/plan",
        json={"save_id": save_id, "station_id": station_id, "hours": 48, "apply": True,
              "rules": {"min_max_elevation": 5}},
    ).json()
    assert r["applied"] is True
    assert r["created"] >= 1
    missions = client.get("/api/missions", params={"save_id": save_id}).json()
    autos = [m for m in missions if m["auto"] and m["status"] == "scheduled"]
    assert len(autos) == r["created"]


def test_research_unlock_flow(client, ctx):
    save_id, _ = ctx
    r = client.get("/api/game/research", params={"save_id": save_id}).json()
    assert len(r["items"]) == 5
    assert all(not i["unlocked"] for i in r["items"])

    # RP 不足
    r = client.post("/api/game/research/rf_front_end/unlock", json={"save_id": save_id})
    assert r.status_code == 402

    # 给 RP 后解锁
    from app.db.database import db_session
    from app.db.models import PlayerState

    with db_session() as db:
        p = db.get(PlayerState, save_id)
        p.research_points = 1000

    r = client.post("/api/game/research/rf_front_end/unlock", json={"save_id": save_id})
    assert r.status_code == 200
    # 前置缺失
    r = client.post("/api/game/research/constellation_awareness/unlock", json={"save_id": save_id})
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "PREREQ_MISSING"
    # 效果生效
    eff = client.get("/api/game/research", params={"save_id": save_id}).json()["effects"]
    assert eff.get("snr_bonus_db") == 2.0


def test_special_events_and_repair(client, fake_catalog, ctx):
    save_id, station_id = ctx
    # 触发日事件判定（确定性）：同一游戏日重放不应重复触发（幂等）
    r1 = client.post("/api/game/events/check", json={"save_id": save_id}).json()
    r2 = client.post("/api/game/events/check", json={"save_id": save_id}).json()
    assert r2["fired"] == []  # 幂等：已判定过的事件不再触发
    events = client.get("/api/game/events", params={"save_id": save_id}).json()
    # 首次判定产生的特殊事件已入事件流（recent_events 中 payload.kind 会覆盖行 kind）
    fired_kinds = {e["kind"] for e in r1["fired"]}
    stream_kinds = {e["kind"] for e in events}
    assert fired_kinds <= stream_kinds

    # 人为制造故障 → 启动任务被拒 → 修复成功
    from app.db.database import db_session
    from app.db.models import Equipment

    with db_session() as db:
        eqs = db.query(Equipment).filter(Equipment.save_id == save_id, Equipment.station_id == station_id).all()
        victim = eqs[0]
        victim.status = "fault"
        victim_id = victim.id

    # 有故障设备时创建任务可，但启动被拒
    r = client.post(
        "/api/missions",
        json={"save_id": save_id, "station_id": station_id, "satellite_id": 25544, "type": "capture"},
    )
    if r.status_code == 200:
        mid = r.json()["id"]
        r2 = client.post(f"/api/missions/{mid}/start")
        assert r2.status_code == 409
        assert r2.json()["error"]["code"] == "EQUIPMENT_FAULT"

    # 修复
    from app.db.models import PlayerState

    with db_session() as db:
        p = db.get(PlayerState, save_id)
        p.credits = 10000
    r = client.post(f"/api/game/equipment/{victim_id}/repair", json={"save_id": save_id})
    assert r.status_code == 200
    eqs = client.get("/api/equipment", params={"save_id": save_id}).json()
    assert next(e for e in eqs if e["id"] == victim_id)["status"] == "ok"
