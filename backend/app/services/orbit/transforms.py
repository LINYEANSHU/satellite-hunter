"""坐标与时间转换。

约定：
- TEME: SGP4 输出的地心惯性坐标系（km, km/s）
- ECEF: 地心地固直角坐标（km）
- geodetic: WGS84 大地坐标（纬度/经度 deg，海拔 km）
- 方位角: 从正北顺时针 0-360°；仰角: 地平线起算，可为负
- 时间一律使用 UTC

TEME→ECEF 采用 GMST 旋转（IAU-82），与 skyfield/gpredict 等工具一致；
速度转换包含地球自转牵连项 ω×r。参考锚点见 tests/test_transforms.py。
"""
from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

# WGS84 常数（km）
WGS84_A = 6378.137
WGS84_F = 1.0 / 298.257223563
WGS84_E2 = WGS84_F * (2.0 - WGS84_F)
# 地球自转角速度 rad/s（WGS84）
EARTH_OMEGA = 7.292115146706979e-5

_DEG = math.pi / 180.0
_RAD = 180.0 / math.pi


def gmst_deg(jd_ut1: float) -> float:
    """格林尼治平恒星时（度）。jd 为 UT1 儒略日（对游戏精度 UTC≈UT1 足够）。

    IAU-1982 公式，J2000.0 时刻返回定义值 280.46061837°。
    """
    d = jd_ut1 - 2451545.0
    t = d / 36525.0
    g = 280.46061837 + 360.98564736629 * d + 0.000387933 * t * t - t * t * t / 38710000.0
    return g % 360.0


def gmst_deg_array(jd, fr):
    """gmst_deg 的向量化版本（numpy 批量），公式完全一致。

    jd/fr 为等长数组（儒略日整数与小数部分），返回度数组。热路径避免
    逐点 Python 循环。
    """
    jd = np.asarray(jd, dtype=float)
    fr = np.asarray(fr, dtype=float)
    d = (jd + fr) - 2451545.0
    t = d / 36525.0
    g = 280.46061837 + 360.98564736629 * d + 0.000387933 * t * t - t * t * t / 38710000.0
    return np.mod(g, 360.0)


def jday_utc(dt) -> tuple[float, float]:
    """datetime(UTC, naive) → (jd 整数部分, 小数部分)。与 sgp4.api.jday 一致。"""
    from sgp4.api import jday

    return jday(dt.year, dt.month, dt.day, dt.hour, dt.minute, dt.second + dt.microsecond / 1e6)


def teme_to_ecef(
    r_teme: np.ndarray, v_teme: np.ndarray | None, gmst: float
) -> tuple[np.ndarray, np.ndarray | None]:
    """TEME → ECEF。gmst 单位为度。支持批量 (N,3)。

    r_ecef = Rz(gmst) · r_teme
    v_ecef = Rz(gmst) · v_teme - ω × r_ecef
    """
    theta = gmst * _DEG
    c, s = math.cos(theta), math.sin(theta)
    r = np.asarray(r_teme, dtype=float)
    x, y, z = r[..., 0], r[..., 1], r[..., 2]
    r_ecef = np.empty_like(r)
    r_ecef[..., 0] = c * x + s * y
    r_ecef[..., 1] = -s * x + c * y
    r_ecef[..., 2] = z

    if v_teme is None:
        return r_ecef, None
    v = np.asarray(v_teme, dtype=float)
    vx, vy, vz = v[..., 0], v[..., 1], v[..., 2]
    v_inert = np.empty_like(v)
    v_inert[..., 0] = c * vx + s * vy
    v_inert[..., 1] = -s * vx + c * vy
    v_inert[..., 2] = vz
    # 牵连速度 -ω × r（地球自转角速度绕 Z 轴）
    omega = EARTH_OMEGA  # rad/s；速度单位 km/s，r 单位 km
    v_ecef = v_inert.copy()
    v_ecef[..., 0] += omega * r_ecef[..., 1]
    v_ecef[..., 1] -= omega * r_ecef[..., 0]
    return r_ecef, v_ecef


def geodetic_to_ecef(lat_deg: float, lon_deg: float, alt_km: float) -> np.ndarray:
    """WGS84 大地坐标 → ECEF（km）。"""
    lat = lat_deg * _DEG
    lon = lon_deg * _DEG
    n = WGS84_A / math.sqrt(1.0 - WGS84_E2 * math.sin(lat) ** 2)
    x = (n + alt_km) * math.cos(lat) * math.cos(lon)
    y = (n + alt_km) * math.cos(lat) * math.sin(lon)
    z = (n * (1.0 - WGS84_E2) + alt_km) * math.sin(lat)
    return np.array([x, y, z])


def ecef_to_geodetic(r_ecef) -> tuple[float, float, float]:
    """ECEF（km）→ WGS84 大地坐标。Bowring 迭代法，返回 (lat_deg, lon_deg, alt_km)。"""
    x, y, z = float(r_ecef[0]), float(r_ecef[1]), float(r_ecef[2])
    lon = math.atan2(y, x)
    p = math.hypot(x, y)
    if p < 1e-9:  # 极点
        lat = math.pi / 2 if z > 0 else -math.pi / 2
        return lat * _RAD, lon * _RAD, abs(z) - WGS84_A * (1 - WGS84_F)
    # 初始猜测 + 2 次迭代（Bowring，亚毫米精度）
    lat = math.atan2(z, p * (1.0 - WGS84_E2))
    for _ in range(3):
        n = WGS84_A / math.sqrt(1.0 - WGS84_E2 * math.sin(lat) ** 2)
        h = p / math.cos(lat) - n
        lat = math.atan2(z, p * (1.0 - WGS84_E2 * n / (n + h)))
    n = WGS84_A / math.sqrt(1.0 - WGS84_E2 * math.sin(lat) ** 2)
    h = p / math.cos(lat) - n
    return lat * _RAD, ((lon * _RAD + 180.0) % 360.0) - 180.0, h


@dataclass
class LookAngle:
    azimuth_deg: float
    elevation_deg: float
    range_km: float
    range_rate_km_s: float | None = None


def station_enu_matrix(station_ecef: np.ndarray) -> np.ndarray:
    """站心 ENU 旋转矩阵（ECEF→ENU），行向量为 E/N/U 单位矢量。"""
    lat, lon, _ = ecef_to_geodetic(station_ecef)
    lat_r = lat * _DEG
    lon_r = lon * _DEG
    e = np.array([-math.sin(lon_r), math.cos(lon_r), 0.0])
    n = np.array(
        [-math.sin(lat_r) * math.cos(lon_r), -math.sin(lat_r) * math.sin(lon_r), math.cos(lat_r)]
    )
    u = np.array([math.cos(lat_r) * math.cos(lon_r), math.cos(lat_r) * math.sin(lon_r), math.sin(lat_r)])
    return np.vstack([e, n, u])


def look_angles(
    station_ecef: np.ndarray, sat_ecef, sat_vel_ecef=None, enu: np.ndarray | None = None
) -> LookAngle | list[LookAngle]:
    """站心观察角：方位/仰角/距离（可选距离变化率，用于多普勒）。

    sat_ecef/sat_vel_ecef 支持 (3,) 或 (N,3)。
    enu: 预计算的站心 ENU 旋转矩阵（station_enu_matrix 的结果）。
    对同一测站批量/反复调用时传入可避免每次重复推导（热路径优化）。
    """
    topoc = np.asarray(sat_ecef, dtype=float) - station_ecef
    if enu is None:
        enu = station_enu_matrix(station_ecef)  # (3,3)
    if topoc.ndim == 1:
        e, n, u = enu @ topoc
        rng = float(math.sqrt(e * e + n * n + u * u))
        az = math.degrees(math.atan2(e, n)) % 360.0
        el = math.degrees(math.asin(max(-1.0, min(1.0, u / rng))))
        if sat_vel_ecef is None:
            return LookAngle(az, el, rng)
        rel_v = np.asarray(sat_vel_ecef, dtype=float)
        rr = float(np.dot(enu @ rel_v, topoc) / rng)
        return LookAngle(az, el, rng, rr)

    w = enu @ topoc.T  # (3,N)
    e, n, u = w[0], w[1], w[2]
    rng = np.sqrt(e * e + n * n + u * u)
    az = np.degrees(np.arctan2(e, n)) % 360.0
    el = np.degrees(np.arcsin(np.clip(u / rng, -1.0, 1.0)))
    if sat_vel_ecef is None:
        return [LookAngle(float(a), float(el_), float(r)) for a, el_, r in zip(az, el, rng)]
    rel_v = np.asarray(sat_vel_ecef, dtype=float)
    v_topo = enu @ rel_v.T  # (3,N)
    rr = (v_topo[0] * e + v_topo[1] * n + v_topo[2] * u) / rng
    return [LookAngle(float(a), float(el_), float(r), float(rv)) for a, el_, r, rv in zip(az, el, rng, rr)]


def fspl_db(distance_km: float, freq_mhz: float) -> float:
    """自由空间路径损耗。

    FSPL(dB) = 32.44 + 20log10(d_km) + 20log10(f_MHz)
    """
    if distance_km <= 0 or freq_mhz <= 0:
        raise ValueError("距离与频率必须为正")
    return 32.44 + 20.0 * math.log10(distance_km) + 20.0 * math.log10(freq_mhz)


def doppler_shift_hz(freq_hz: float, range_rate_km_s: float) -> float:
    """多普勒频移（Hz）。接近为正（频率升高）。

    fd ≈ -f * (dr/dt) / c，range_rate > 0 表示远离。
    """
    C_KM_S = 299792.458
    return -freq_hz * range_rate_km_s / C_KM_S
