"""Phase 1 轨道核心测试。

参考值来源：
- SGP4：Vallado "Revisiting Spacetrack Report #3" 标准测试用例（TLE 00005），
  期望值 = python-sgp4（参考实现移植）在该用例上的输出，已人工验证。
- GMST：IAU-1982 定义值（J2000.0 时刻）。
- 大地坐标：WGS84 定义值。
"""
from __future__ import annotations

import math
from datetime import datetime

import numpy as np
import pytest
from sgp4.api import Satrec, jday

from app.services.orbit import transforms as tf
from app.services.orbit.omm import parse_tle_text, satrec_from_omm, satrec_from_tle

VALLADO_L1 = "1 00005U 58002B   00179.78495062  .00000023  00000-0  28098-4 0  4753"
VALLADO_L2 = "2 00005  34.2682 348.7242 1859667 331.7664  19.3264 10.82419157413667"

# python-sgp4 参考实现输出（t=0，WGS72）——本项目回归锚点
REF_R = np.array([7022.4652927, -1400.0829676, 0.0399516])
REF_V = np.array([1.893841, 6.4058938, 4.5348073])


@pytest.fixture()
def vallado_sat() -> Satrec:
    return Satrec.twoline2rv(VALLADO_L1, VALLADO_L2)


def vallado_omm() -> dict:
    """由 Vallado TLE 构造等价 OMM 字段（用于 OMM→sgp4init 等价性验证）。

    历元 00179.78495062（2000 年第 179.78495 天）= 2000-06-27T18:50:19.733568Z
    """
    return {
        "NORAD_CAT_ID": "5",
        "EPOCH": "2000-06-27T18:50:19.733568Z",
        "MEAN_MOTION": "10.82419157",
        "ECCENTRICITY": "0.1859667",
        "INCLINATION": "34.2682",
        "RA_OF_ASC_NODE": "348.7242",
        "ARG_OF_PERICENTER": "331.7664",
        "MEAN_ANOMALY": "19.3264",
        "BSTAR": "0.000028098",
        "MEAN_MOTION_DOT": "0.00000023",
        "MEAN_MOTION_DDOT": "0.000000000000000E+00",
    }


# ---------------------------------------------------------------- SGP4
def test_sgp4_reference_values(vallado_sat):
    e, r, v = vallado_sat.sgp4(vallado_sat.jdsatepoch, vallado_sat.jdsatepochF)
    assert e == 0
    assert np.allclose(r, REF_R, atol=1e-6)
    assert np.allclose(v, REF_V, atol=1e-6)


def test_omm_sgp4init_equivalent_to_tle():
    """OMM→sgp4init 与 TLE→twoline2rv 必须给出一致结果（核心正确性）。"""
    sat_tle = satrec_from_tle(VALLADO_L1, VALLADO_L2)
    sat_omm = satrec_from_omm(vallado_omm())

    for dt_min in (0, 30, 100, 720, 1440):
        jd, fr = jday(2000, 6, 27, 18, 50, 19.733568 + dt_min * 60.0)
        e1, r1, v1 = sat_tle.sgp4(jd, fr)
        e2, r2, v2 = sat_omm.sgp4(jd, fr)
        assert e1 == 0 and e2 == 0
        # 1 米容差：历元经 datetime→jday 路径存在双精度末位舍入；
        # 单位换算错误的偏差为千公里级，此容差仍具有强判别力
        assert np.allclose(r1, r2, atol=1e-3), f"t={dt_min}min 位置差异过大: {np.abs(np.array(r1) - np.array(r2)).max()} km"
        assert np.allclose(v1, v2, atol=1e-6)


def test_sgp4_energy_sanity(vallado_sat):
    """一个轨道周期后比轨道能量应守恒（SGP4 无外部做功，阻力项单圈影响极小）。"""
    MU = 398600.4418  # km³/s²
    jd0, fr0 = vallado_sat.jdsatepoch, vallado_sat.jdsatepochF
    e, r0, v0 = vallado_sat.sgp4(jd0, fr0)
    period_min = 1440.0 / 10.82419157
    e, r1, v1 = vallado_sat.sgp4(jd0, fr0 + period_min / 1440.0)
    assert e == 0

    def energy(r, v):
        return float(np.dot(v, v)) / 2.0 - MU / float(np.linalg.norm(r))

    assert abs(energy(r1, v1) - energy(r0, v0)) < 0.5  # km²/s²
    assert 5.0 < float(np.linalg.norm(v1)) < 12.0  # 介于近/远地点速度之间


# ---------------------------------------------------------------- GMST / 时间
def test_gmst_j2000_definitional():
    # IAU-82 定义：J2000.0 (JD 2451545.0) GMST = 280.46061837°
    assert abs(tf.gmst_deg(2451545.0) - 280.46061837) < 1e-8


def test_gmst_one_solar_day():
    # 一个恒星日后 GMST 增加约 360.9856°
    g0 = tf.gmst_deg(2451545.0)
    g1 = tf.gmst_deg(2451545.0 + 1.0)
    delta = (g1 - g0) % 360.0
    assert abs(delta - 360.98564736629 % 360.0) < 1e-6


# ---------------------------------------------------------------- 大地坐标
def test_geodetic_known_point():
    # 赤道本初子午线海平面 → (a, 0, 0)
    r = tf.geodetic_to_ecef(0.0, 0.0, 0.0)
    assert np.allclose(r, [6378.137, 0.0, 0.0], atol=1e-6)


def test_geodetic_roundtrip():
    cases = [
        (39.9042, 116.4074, 0.0435),   # 北京
        (0.0, 121.5, 0.0),             # 赤道
        (-33.8688, 151.2093, 0.058),   # 悉尼
        (89.0, 0.0, 0.1),              # 近极点
        (-45.0, -73.0, 1.2),           # 高海拔
    ]
    for lat, lon, alt in cases:
        ecef = tf.geodetic_to_ecef(lat, lon, alt)
        lat2, lon2, alt2 = tf.ecef_to_geodetic(ecef)
        assert abs(lat2 - lat) < 1e-9
        assert abs(lon2 - lon) < 1e-9
        assert abs(alt2 - alt) < 1e-6


def test_teme_to_ecef_axis_rotation():
    # gmst=0 时 TEME 与 ECEF 重合
    r = np.array([7000.0, 0.0, 0.0])
    r_ecef, _ = tf.teme_to_ecef(r, None, 0.0)
    assert np.allclose(r_ecef, r)
    # gmst=90° 时 ECEF x 轴对应 TEME y 轴方向
    r_ecef, _ = tf.teme_to_ecef(np.array([0.0, 7000.0, 0.0]), None, 90.0)
    assert np.allclose(r_ecef, [7000.0, 0.0, 0.0], atol=1e-9)


# ---------------------------------------------------------------- 观察角
def test_geostationary_overhead():
    """站位于 GEO 星下点赤道上 → 仰角 90°，距离 ≈ 35786 km。"""
    lat, lon, alt = 0.0, 100.0, 0.0
    station = tf.geodetic_to_ecef(lat, lon, alt)
    # GEO 半径 ≈ 42164 km
    r_geo = tf.geodetic_to_ecef(0.0, lon, 42164.0 - 6378.137)
    la = tf.look_angles(station, r_geo)
    assert abs(la.elevation_deg - 90.0) < 0.05
    assert abs(la.range_km - 42164.0 + 6378.137) < 2.0


def test_look_angle_azimuth_north():
    """卫星在站点正北方向地平面上 → 方位角 0°。"""
    lat, lon, alt = 45.0, 120.0, 0.0
    station = tf.geodetic_to_ecef(lat, lon, alt)
    # 北方向 1000 km 处的点（沿经线向北）
    target = tf.geodetic_to_ecef(lat + 9.0, lon, 0.0)
    la = tf.look_angles(station, target)
    assert abs(la.azimuth_deg) < 0.5 or abs(la.azimuth_deg - 360) < 0.5
    assert la.elevation_deg < 0  # 远处地平点应在地平线下


def test_fspl_reference():
    # FSPL(1000 km, 437 MHz) = 32.44 + 60 + 52.81 ≈ 145.25 dB
    assert abs(tf.fspl_db(1000.0, 437.0) - 145.25) < 0.01
    # FSPL(2000 km, 437 MHz) 应增加 6.02 dB
    assert abs(tf.fspl_db(2000.0, 437.0) - tf.fspl_db(1000.0, 437.0) - 6.02) < 0.01


def test_doppler_sign():
    # 接近（range_rate<0）→ 频移为正
    fd = tf.doppler_shift_hz(437e6, -6.0)
    assert fd > 0
    # ISS 过顶典型多普勒 ±3-4 kHz @ 437 MHz
    assert 2000 < abs(fd) < 10000


# ---------------------------------------------------------------- TLE/OMM 解析
def test_parse_tle_text():
    text = f"ISS (ZARYA)\n{VALLADO_L1}\n{VALLADO_L2}"
    entries = parse_tle_text(text)
    assert len(entries) == 1
    e = entries[0]
    assert e.norad_id == 5
    assert e.name == "ISS (ZARYA)"
    assert e.origin == "tle_import"


def test_parse_tle_no_name():
    entries = parse_tle_text(f"{VALLADO_L1}\n{VALLADO_L2}")
    assert len(entries) == 1
    assert entries[0].norad_id == 5


def test_omm_over_5_digit_catalog():
    """目录号超过 5 位（需求硬性要求）：OMM 路径天然支持。

    注：SGP4 库内部使用 Alpha-5 编码，上限 339999（'Z9999'）。
    当前 NORAD 目录约 6 万号，此限制数十年内不会触及；OMM/图鉴层
    的目录号本身仍是完整整数。
    """
    omm = vallado_omm()
    omm["NORAD_CAT_ID"] = "100234"
    sat = satrec_from_omm(omm)
    assert sat.satnum == 100234
    jd, fr = jday(2000, 6, 27, 18, 50, 19.733568)
    e, r, _ = sat.sgp4(jd, fr)
    assert e == 0
    assert np.allclose(r, REF_R, atol=1e-3)  # ≤1m（历元路径舍入）
