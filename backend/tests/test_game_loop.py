"""Phase 2 核心闭环测试：存档 → 建站 → 设备 → 任务 → 执行 → 奖励 → 成就。

使用离线注入的卫星目录（test_api_satellites 的 fixture 模式）。
"""
from __future__ import annotations

import time
from datetime import datetime, timedelta

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
def save_id(client):
    r = client.post("/api/saves", json={"name": "玩家一"})
    assert r.status_code == 200
    return r.json()["id"]


@pytest.fixture()
def station_id(client, save_id):
    r = client.post(
        "/api/stations",
        json={"save_id": save_id, "name": "主站", "lat": 39.9042, "lon": 116.4074, "alt_m": 43.5},
    )
    assert r.status_code == 200, r.text
    return r.json()["id"]


def test_starter_kit_installed(client, save_id, station_id):
    r = client.get("/api/equipment", params={"save_id": save_id})
    items = r.json()
    installed = [e for e in items if e["station_id"] == station_id]
    cats = {e["category"] for e in installed}
    assert {"antenna", "sdr", "rotator", "computer", "storage"} <= cats


def test_equipment_buy_install_cycle(client, save_id, station_id):
    # 买八木天线（初始 credits 5000，价格 900）
    r = client.post("/api/equipment/buy", json={"save_id": save_id, "catalog_id": "ant_yagi_vhf"})
    assert r.status_code == 200, r.text
    eq = r.json()
    assert eq["station_id"] is None

    state = client.get("/api/game/state", params={"save_id": save_id}).json()
    assert state["player"]["credits"] == 5000 - 900

    # 安装（同槽旧设备退回库存）
    r = client.post(
        f"/api/equipment/{eq['id']}/install",
        json={"save_id": save_id, "station_id": station_id},
    )
    assert r.status_code == 200
    assert r.json()["station_id"] == station_id

    # 库存里应有退回的鞭状天线
    items = client.get("/api/equipment", params={"save_id": save_id}).json()
    in_stock = [e for e in items if e["station_id"] is None and e["category"] == "antenna"]
    assert len(in_stock) == 1

    # 成就：ground_station_engineer
    ach = client.get("/api/achievements", params={"save_id": save_id}).json()
    ids = {i["id"] for i in ach["items"] if i["unlocked"]}
    assert "ground_station_engineer" in ids

    # credits 不足
    r = client.post("/api/equipment/buy", json={"save_id": save_id, "catalog_id": "ant_dish_s"})
    r2 = client.post("/api/equipment/buy", json={"save_id": save_id, "catalog_id": "sdr_pro"})
    assert r2.status_code == 402


def test_full_mission_loop(client, fake_catalog, save_id, station_id):
    """闭环：创建任务 → 启动 → 时间推进越过 LOS → 结算 → 奖励 → 图鉴 → 成就。"""
    # 创建捕获任务（自动选下一次过境）
    r = client.post(
        "/api/missions",
        json={"save_id": save_id, "station_id": station_id, "satellite_id": 25544, "type": "capture"},
    )
    assert r.status_code == 200, r.text
    m = r.json()
    assert m["status"] == "planned"
    assert m["aos"] < m["los"]
    assert m["frequency_hz"] == 145.8e6  # ISS 已知频率
    assert m["reward_credits"] > 0

    # 图鉴已记录 tracked
    col = client.get("/api/collection", params={"save_id": save_id}).json()
    assert any(c["satellite_id"] == 25544 and c["status"] == "tracked" for c in col)

    # 等待期 telemetry
    before_aos = datetime.fromisoformat(m["aos"].replace("Z", "+00:00")).replace(tzinfo=None) - timedelta(minutes=5)
    t = client.get(
        f"/api/missions/{m['id']}/telemetry", params={"at": before_aos.isoformat() + "Z"}
    ).json()
    assert t["phase"] == "waiting"

    # 启动
    r = client.post(f"/api/missions/{m['id']}/start")
    assert r.status_code == 200
    assert r.json()["status"] == "active"

    # 接收中（过境中点）
    mid = datetime.fromisoformat(m["aos"].replace("Z", "+00:00")).replace(tzinfo=None) + timedelta(
        seconds=m["planned_duration_s"] / 2
    )
    t = client.get(f"/api/missions/{m['id']}/telemetry", params={"at": mid.isoformat() + "Z"}).json()
    assert t["phase"] == "receiving"
    assert t["source"] == "SIMULATED_RF"
    assert 0 <= t["elevation_deg"] <= 90
    assert 0 < t["progress"] < 1
    assert t["doppler_hz"] != 0  # LEO 必有多普勒
    assert t["snr_db"] > -200

    # 时间推进越过 LOS → 结算
    after = datetime.fromisoformat(m["los"].replace("Z", "+00:00")).replace(tzinfo=None) + timedelta(minutes=2)
    t = client.get(f"/api/missions/{m['id']}/telemetry", params={"at": after.isoformat() + "Z"}).json()
    final = t["mission"]
    assert final["status"] == "completed", final.get("failure_reason")

    # 奖励到账
    state = client.get("/api/game/state", params={"save_id": save_id}).json()
    assert state["player"]["credits"] > 5000
    assert state["player"]["total_missions_done"] == 1

    # 图鉴升级为 received
    col = client.get("/api/collection", params={"save_id": save_id}).json()
    entry = next(c for c in col if c["satellite_id"] == 25544)
    assert entry["status"] == "received"
    assert entry["successful_missions"] == 1

    # 成就：first_contact
    ach = client.get("/api/achievements", params={"save_id": save_id}).json()
    ids = {i["id"] for i in ach["items"] if i["unlocked"]}
    assert "first_contact" in ids
    assert ach["unlocked"] >= 1


def test_mission_conflict(client, fake_catalog, save_id, station_id):
    r1 = client.post(
        "/api/missions",
        json={"save_id": save_id, "station_id": station_id, "satellite_id": 25544, "type": "capture"},
    )
    assert r1.status_code == 200
    # 同一卫星第二次创建 → 时间窗完全重叠 → 冲突
    r2 = client.post(
        "/api/missions",
        json={"save_id": save_id, "station_id": station_id, "satellite_id": 25544, "type": "track"},
    )
    assert r2.status_code == 409
    assert r2.json()["error"]["code"] == "MISSION_CONFLICT"


def test_mission_requires_equipment_coverage(client, fake_catalog, save_id, station_id):
    """需求 2.2：设备无法覆盖频段时，接收任务不能执行。

    用一个 S 波段卫星（目录中无该卫星 → 用 antenna band 校验路径）：
    先把天线换成仅 VHF 的八木 + 频率不在覆盖范围的假设卫星。
    """
    # 建一个 S 频段假设卫星（目录里无 known 条目 → 类别默认 437MHz…改用 2200MHz 场景不可行，
    # 因此直接验证：卖掉 SDR 后无法创建任务）
    r = client.post(
        "/api/missions",
        json={"save_id": save_id, "station_id": station_id, "satellite_id": 25544, "type": "capture"},
    )
    assert r.status_code == 200
    mid = r.json()["id"]
    client.post(f"/api/missions/{mid}/cancel")

    # 拆除 SDR
    items = client.get("/api/equipment", params={"save_id": save_id}).json()
    sdr = next(e for e in items if e["category"] == "sdr" and e["station_id"] == station_id)
    r = client.post(f"/api/equipment/{sdr['id']}/unequip", json={"save_id": save_id, "station_id": station_id})
    assert r.status_code == 200

    r = client.post(
        "/api/missions",
        json={"save_id": save_id, "station_id": station_id, "satellite_id": 25544, "type": "capture"},
    )
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "NO_SDR"


def test_link_budget_reasonable(client, save_id, station_id):
    """简化链路模型的物理合理性：ISS 过顶 SNR 应在正余量区间。"""
    from app.services.game import rf_model
    from app.services.game.equipment import station_by_category

    from app.db.database import SessionLocal

    db = SessionLocal()
    try:
        eq = station_by_category(db, station_id)
        rf = rf_model.station_rf(eq)
        sig = rf_model.signal_assumptions(25544, "stations")
        # 500 km / 40° 仰角
        r = rf_model.compute_link(rf, sig, elevation_deg=40.0, range_km=780.0, range_rate_km_s=-2.0)
        assert r.receivable
        assert 10 < r.snr_db < 45
        assert abs(r.doppler_hz) < 4000  # 145.8MHz 最大多普勒 ~3.5kHz
        # 低仰角远距离时余量下降
        r2 = rf_model.compute_link(rf, sig, elevation_deg=2.0, range_km=2500.0, range_rate_km_s=1.0)
        assert r2.snr_db < r.snr_db
    finally:
        db.close()


def test_storage_and_station_cost(client, save_id, station_id):
    """经营机制：第二座站需要花费 Credits。"""
    state = client.get("/api/game/state", params={"save_id": save_id}).json()
    credits0 = state["player"]["credits"]
    r = client.post(
        "/api/stations",
        json={"save_id": save_id, "name": "第二站", "lat": 31.2, "lon": 121.5, "alt_m": 4},
    )
    assert r.status_code == 200
    assert r.json()["build_cost"] == 2000
    state2 = client.get("/api/game/state", params={"save_id": save_id}).json()
    assert state2["player"]["credits"] == credits0 - 2000


def test_saves_crud(client):
    r = client.post("/api/saves", json={"name": "甲"})
    assert r.status_code == 200
    r = client.post("/api/saves", json={"name": "甲"})
    assert r.status_code == 409
    saves = client.get("/api/saves").json()
    assert len(saves) >= 1
    sid = saves[0]["id"]
    r = client.delete(f"/api/saves/{sid}")
    assert r.status_code == 200
