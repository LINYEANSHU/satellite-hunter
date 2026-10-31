"""卫星/地面站 API 集成测试（目录数据离线注入，不访问网络）。"""
from __future__ import annotations

import json
import time

import pytest

from app.services.orbit.catalog import GroupData, catalog_service
from app.services.orbit.omm import SatEntry

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

CSS_OMM = {
    "NORAD_CAT_ID": "48274",
    "OBJECT_NAME": "CSS (TIANHE)",
    "EPOCH": "2026-10-01T12:00:00.000000Z",
    "MEAN_MOTION": "15.60000000",
    "ECCENTRICITY": "0.0004000",
    "INCLINATION": "41.4700",
    "RA_OF_ASC_NODE": "100.0000",
    "ARG_OF_PERICENTER": "80.0000",
    "MEAN_ANOMALY": "10.0000",
    "BSTAR": "0.000020000",
    "MEAN_MOTION_DOT": "0.00001000",
    "MEAN_MOTION_DDOT": "0.0",
}


@pytest.fixture()
def fake_stations_group(monkeypatch):
    """将 stations 分组替换为离线样例数据。"""
    entries = [
        SatEntry(norad_id=25544, name="ISS (ZARYA)", omm=ISS_OMM, groups={"stations"},
                 epoch=__import__("datetime").datetime(2026, 10, 1, 12, 0, 0)),
        SatEntry(norad_id=48274, name="CSS (TIANHE)", omm=CSS_OMM, groups={"stations"},
                 epoch=__import__("datetime").datetime(2026, 10, 1, 12, 0, 0)),
    ]
    data = GroupData(group="stations", entries=entries, fetched_at=time.time(), stale=False)
    monkeypatch.setattr(catalog_service, "get_group", lambda g, force=False: data)
    monkeypatch.setattr(
        catalog_service, "find",
        lambda nid, group=None: next((e for e in entries if e.norad_id == nid), None),
    )
    return entries


def test_list_satellites(client, fake_stations_group):
    r = client.get("/api/satellites", params={"group": "stations"})
    assert r.status_code == 200
    body = r.json()
    assert body["total"] == 2
    assert body["items"][0]["name"] in ("ISS (ZARYA)", "CSS (TIANHE)")
    assert body["items"][0]["source"] == "REAL_ORBIT"


def test_list_satellites_search(client, fake_stations_group):
    r = client.get("/api/satellites", params={"group": "stations", "q": "zarya"})
    body = r.json()
    assert body["total"] == 1
    assert body["items"][0]["norad_id"] == 25544
    r = client.get("/api/satellites", params={"group": "stations", "q": "25544"})
    assert r.json()["total"] == 1


def test_satellite_detail(client, fake_stations_group):
    r = client.get("/api/satellites/25544")
    assert r.status_code == 200
    body = r.json()
    assert body["name"] == "ISS (ZARYA)"
    assert body["position"]["error"] == 0
    assert 380 < body["position"]["alt_km"] < 480
    assert body["source"] == "REAL_ORBIT"


def test_satellite_404(client, fake_stations_group):
    r = client.get("/api/satellites/99999")
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "SATELLITE_NOT_FOUND"


def test_satellite_track(client, fake_stations_group):
    r = client.get("/api/satellites/25544/track", params={"minutes": 30, "step_s": 300})
    assert r.status_code == 200
    points = r.json()["points"]
    assert len(points) == 13  # 前后各 30 分钟、5 分钟步长
    assert all("ecef_km" in p and "lat" in p for p in points)


def test_satellite_passes_with_coords(client, fake_stations_group):
    r = client.get(
        "/api/satellites/25544/passes",
        params={"lat": 39.9, "lon": 116.4, "hours": 48, "min_el": 5},
    )
    assert r.status_code == 200
    passes = r.json()["passes"]
    assert len(passes) >= 1
    p = passes[0]
    assert p["aos"] < p["tca"] < p["los"]
    assert p["max_elevation_deg"] >= 5


def test_import_tle(client):
    r = client.post(
        "/api/satellites/import_tle",
        json={"text": "TESTSAT\n1 88888U 20001A   00179.78495062  .00000023  00000-0  28098-4 0  4750\n2 88888  34.2682 348.7242 1859667 331.7664  19.3264 10.82419157413661"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["imported"] == 1
    assert body["items"][0]["norad_id"] == 88888


@pytest.fixture()
def save_id(client):
    """通过应用数据库直接创建一个存档，返回其 id。"""
    from app.db.database import db_session
    from app.db.models import Save

    with db_session() as db:
        s = Save(name="测试存档")
        db.add(s)
        db.flush()
        return s.id


def test_station_crud_and_passes(client, fake_stations_group, save_id):
    # 建站
    r = client.post(
        "/api/stations",
        json={"save_id": save_id, "name": "北京站", "lat": 39.9042, "lon": 116.4074, "alt_m": 43.5},
    )
    assert r.status_code == 200
    st = r.json()
    assert st["name"] == "北京站"
    assert st["is_virtual"] is True
    assert st["min_elevation_deg"] == 5.0

    # 列表
    r = client.get("/api/stations", params={"save_id": save_id})
    assert len(r.json()) == 1

    # 更新
    r = client.patch(f"/api/stations/{st['id']}", json={"min_elevation_deg": 10.0, "name": "BJ-1"})
    assert r.json()["min_elevation_deg"] == 10.0
    assert r.json()["name"] == "BJ-1"

    # 站过境（使用注入的假分组）
    r = client.get(f"/api/stations/{st['id']}/passes", params={"hours": 48})
    assert r.status_code == 200
    body = r.json()
    assert body["satellites_computed"] == 2
    assert body["min_elevation_deg"] == 10.0

    # 删除
    r = client.delete(f"/api/stations/{st['id']}")
    assert r.json()["deleted"] == st["id"]
    r = client.get("/api/stations", params={"save_id": save_id})
    assert r.json() == []


def test_station_404(client, fake_stations_group):
    r = client.get("/api/stations/nope/passes")
    assert r.status_code == 404


def test_station_validation(client):
    r = client.post(
        "/api/stations",
        json={"save_id": "s1", "name": "x", "lat": 91.0, "lon": 0},
    )
    assert r.status_code == 422  # pydantic 校验
