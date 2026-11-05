"""成就增强（精进阶段 F4）：夜过境判定修复 + 新成就解锁路径。"""
from __future__ import annotations

from datetime import datetime, timedelta

import pytest

from app.services.game.achievements import _night_missions, _sun_elevation_deg


def test_sun_elevation_known_points():
    # 北京（39.9N, 116.4E）夏至正午（UTC 04:00 ≈ 地方时 12:00）→ 高角约 70°+
    noon = _sun_elevation_deg(39.9, 116.4, datetime(2026, 6, 21, 4, 0))
    assert 65.0 < noon < 80.0
    # 北京冬至午夜（UTC 16:00 ≈ 地方时 0:00）→ 深夜
    midnight = _sun_elevation_deg(39.9, 116.4, datetime(2026, 1, 1, 16, 0))
    assert midnight < -60.0
    # 天文黄昏阈值 -6°：太阳刚落下后不久
    dusk = _sun_elevation_deg(39.9, 116.4, datetime(2026, 6, 21, 12, 30))
    assert dusk < 0.0


class _M:
    def __init__(self, station_id, ended_at, status="completed"):
        self.station_id = station_id
        self.ended_at = ended_at
        self.status = status


class _S:
    def __init__(self, sid, lat, lon):
        self.id = sid
        self.lat = lat
        self.lon = lon


def test_night_missions_counter():
    stations = [_S("st1", 39.9, 116.4)]
    # 北京 2026-01-01 16:00 UTC = 地方时 0:00 → 夜
    night = datetime(2026, 1, 1, 16, 0)
    day = datetime(2026, 1, 1, 4, 0)  # 地方时 12:00 → 昼
    ms = [
        _M("st1", night),
        _M("st1", night + timedelta(hours=1)),
        _M("st1", day),
        _M("st1", night, status="failed"),  # 失败不计
        _M("st2", night),  # 未知站不计
    ]
    assert _night_missions(ms, stations) == 2


@pytest.fixture()
def save_and_station(client):
    """创建存档 + 地面站（走数据库直插，与既有测试同风格）。"""
    from app.db.database import db_session
    from app.db.models import PlayerState, Save, Station

    with db_session() as db:
        s = Save(name="成就增强存档")
        db.add(s)
        db.flush()
        db.add(PlayerState(save_id=s.id))
        st = Station(save_id=s.id, name="夜观站", lat=39.9, lon=116.4, alt_m=0.0)
        db.add(st)
        db.flush()
        sid = s.id
        stid = st.id
    return sid, stid


def _mk_mission(save_id, station_id, ended_at, data_mb=1.0, sat=25544):
    return dict(
        save_id=save_id,
        station_id=station_id,
        satellite_id=sat,
        satellite_name="ISS (ZARYA)",
        type="capture",
        status="completed",
        ended_at=ended_at,
        data_produced_mb=data_mb,
        max_elevation_deg=45.0,
    )


def _check(client, save_id) -> list[str]:
    r = client.post(f"/api/achievements/check?save_id={save_id}")
    assert r.status_code == 200
    return r.json()["unlocked"]


def test_night_watch_unlocks(client, save_and_station):
    from app.db.database import db_session
    from app.db.models import Mission

    save_id, stid = save_and_station
    with db_session() as db:
        db.add(Mission(**_mk_mission(save_id, stid, datetime(2026, 1, 1, 16, 0))))
    unlocked = _check(client, save_id)
    assert "night_watch" in unlocked
    # 幂等：重复检查不重复解锁
    assert "night_watch" not in _check(client, save_id)


def test_first_decode_and_data_titan(client, save_and_station):
    from app.db.database import db_session
    from app.db.models import CollectionItem, Mission

    save_id, stid = save_and_station
    with db_session() as db:
        db.add(
            CollectionItem(
                save_id=save_id,
                kind="decoded_image",
                source="DECODED_OUTPUT",
                title="NOAA 图像",
            )
        )
        db.add(Mission(**_mk_mission(save_id, stid, datetime(2026, 1, 2, 12, 0), data_mb=1200.0)))
    unlocked = _check(client, save_id)
    assert "first_decode" in unlocked
    assert "data_titan" in unlocked


def test_streak20_and_centurion(client, save_and_station):
    from app.db.database import db_session
    from app.db.models import Mission

    save_id, stid = save_and_station
    base = datetime(2026, 1, 1, 0, 0)
    with db_session() as db:
        for i in range(20):
            db.add(
                Mission(
                    **_mk_mission(
                        save_id, stid, base + timedelta(hours=i), data_mb=1.0, sat=25544 + (i % 2)
                    )
                )
            )
        for i in range(100):
            db.add(
                Mission(
                    **_mk_mission(
                        save_id,
                        stid,
                        base + timedelta(days=1, minutes=i),
                        data_mb=0.5,
                        sat=25544 + (i % 2),
                    )
                )
            )
    unlocked = _check(client, save_id)
    assert "streak_20" in unlocked
    assert "centurion" in unlocked


def test_new_definitions_present():
    from app.services.game.achievements import ACHIEVEMENTS

    for aid in ("first_decode", "data_titan", "streak_20", "centurion"):
        assert aid in ACHIEVEMENTS, f"缺少成就定义 {aid}"
    assert "night_missions" in {c["condition"]["type"] for c in ACHIEVEMENTS.values()}
