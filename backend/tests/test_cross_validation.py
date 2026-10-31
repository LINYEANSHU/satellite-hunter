"""独立实现交叉验证：本项目轨道链路 vs Skyfield（成熟独立库）。

Skyfield 内部使用同一 SGP4 核心，但其时间系统、TEME→ITRF 转换、
大地坐标与地平坐标（az/el）均为独立实现，可有效交叉验证本项目
自写的 GMST 旋转与观察角代码。

运行方式：pytest tests/test_cross_validation.py（需要网络下载 de421.bsp；
若已缓存到 tests/data 则离线可用）。
"""
from __future__ import annotations

import os
from datetime import datetime, timedelta

import numpy as np
import pytest
from sgp4.api import Satrec

from app.services.orbit import passes as passes_mod
from app.services.orbit import transforms as tf
from app.services.orbit.omm import satrec_from_omm

ISS_OMM = {
    "NORAD_CAT_ID": "25544",
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

BEIJING = (39.9042, 116.4074, 0.0435)

skyfield = pytest.importorskip("skyfield.api")


@pytest.fixture(scope="module")
def skyfield_earth():
    from skyfield.api import Loader, wgs84

    data_dir = os.path.join(os.path.dirname(__file__), "data")
    os.makedirs(data_dir, exist_ok=True)
    load = Loader(data_dir, verbose=False)
    ts = load.timescale()
    # de421.bsp 约 17MB，首次运行下载后缓存
    eph = load("de421.bsp")
    return ts, wgs84, eph


def test_position_cross_check_skyfield(skyfield_earth):
    """与 Skyfield 对比 ISS 在多个时刻的地心距与星下点（<2km / <0.05°）。"""
    ts, wgs84, _ = skyfield_earth
    sat = Satrec.twoline2rv(
        "1 25544U 98067A   24060.54791435  .00021331  00000+0  38585-3 0  9995",
        "2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.72125391563537",
    )
    mine = sat

    sky = skyfield.EarthSatellite(
        "1 25544U 98067A   24060.54791435  .00021331  00000+0  38585-3 0  9995",
        "2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.72125391563537",
        "ISS",
        ts,
    )

    base = datetime(2024, 3, 1, 12, 0, 0)
    for offset_h in (0, 6, 24, 72):
        t = base + timedelta(hours=offset_h)
        # 本项目链路
        jd, fr = tf.jday_utc(t)
        err, r_teme, _ = mine.sgp4(jd, fr)
        assert err == 0
        r_ecef, _ = tf.teme_to_ecef(r_teme, None, tf.gmst_deg(jd + fr))
        lat, lon, alt = tf.ecef_to_geodetic(r_ecef)
        # Skyfield 链路
        st = ts.utc(t.year, t.month, t.day, t.hour, t.minute, t.second)
        geo = sky.at(st)
        sp = wgs84.geographic_position_of(geo)
        sky_lat, sky_lon = sp.latitude.degrees, sp.longitude.degrees
        sky_alt = sp.elevation.km
        sky_r = np.linalg.norm(geo.position.km)

        assert abs(alt - sky_alt) < 2.0, f"t+{offset_h}h 高度差 {abs(alt-sky_alt):.3f} km"
        assert abs(np.linalg.norm(r_ecef) - sky_r) < 2.0
        # 星下点经度差（处理 ±180 环绕）
        dlon = abs(((lon - sky_lon + 180) % 360) - 180)
        assert dlon < 0.05, f"t+{offset_h}h 经度差 {dlon:.4f}°"
        assert abs(lat - sky_lat) < 0.05


def test_look_angle_cross_check_skyfield(skyfield_earth):
    """与 Skyfield 对比北京站看 ISS 的方位/仰角（<0.3°）。"""
    ts, wgs84, _ = skyfield_earth
    l1 = "1 25544U 98067A   24060.54791435  .00021331  00000+0  38585-3 0  9995"
    l2 = "2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.72125391563537"
    mine = Satrec.twoline2rv(l1, l2)
    sky = skyfield.EarthSatellite(l1, l2, "ISS", ts)
    station = tf.geodetic_to_ecef(*BEIJING)
    observer = wgs84.latlon(*BEIJING[:2], elevation_m=BEIJING[2] * 1000)

    base = datetime(2024, 3, 1, 12, 0, 0)
    checked = 0
    for offset_min in range(0, 24 * 60, 7):  # 7 分钟步长扫一天
        t = base + timedelta(minutes=offset_min)
        jd, fr = tf.jday_utc(t)
        err, r_teme, v_teme = mine.sgp4(jd, fr)
        if err:
            continue
        r_ecef, v_ecef = tf.teme_to_ecef(r_teme, v_teme, tf.gmst_deg(jd + fr))
        la = tf.look_angles(station, r_ecef, v_ecef)
        if la.elevation_deg < 5:
            continue  # 只比较可见时段
        st = ts.utc(t.year, t.month, t.day, t.hour, t.minute, t.second)
        diff = sky - observer
        alt_, az_, _ = diff.at(st).altaz()
        assert abs(la.elevation_deg - alt_.degrees) < 0.3, f"el diff {abs(la.elevation_deg-alt_.degrees):.3f}"
        daz = abs(((la.azimuth_deg - az_.degrees + 180) % 360) - 180)
        assert daz < 0.3, f"az diff {daz:.3f}"
        checked += 1
    assert checked >= 2, "一天内北京站应至少有 2 段可见弧段"


def test_pass_prediction_cross_check_skyfield(skyfield_earth):
    """与 Skyfield find_events 对比 48h 过境次数与 AOS 时刻（<60s）。"""
    from skyfield.api import wgs84

    ts, wgs84, _ = skyfield_earth
    l1 = "1 25544U 98067A   24060.54791435  .00021331  00000+0  38585-3 0  9995"
    l2 = "2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.72125391563537"
    mine = Satrec.twoline2rv(l1, l2)
    sky = skyfield.EarthSatellite(l1, l2, "ISS", ts)
    observer = wgs84.latlon(*BEIJING[:2], elevation_m=BEIJING[2] * 1000)

    start = datetime(2024, 3, 1, 0, 0, 0)
    end = start + timedelta(hours=48)

    mine_passes = passes_mod.predict_passes(mine, 25544, *BEIJING, start, end, 10.0)
    t0, t1 = ts.utc(*start.timetuple()[:6]), ts.utc(*end.timetuple()[:6])
    times, events = sky.find_events(observer, t0, t1, altitude_degrees=10.0)
    sky_rises = [
        t.utc_datetime().replace(tzinfo=None)  # 转为 naive UTC 与本项目一致
        for t, e in zip(times, events)
        if e == 0  # 0=rise
    ]

    assert len(mine_passes) == len(sky_rises), (
        f"过境次数不一致: mine={len(mine_passes)} skyfield={len(sky_rises)}"
    )
    for mp, sr in zip(mine_passes, sky_rises):
        diff_s = abs((mp.aos - sr).total_seconds())
        assert diff_s < 60, f"AOS 相差 {diff_s:.1f}s"
