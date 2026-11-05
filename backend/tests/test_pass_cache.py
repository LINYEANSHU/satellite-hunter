"""过境预测缓存（精进阶段 F3）单元与集成测试。"""
from __future__ import annotations

import time
from datetime import datetime

import pytest

from app.services.orbit.catalog import GroupData, catalog_service
from app.services.orbit.omm import SatEntry
from app.services.orbit.pass_cache import PassForecastCache, floor_to

ISS_OMM = {
    "NORAD_CAT_ID": "25544",
    "OBJECT_NAME": "ISS (ZARYA)",
    "EPOCH": "2026-10-01T12:00:00.000000Z",
    "MEAN_MOTION": "15.50000000",
    "ECCENTRICITY": "0.0005000",
    "INCLINATION": "51.6400",
    "RA_OF_ASC_NODE": "120.0000",
    "ARG_OF_PERICENTER": "100.0000",
    "MEAN_ANOMALY": "0.0000",
    "BSTAR": "0.000030000",
    "MEAN_MOTION_DOT": "0.00003000",
    "MEAN_MOTION_DDOT": "0.0",
}

CSS_OMM = dict(ISS_OMM, NORAD_CAT_ID="48274", OBJECT_NAME="CSS (TIANHE)")


# ---------------------------------------------------------------- 单元
def test_floor_to_alignment():
    dt = datetime(2026, 5, 1, 12, 7, 43, 500000)
    f = floor_to(dt, 600.0)
    assert (f.hour, f.minute, f.second, f.microsecond) == (12, 0, 0, 0)
    # 边界：恰好在边界上保持不变
    assert floor_to(f, 600.0) == f
    # 跨日回绕
    assert floor_to(datetime(2026, 5, 1, 0, 0, 30), 600.0) == datetime(2026, 5, 1, 0, 0)


def test_cache_hit_and_isolation():
    cache = PassForecastCache(ttl_s=60)
    calls = []

    def compute():
        calls.append(1)
        return ["x"]

    k1 = ("a", 1)
    r1 = cache.get_or_compute(k1, compute)
    r2 = cache.get_or_compute(k1, compute)
    assert r1 == r2 == ["x"]
    assert len(calls) == 1  # 第二次命中缓存，不再计算

    # 命中返回浅拷贝：修改返回列表不影响缓存内容
    r2.append("y")
    r3 = cache.get_or_compute(k1, compute)
    assert r3 == ["x"]

    # 不同键互不命中
    r4 = cache.get_or_compute(("a", 2), compute)
    assert len(calls) == 2
    assert r4 == ["x"]


def test_cache_ttl_expiry(monkeypatch):
    cache = PassForecastCache(ttl_s=10)
    now = {"t": 1000.0}
    monkeypatch.setattr(time, "time", lambda: now["t"])
    calls = []
    cache.get_or_compute(("k",), lambda: calls.append(1) or [1])
    now["t"] = 1005.0
    cache.get_or_compute(("k",), lambda: calls.append(1) or [1])
    assert len(calls) == 1  # TTL 内命中
    now["t"] = 1015.0
    cache.get_or_compute(("k",), lambda: calls.append(1) or [1])
    assert len(calls) == 2  # TTL 过期重算


# ---------------------------------------------------------------- 集成（API 层）
@pytest.fixture(autouse=True)
def _clean_pass_cache():
    """pass_forecast_cache 是进程级单例：清理前后状态，避免测试间污染
    （同进程内其他测试可能已缓存同一对齐窗口）。"""
    from app.services.orbit.pass_cache import pass_forecast_cache

    pass_forecast_cache.clear()
    yield
    pass_forecast_cache.clear()


@pytest.fixture()
def fake_stations_group(monkeypatch):
    entries = [
        SatEntry(
            norad_id=25544, name="ISS (ZARYA)", omm=ISS_OMM, groups={"stations"},
            epoch=datetime(2026, 10, 1, 12, 0, 0),
        ),
        SatEntry(
            norad_id=48274, name="CSS (TIANHE)", omm=CSS_OMM, groups={"stations"},
            epoch=datetime(2026, 10, 1, 12, 0, 0),
        ),
    ]
    data = GroupData(group="stations", entries=entries, fetched_at=time.time(), stale=False)
    monkeypatch.setattr(catalog_service, "get_group", lambda g, force=False: data)
    monkeypatch.setattr(
        catalog_service, "find",
        lambda nid, group=None: next((e for e in entries if e.norad_id == nid), None),
    )
    return entries


def test_single_sat_passes_cached(client, fake_stations_group, monkeypatch):
    from app.services.orbit import passes as passes_mod

    real = passes_mod.predict_passes
    calls = {"n": 0}

    def counting(*a, **kw):
        calls["n"] += 1
        return real(*a, **kw)

    monkeypatch.setattr(passes_mod, "predict_passes", counting)

    params = {"lat": 39.9, "lon": 116.4, "hours": 48, "min_el": 5}
    r1 = client.get("/api/satellites/25544/passes", params=params)
    assert r1.status_code == 200
    n_first = calls["n"]
    assert n_first >= 1

    r2 = client.get("/api/satellites/25544/passes", params=params)
    assert r2.status_code == 200
    assert calls["n"] == n_first  # 第二次命中缓存，未重算
    assert r1.json()["passes"] == r2.json()["passes"]


def test_station_passes_cached(client, fake_stations_group, monkeypatch):
    from app.db.database import db_session
    from app.db.models import PlayerState, Save, Station

    with db_session() as db:
        s = Save(name="过境缓存存档")
        db.add(s)
        db.flush()
        db.add(PlayerState(save_id=s.id))
        st = Station(save_id=s.id, name="缓存站", lat=39.9, lon=116.4, alt_m=0.0)
        db.add(st)
        db.flush()
        sid = st.id

    from app.services.orbit import passes as passes_mod

    real = passes_mod.predict_passes
    calls = {"n": 0}

    def counting(*a, **kw):
        calls["n"] += 1
        return real(*a, **kw)

    monkeypatch.setattr(passes_mod, "predict_passes", counting)

    r1 = client.get(f"/api/stations/{sid}/passes", params={"group": "stations", "hours": 48})
    assert r1.status_code == 200
    n_first = calls["n"]
    assert n_first >= 1

    r2 = client.get(f"/api/stations/{sid}/passes", params={"group": "stations", "hours": 48})
    assert r2.status_code == 200
    assert calls["n"] == n_first
    assert r1.json()["passes"] == r2.json()["passes"]

    # 改变参数（hours）→ 新键 → 重新计算
    r3 = client.get(f"/api/stations/{sid}/passes", params={"group": "stations", "hours": 24})
    assert r3.status_code == 200
    assert calls["n"] > n_first
