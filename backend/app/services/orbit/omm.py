"""OMM (Orbit Mean-Elements Message) 解析与 SGP4 记录构建。

主格式：CelesTrak GP JSON（OMM 字段名）与 CSV；兼容旧版 2 行/3 行 TLE。
目录号使用 int，天然支持超过 5 位数字的 NORAD 目录号（如 50000+）。

sgp4init 参数单位与 python-sgp4 twoline2rv 内部换算一致（已用其源码核对）：
- no_kozai: rad/min   = MEAN_MOTION(rev/day) / xpdotp
- ndot:     rad/min²  = MEAN_MOTION_DOT(rev/day²) / (xpdotp·1440)
- nddot:    rad/min³  = MEAN_MOTION_DDOT(rev/day³) / (xpdotp·1440·1440)
- bstar:    1/地球半径（OMM 与 TLE 同单位，不换算）
- 角度全部换算为弧度；epoch 为儒略日。
"""
from __future__ import annotations

import csv
import io
import math
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone

from sgp4.api import Satrec, WGS72, jday

XPDOTP = 1440.0 / (2.0 * math.pi)  # 229.1831180523293

# 需要的关键 OMM 字段
_OMM_REQUIRED = (
    "NORAD_CAT_ID",
    "EPOCH",
    "MEAN_MOTION",
    "ECCENTRICITY",
    "INCLINATION",
    "RA_OF_ASC_NODE",
    "ARG_OF_PERICENTER",
    "MEAN_ANOMALY",
)


@dataclass
class SatEntry:
    """目录中的一颗卫星。"""

    norad_id: int
    name: str
    omm: dict  # CelesTrak OMM 字段（大写键）
    source: str = "REAL_ORBIT"  # 数据来源标记（需求 9.4）
    origin: str = "celestrak_omm"  # celestrak_omm | tle_import | user_omm
    groups: set[str] = field(default_factory=set)  # 所属分组
    epoch: datetime | None = None

    @property
    def epoch_dt(self) -> datetime:
        if self.epoch:
            return self.epoch
        return parse_epoch(self.omm.get("EPOCH", ""))


def parse_epoch(s: str) -> datetime | None:
    """CelesTrak EPOCH: '2024-01-15T12:00:00.000000Z'（也可能无 Z）。"""
    if not s:
        return None
    s = s.strip()
    try:
        if s.endswith("Z"):
            s = s[:-1]
        dt = datetime.fromisoformat(s)
        return dt.replace(tzinfo=None)  # 内部统一 naive UTC
    except ValueError:
        return None


def _float(v, default: float = 0.0) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def satrec_from_omm(omm: dict) -> Satrec:
    """由 OMM 字段构建 SGP4 记录。

    使用 python-sgp4 官方 omm.initialize（单位换算以库实现为准，
    已由本项目 OMM↔TLE 等价性测试交叉验证）。字段缺失时补默认值。
    """
    from sgp4 import omm as sgp4_omm

    missing = [k for k in _OMM_REQUIRED if not omm.get(k)]
    if missing:
        raise ValueError(f"OMM 缺少关键字段: {', '.join(missing)}")

    fields = dict(omm)
    # 库要求的部分元数据字段在 CelesTrak JSON 中可能缺失，补齐默认值
    fields.setdefault("CLASSIFICATION_TYPE", "U")
    fields.setdefault("OBJECT_ID", "00000A")
    fields.setdefault("EPHEMERIS_TYPE", fields.get("EPHEMERIS_TYPE", "0") or "0")
    fields.setdefault("ELEMENT_SET_NO", "0")
    fields.setdefault("REV_AT_EPOCH", "0")
    # 库按 '%Y-%m-%dT%H:%M:%S.%f' 解析 EPOCH，统一为该格式
    ep = str(fields.get("EPOCH", "")).strip().rstrip("Z")
    if "." not in ep:
        ep += ".000000"
    fields["EPOCH"] = ep

    sat = Satrec()
    sgp4_omm.initialize(sat, fields, gravconst=WGS72)
    if sat.error:
        raise ValueError(f"SGP4 初始化错误码 {sat.error} (NORAD {fields['NORAD_CAT_ID']})")
    return sat


# ---------------------------------------------------------------- CelesTrak
def parse_celestrak_json(records: list[dict], group: str = "") -> list[SatEntry]:
    """CelesTrak GP JSON（即 OMM 对象数组）。"""
    out: list[SatEntry] = []
    for rec in records:
        try:
            norad = int(float(rec["NORAD_CAT_ID"]))
        except (KeyError, TypeError, ValueError):
            continue
        entry = SatEntry(
            norad_id=norad,
            name=str(rec.get("OBJECT_NAME", "")).strip(),
            omm=rec,
            origin="celestrak_omm",
            groups={group} if group else set(),
            epoch=parse_epoch(str(rec.get("EPOCH", ""))),
        )
        out.append(entry)
    return out


def parse_celestrak_csv(text: str, group: str = "") -> list[SatEntry]:
    """CelesTrak GP CSV。"""
    out: list[SatEntry] = []
    reader = csv.DictReader(io.StringIO(text))
    for row in reader:
        try:
            norad = int(float(row["NORAD_CAT_ID"]))
        except (KeyError, TypeError, ValueError):
            continue
        entry = SatEntry(
            norad_id=norad,
            name=str(row.get("OBJECT_NAME", "")).strip(),
            omm=row,
            origin="celestrak_omm",
            groups={group} if group else set(),
            epoch=parse_epoch(str(row.get("EPOCH", ""))),
        )
        out.append(entry)
    return out


# ---------------------------------------------------------------- TLE 兼容
_TLE_LINE_RE = re.compile(r"^(1 |2 )")


def parse_tle_text(text: str, group: str = "user_imported") -> list[SatEntry]:
    """解析 2 行 / 3 行 TLE 文本。返回 SatEntry（omm 字段由 Satrec 反推展示用）。"""
    lines = [ln.rstrip() for ln in text.strip().splitlines() if ln.strip()]
    out: list[SatEntry] = []
    i = 0
    while i < len(lines):
        name = ""
        if not _TLE_LINE_RE.match(lines[i]):
            name = lines[i].strip()
            i += 1
            if i >= len(lines):
                break
        if i + 1 >= len(lines):
            break
        l1, l2 = lines[i], lines[i + 1]
        if not (l1.startswith("1 ") and l2.startswith("2 ")):
            i += 1
            continue
        try:
            sat = satrec_from_tle(l1, l2)
        except Exception:
            i += 2
            continue
        omm = satrec_to_omm_like(sat)
        entry = SatEntry(
            norad_id=sat.satnum,
            name=name or omm["OBJECT_NAME"],
            omm=omm,
            origin="tle_import",
            groups={group} if group else set(),
            epoch=datetime.fromtimestamp(
                (sat.jdsatepoch + sat.jdsatepochF - 2440587.5) * 86400.0, tz=timezone.utc
            ).replace(tzinfo=None),
        )
        out.append(entry)
        i += 2
    return out


def satrec_from_tle(l1: str, l2: str) -> Satrec:
    """TLE 两行 → Satrec（由库内置解析，最可靠）。"""
    sat = Satrec.twoline2rv(l1, l2)
    if sat.error:
        raise ValueError(f"TLE 解析错误码 {sat.error}")
    return sat


def satrec_to_omm_like(sat: Satrec) -> dict:
    """由 Satrec 反推 OMM 风格字段（仅用于 TLE 导入的展示）。"""
    epoch_jd = sat.jdsatepoch + sat.jdsatepochF
    epoch_dt = datetime.fromtimestamp((epoch_jd - 2440587.5) * 86400.0, tz=timezone.utc)
    return {
        "NORAD_CAT_ID": str(sat.satnum),
        "OBJECT_NAME": "",
        "EPOCH": epoch_dt.strftime("%Y-%m-%dT%H:%M:%S.000000Z"),
        "MEAN_MOTION": f"{sat.no_kozai * XPDOTP:.8f}",
        "ECCENTRICITY": f"{sat.ecco:.7f}",
        "INCLINATION": f"{sat.inclo * 180.0 / math.pi:.4f}",
        "RA_OF_ASC_NODE": f"{sat.nodeo * 180.0 / math.pi:.4f}",
        "ARG_OF_PERICENTER": f"{sat.argpo * 180.0 / math.pi:.4f}",
        "MEAN_ANOMALY": f"{sat.mo * 180.0 / math.pi:.4f}",
        "BSTAR": f"{sat.bstar:.8e}",
        "MEAN_MOTION_DOT": f"{sat.ndot * XPDOTP * 1440.0:.8f}",
        "MEAN_MOTION_DDOT": "0.000000000000000E+00",
        "EPHEMERIS_TYPE": "0",
    }
