"""SGP4 批量传播器：TEME 位置/速度 → ECEF → 大地坐标。

设计要点：
- SatrecArray 批量计算，未选中卫星可低频更新（需求 12.1）
- 单星 SGP4 错误（如轨道已衰减）记录为该卫星的传播错误，不影响其他卫星
"""
from __future__ import annotations

import math
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
            sel = [idx_map[nid] for nid in target]
            n = len(sel)
            jd_arr = np.full(n, jd)
            fr_arr = np.full(n, fr)
            e, r, v = self._array.sgp4(jd_arr, fr_arr)
            e = np.atleast_1d(e).ravel()
            r = np.atleast_2d(r).reshape(n, 3)
            v = np.atleast_2d(v).reshape(n, 3)
            ok = e.ravel() == 0
            r_ecef_all, v_ecef_all = tf.teme_to_ecef(r, v, gmst)
            for k, nid in enumerate(target):
                if not ok[k]:
                    result[nid] = SatPosition(
                        norad_id=nid,
                        error=int(e.ravel()[k]),
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
