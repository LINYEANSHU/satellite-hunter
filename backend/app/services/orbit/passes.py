"""过境预测：粗扫描 + 二分细化，输出 AOS/LOS/TCA/最大仰角/方位角。

算法：以 coarse_step（默认 30s）扫描仰角曲线，检测仰角越过 min_el 的
区间边界，再用二分法将边界细化到 1 秒内；区间内部用 30s 采样近似求
最大仰角（对短弧段误差 < 0.1°，对任务规划足够；精确极值用三分搜索）。
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime, timedelta

import numpy as np
from sgp4.api import Satrec

from app.services.orbit import transforms as tf


@dataclass
class Pass:
    satellite_id: int
    aos: datetime
    los: datetime
    tca: datetime
    max_elevation_deg: float
    aos_azimuth_deg: float
    los_azimuth_deg: float
    tca_azimuth_deg: float
    duration_s: float
    min_elevation_deg: float

    def as_dict(self) -> dict:
        return {
            "satellite_id": self.satellite_id,
            "aos": self.aos.isoformat() + "Z",
            "los": self.los.isoformat() + "Z",
            "tca": self.tca.isoformat() + "Z",
            "max_elevation_deg": round(self.max_elevation_deg, 2),
            "aos_azimuth_deg": round(self.aos_azimuth_deg, 1),
            "los_azimuth_deg": round(self.los_azimuth_deg, 1),
            "tca_azimuth_deg": round(self.tca_azimuth_deg, 1),
            "duration_s": round(self.duration_s, 1),
            "min_elevation_deg": self.min_elevation_deg,
        }


def _elevation_series(
    sat: Satrec, station_ecef: np.ndarray, times_s: np.ndarray, jd0: float, fr0: float
) -> tuple[np.ndarray, np.ndarray]:
    """批量计算相对时间(秒)数组对应的仰角与方位角。"""
    n = len(times_s)
    days = times_s / 86400.0
    jd = np.full(n, jd0) + np.floor(days)
    fr = np.full(n, fr0) + (days - np.floor(days))
    # 修进位
    over = fr >= 1.0
    jd[over] += 1.0
    fr[over] -= 1.0

    err, r_teme, v_teme = sat.sgp4_array(jd, fr)
    err = np.atleast_1d(err).ravel()
    r_teme = np.atleast_2d(r_teme).reshape(n, 3)
    v_teme = np.atleast_2d(v_teme).reshape(n, 3)

    gmst_arr = np.array([tf.gmst_deg(j + f) for j, f in zip(jd, fr)])
    # 批量旋转（gmst 每点不同，用向量化公式）
    theta = gmst_arr * math.pi / 180.0
    c, s = np.cos(theta), np.sin(theta)
    x, y, z = r_teme[:, 0], r_teme[:, 1], r_teme[:, 2]
    r_ecef = np.stack([c * x + s * y, -s * x + c * y, z], axis=1)
    vx, vy, vz = v_teme[:, 0], v_teme[:, 1], v_teme[:, 2]
    v_inert = np.stack([c * vx + s * vy, -s * vx + c * vy, vz], axis=1)
    v_ecef = v_inert.copy()
    v_ecef[:, 0] += tf.EARTH_OMEGA * r_ecef[:, 1]
    v_ecef[:, 1] -= tf.EARTH_OMEGA * r_ecef[:, 0]

    angles = tf.look_angles(station_ecef, r_ecef, v_ecef)
    el = np.array([a.elevation_deg for a in angles])
    az = np.array([a.azimuth_deg for a in angles])
    el[err != 0] = -90.0  # 传播失败的点视为不可见
    return el, az


def _bisect_cross(
    sat, station_ecef, jd0, fr0, t_lo_s: float, t_hi_s: float, min_el: float
) -> float:
    """在 [t_lo, t_hi] 内二分仰角=min_el 的交点（t_lo 低于、t_hi 高于）。"""
    for _ in range(20):
        mid = 0.5 * (t_lo_s + t_hi_s)
        if t_hi_s - t_lo_s < 1.0:
            return mid
        el_mid, _ = _elevation_series(sat, station_ecef, np.array([mid]), jd0, fr0)
        if el_mid[0] >= min_el:
            t_hi_s = mid
        else:
            t_lo_s = mid
    return 0.5 * (t_lo_s + t_hi_s)


def _max_elevation(
    sat, station_ecef, jd0, fr0, t_aos_s: float, t_los_s: float
) -> tuple[float, float, float]:
    """区间内最大仰角与对应时刻（三分搜索）。返回 (t, max_el, az)。"""
    lo, hi = t_aos_s, t_los_s
    for _ in range(60):
        m1 = lo + (hi - lo) / 3.0
        m2 = hi - (hi - lo) / 3.0
        el1, _ = _elevation_series(sat, station_ecef, np.array([m1]), jd0, fr0)
        el2, _ = _elevation_series(sat, station_ecef, np.array([m2]), jd0, fr0)
        if el1[0] < el2[0]:
            lo = m1
        else:
            hi = m2
    t = 0.5 * (lo + hi)
    el, az = _elevation_series(sat, station_ecef, np.array([t]), jd0, fr0)
    return float(t), float(el[0]), float(az[0])


def predict_passes(
    sat: Satrec,
    satellite_id: int,
    station_lat: float,
    station_lon: float,
    station_alt_km: float,
    start: datetime,
    end: datetime,
    min_elevation_deg: float = 5.0,
    coarse_step_s: float = 30.0,
    max_passes: int = 50,
) -> list[Pass]:
    """预测 [start, end] 内的可见过境。start/end 为 naive UTC。"""
    if end <= start:
        return []
    station_ecef = tf.geodetic_to_ecef(station_lat, station_lon, station_alt_km)
    jd0, fr0 = tf.jday_utc(start)
    total_s = (end - start).total_seconds()

    times = np.arange(0.0, total_s + coarse_step_s, coarse_step_s)
    el, az = _elevation_series(sat, station_ecef, times, jd0, fr0)

    passes: list[Pass] = []
    inside = el[0] >= min_elevation_deg
    seg_start = float(times[0]) if inside else None

    for k in range(1, len(times)):
        was, now = el[k - 1] >= min_elevation_deg, el[k] >= min_elevation_deg
        if not was and now:
            seg_start = _bisect_cross(sat, station_ecef, jd0, fr0, times[k - 1], times[k], min_elevation_deg)
        elif was and not now and seg_start is not None:
            seg_end = _bisect_cross(sat, station_ecef, jd0, fr0, times[k - 1], times[k], min_elevation_deg)
            _emit(passes, sat, satellite_id, station_ecef, jd0, fr0, start, seg_start, seg_end, min_elevation_deg)
            seg_start = None
            if len(passes) >= max_passes:
                break
        elif was and now and k == len(times) - 1 and seg_start is not None:
            # 窗口结束仍在视野内：以最后采样为界
            _emit(passes, sat, satellite_id, station_ecef, jd0, fr0, start, seg_start, float(times[k]), min_elevation_deg)

    return passes


def _emit(
    passes, sat, satellite_id, station_ecef, jd0, fr0, start_dt, t_aos_s, t_los_s, min_el
):
    if t_los_s - t_aos_s < 10.0:  # 过短（低于 10 秒）不作为有效过境
        return
    el_aos, az_aos = _elevation_series(sat, station_ecef, np.array([t_aos_s]), jd0, fr0)
    el_los, az_los = _elevation_series(sat, station_ecef, np.array([t_los_s]), jd0, fr0)
    t_tca_s, max_el, az_tca = _max_elevation(sat, station_ecef, jd0, fr0, t_aos_s, t_los_s)

    passes.append(
        Pass(
            satellite_id=satellite_id,
            aos=start_dt + timedelta(seconds=t_aos_s),
            los=start_dt + timedelta(seconds=t_los_s),
            tca=start_dt + timedelta(seconds=t_tca_s),
            max_elevation_deg=max_el,
            aos_azimuth_deg=float(az_aos[0]),
            los_azimuth_deg=float(az_los[0]),
            tca_azimuth_deg=az_tca,
            duration_s=t_los_s - t_aos_s,
            min_elevation_deg=min_el,
        )
    )
