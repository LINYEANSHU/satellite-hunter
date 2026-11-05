"""SGP4 批量传播器：TEME 位置/速度 → ECEF → 大地坐标。

设计要点：
- SatrecArray 批量计算，未选中卫星可低频更新（需求 12.1）
- 单星 SGP4 错误（如轨道已衰减）记录为该卫星的传播错误，不影响其他卫星
"""
from __future__ import annotations

import math
import threading
from dataclasses import dataclass

import numpy as np
from sgp4.api import Satrec, SatrecArray

from app.services.orbit import transforms as tf
from app.services.orbit.omm import SatEntry, satrec_from_omm, satrec_from_tle


@dataclass
class SatPosition:
    norad_id: int
    error: int = 0  # SGP4 错误码，0 = 正常
    error_msg: str = ""
    r_ecef: np.ndarray | None = None  # (3,) km
    v_ecef: np.ndarray | None = None  # (3,) km/s
    lat: float = 0.0
    lon: float = 0.0
    alt_km: float = 0.0
    speed_km_s: float = 0.0

    def as_dict(self) -> dict:
        if self.error:
            return {"norad_id": self.norad_id, "error": self.error, "error_msg": self.error_msg}
        return {
            "norad_id": self.norad_id,
            "error": 0,
            "lat": round(self.lat, 5),
            "lon": round(self.lon, 5),
            "alt_km": round(self.alt_km, 3),
            "speed_km_s": round(self.speed_km_s, 6),
            "ecef_km": [round(float(x), 4) for x in self.r_ecef],
            "velocity_km_s": [round(float(x), 6) for x in self.v_ecef],
        }


class Propagator:
    """一组卫星的传播器。"""

    def __init__(self, entries: list[SatEntry]):
        self.entries: dict[int, SatEntry] = {}
        self._satrecs: dict[int, Satrec] = {}
        self._init_errors: dict[int, str] = {}
        for e in entries:
            self.entries[e.norad_id] = e
            try:
                if e.origin == "tle_import" and e.omm.get("_TLE_LINE1"):
                    self._satrecs[e.norad_id] = satrec_from_tle(
                        e.omm["_TLE_LINE1"], e.omm["_TLE_LINE2"]
                    )
                else:
                    self._satrecs[e.norad_id] = satrec_from_omm(e.omm)
            except Exception as ex:
                self._init_errors[e.norad_id] = str(ex)
        self._array = None
        if self._satrecs:
            self._array = SatrecArray(list(self._satrecs.values()))
            self._ids = list(self._satrecs.keys())

    @property
    def ids(self) -> list[int]:
        return list(self._satrecs.keys())

    def __len__(self) -> int:
        return len(self._satrecs)

    def get_satrec(self, norad_id: int) -> Satrec:
        if norad_id in self._satrecs:
            return self._satrecs[norad_id]
        raise KeyError(f"卫星 {norad_id} 不在此传播器中")

    def positions_ecef(self, dt, ids: list[int] | None = None) -> dict[int, SatPosition]:
        """计算指定 UTC 时刻的批量位置。dt 为 naive UTC datetime。"""
        jd, fr = tf.jday_utc(dt)
        gmst = tf.gmst_deg(jd + fr)

        if ids is None:
            ids = self._ids
        # 单星路径（少量卫星时直接逐个，避免 SatrecArray 开销）
        result: dict[int, SatPosition] = {}
        target = [i for i in ids if i in self._satrecs]
        for nid in self._init_errors:
            if ids is None or nid in ids:
                result[nid] = SatPosition(
                    norad_id=nid, error=-1, error_msg=self._init_errors[nid]
                )

        use_array = len(target) > 16 and self._array is not None
        if use_array:
            idx_map = {nid: k for k, nid in enumerate(self._ids)}
            # SatrecArray.sgp4(jd_times, fr_times)：输出 (n_sats, n_times, 3)
            e, r, v = self._array.sgp4(np.array([jd]), np.array([fr]))
            e = np.asarray(e).reshape(len(self._ids))
            r = np.asarray(r).reshape(len(self._ids), 3)
            v = np.asarray(v).reshape(len(self._ids), 3)
            ok = e == 0
            r_ecef_all, v_ecef_all = tf.teme_to_ecef(r, v, gmst)
            for nid in target:
                k = idx_map[nid]
                if not ok[k]:
                    result[nid] = SatPosition(
                        norad_id=nid,
                        error=int(e[k]),
                        error_msg="SGP4 传播错误（可能轨道已衰减或根数异常）",
                    )
                    continue
                result[nid] = self._make_position(nid, r_ecef_all[k], v_ecef_all[k])
            return result

        for nid in target:
            sat = self._satrecs[nid]
            err, r, v = sat.sgp4(jd, fr)
            if err:
                result[nid] = SatPosition(
                    norad_id=nid, error=err, error_msg="SGP4 传播错误（可能轨道已衰减或根数异常）"
                )
                continue
            r_arr = np.array(r)
            v_arr = np.array(v)
            r_ecef, v_ecef = tf.teme_to_ecef(r_arr, v_arr, gmst)
            result[nid] = self._make_position(nid, r_ecef, v_ecef)
        return result

    @staticmethod
    def _make_position(nid: int, r_ecef, v_ecef) -> SatPosition:
        lat, lon, alt = tf.ecef_to_geodetic(r_ecef)
        return SatPosition(
            norad_id=nid,
            r_ecef=r_ecef,
            v_ecef=v_ecef,
            lat=lat,
            lon=lon,
            alt_km=alt,
            speed_km_s=float(math.sqrt(float(v_ecef[0]) ** 2 + float(v_ecef[1]) ** 2 + float(v_ecef[2]) ** 2)),
        )

    def positions_ecef_batch(
        self, dts: list, ids: list[int] | None = None
    ) -> dict[int, list[SatPosition]]:
        """多 UTC 时刻批量传播：每颗卫星一次 SGP4 批量调用。

        返回 {norad_id: [SatPosition, ...]}，列表顺序与 dts 一致。
        初始化失败的卫星不在结果中；某时刻 SGP4 传播错误时该位置元素
        为 error 非零的 SatPosition（调用方可按需跳过，与 positions_ecef 语义一致）。
        """
        if not dts:
            return {}
        if ids is None:
            ids = self._ids
        target = [i for i in ids if i in self._satrecs]

        n = len(dts)
        jd_arr = np.empty(n)
        fr_arr = np.empty(n)
        for k, dt in enumerate(dts):
            jd, fr = tf.jday_utc(dt)
            jd_arr[k] = jd
            fr_arr[k] = fr
        gmst_arr = tf.gmst_deg_array(jd_arr, fr_arr)
        theta = gmst_arr * math.pi / 180.0
        c, s = np.cos(theta), np.sin(theta)
        omega = tf.EARTH_OMEGA

        result: dict[int, list[SatPosition]] = {}
        for nid in target:
            sat = self._satrecs[nid]
            err, r_teme, v_teme = sat.sgp4_array(jd_arr, fr_arr)
            err = np.atleast_1d(err).ravel()
            r_teme = np.atleast_2d(r_teme).reshape(n, 3)
            v_teme = np.atleast_2d(v_teme).reshape(n, 3)

            x, y, z = r_teme[:, 0], r_teme[:, 1], r_teme[:, 2]
            r_ecef = np.stack([c * x + s * y, -s * x + c * y, z], axis=1)
            vx, vy, vz = v_teme[:, 0], v_teme[:, 1], v_teme[:, 2]
            v_inert = np.stack([c * vx + s * vy, -s * vx + c * vy, vz], axis=1)
            v_ecef = v_inert.copy()
            v_ecef[:, 0] += omega * r_ecef[:, 1]
            v_ecef[:, 1] -= omega * r_ecef[:, 0]

            out: list[SatPosition] = []
            for k in range(n):
                if err[k]:
                    out.append(
                        SatPosition(
                            norad_id=nid,
                            error=int(err[k]),
                            error_msg="SGP4 传播错误（可能轨道已衰减或根数异常）",
                        )
                    )
                    continue
                out.append(self._make_position(nid, r_ecef[k], v_ecef[k]))
            result[nid] = out
        return result


class GroupPropagatorCache:
    """按分组数据版本缓存 Propagator，避免高频请求重复构建 Satrec/SatrecArray。

    键为 (group, 条目号元组)：条目集合必须参与键的构成——调用方可能传入
    过滤/截断后的子集（如 /satellites/positions 的 ids 搜索），若只用
    (group, len(entries)) 作键，两个不同子集条数相同时会错误复用对方的
    传播器，导致返回空/错位置（正确性 bug，已于本版修复）。
    SGP4 根数不可变，因此同一版本数据复用传播器是安全的。
    """

    def __init__(self, max_entries: int = 8) -> None:
        self._cache: dict[tuple, tuple[float, Propagator]] = {}
        self._max = max_entries
        self._lock = threading.Lock()

    def get(self, group: str, fetched_at: float, entries: list[SatEntry]) -> Propagator:
        key = (group, tuple(e.norad_id for e in entries))
        with self._lock:
            hit = self._cache.get(key)
            if hit is not None and hit[0] == fetched_at:
                return hit[1]
        # 构建在锁外进行：Satrec/SatrecArray 构建较重，避免阻塞其他分组的
        # 并发请求；重复构建时后写覆盖，结果一致（SGP4 确定性）。
        prop = Propagator(entries)
        with self._lock:
            if len(self._cache) >= self._max:
                self._cache.clear()
            self._cache[key] = (fetched_at, prop)
            return self._cache[key][1]


group_propagator_cache = GroupPropagatorCache()
