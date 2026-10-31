"""简化射频链路模型（探索模式用，SIMULATED_RF）。

需求 10.2：FSPL + 天线增益 + 指向误差 + 系统噪声 + 接收机带宽 + SNR + 多普勒。
所有卫星发射参数若无可靠公开数据，使用类别游戏假设（rf_assumptions.json，
UI 必须标注为游戏假设）。计算为确定性函数（不含随机数），任务内的随机
抖动由 missions 服务用种子化 RNG 注入。
"""
from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

from app.services.game.equipment import find_def, load_catalog
from app.services.orbit.transforms import doppler_shift_hz, fspl_db

DATA_DIR = Path(__file__).resolve().parent.parent.parent / "data"


@lru_cache(maxsize=1)
def _assumptions() -> dict:
    with open(DATA_DIR / "rf_assumptions.json", encoding="utf-8") as f:
        return json.load(f)


def _interp_atm_loss(el_deg: float) -> float:
    table = _assumptions()["atmospheric_loss_db_by_elevation"]
    xs = [p["el"] for p in table]
    ys = [p["loss"] for p in table]
    if el_deg <= xs[0]:
        return ys[0]
    if el_deg >= xs[-1]:
        return ys[-1]
    for i in range(1, len(xs)):
        if el_deg <= xs[i]:
            x0, x1 = xs[i - 1], xs[i]
            y0, y1 = ys[i - 1], ys[i]
            return y0 + (y1 - y0) * (el_deg - x0) / (x1 - x0)
    return ys[-1]


def category_of_group(group: str) -> str:
    return _assumptions()["categories"].get(group, "other")


@dataclass
class SignalAssumptions:
    freq_mhz: float
    bandwidth_khz: float
    tx_power_dbm: float
    tx_gain_dbi: float
    required_snr_db: float
    data_rate_kbps: float
    modulation: str
    source: str = "游戏假设（类别默认）"


def signal_assumptions(satellite_id: int, group: str) -> SignalAssumptions:
    """卫星信号参数：已知卫星表 → 类别默认（均声明来源）。"""
    a = _assumptions()
    known = a["known_satellites"].get(str(satellite_id))
    if known and "freq_mhz" in known:
        return SignalAssumptions(
            freq_mhz=known["freq_mhz"],
            bandwidth_khz=known["bandwidth_khz"],
            tx_power_dbm=known["tx_power_dbm"],
            tx_gain_dbi=known["tx_gain_dbi"],
            required_snr_db=known["required_snr_db"],
            data_rate_kbps=known["data_rate_kbps"],
            modulation=known["modulation"],
            source=known.get("source", "公开资料"),
        )
    cat = category_of_group(group)
    d = a["category_defaults"][cat]
    return SignalAssumptions(
        freq_mhz=d["freq_mhz"],
        bandwidth_khz=d["bandwidth_khz"],
        tx_power_dbm=d["tx_power_dbm"],
        tx_gain_dbi=d["tx_gain_dbi"],
        required_snr_db=d["required_snr_db"],
        data_rate_kbps=d["data_rate_kbps"],
        modulation=d["modulation"],
        source=d.get("note", "游戏假设"),
    )


def band_of_freq(freq_mhz: float) -> str:
    for band, (lo, hi) in load_catalog()["_meta"]["bands"].items():
        if lo <= freq_mhz <= hi:
            return band
    return "other"


@dataclass
class StationRF:
    """由站内设备推导的接收端射频能力。"""

    antenna_gain_dbi: float = 0.0
    antenna_directional: bool = False
    antenna_bands: tuple = ()
    polar_ok: bool = False
    sdr_min_mhz: float = 0.0
    sdr_max_mhz: float = 0.0
    sdr_nf_db: float = 10.0
    sdr_max_bw_khz: float = 0.0
    lna_gain_db: float = 0.0
    lna_nf_db: float = 8.0
    filter_loss_db: float = 0.0
    filter_center_mhz: float = 0.0
    rotator_accuracy_deg: float = 360.0
    rotator_max_speed: float = 0.0
    has_rotator: bool = False
    issues: list = field(default_factory=list)


def station_rf(station_eq: dict) -> StationRF:
    """station_eq: category → Equipment ORM 对象。"""
    rf = StationRF()

    ant = station_eq.get("antenna")
    if ant is not None:
        d = find_def(ant.catalog_id) or {}
        rf.antenna_gain_dbi = d.get("gain_dbi", 0)
        rf.antenna_directional = d.get("directional", False)
        rf.antenna_bands = tuple(d.get("bands", ()))
        rf.polar_ok = d.get("polarization") in ("circular",)
        if d.get("requires_rotator") and station_eq.get("rotator") is None:
            rf.issues.append("该天线需要转台才能指向")
    else:
        rf.issues.append("缺少天线")

    sdr = station_eq.get("sdr")
    if sdr is not None:
        d = find_def(sdr.catalog_id) or {}
        rf.sdr_min_mhz = d.get("freq_min_mhz", 0)
        rf.sdr_max_mhz = d.get("freq_max_mhz", 0)
        rf.sdr_nf_db = d.get("noise_figure_db", 10)
        rf.sdr_max_bw_khz = d.get("max_bandwidth_khz", 0)
    else:
        rf.issues.append("缺少 SDR 接收机")

    lna = station_eq.get("amplifier")
    if lna is not None:
        d = find_def(lna.catalog_id) or {}
        rf.lna_gain_db = d.get("gain_db", 0)
        rf.lna_nf_db = d.get("noise_figure_db", 8)

    flt = station_eq.get("filter")
    if flt is not None:
        d = find_def(flt.catalog_id) or {}
        rf.filter_loss_db = d.get("insertion_loss_db", 0)
        rf.filter_center_mhz = d.get("center_mhz", 0)

    rot = station_eq.get("rotator")
    if rot is not None:
        d = find_def(rot.catalog_id) or {}
        rf.rotator_accuracy_deg = d.get("pointing_accuracy_deg", 360)
        rf.rotator_max_speed = d.get("max_speed_deg_s", 0)
        rf.has_rotator = d.get("max_speed_deg_s", 0) > 0

    return rf


@dataclass
class LinkResult:
    fspl_db: float
    rx_power_dbm: float
    noise_dbm: float
    snr_db: float
    required_snr_db: float
    margin_db: float
    doppler_hz: float
    pointing_loss_db: float
    quality: float  # 0-100
    receivable: bool
    reasons: list = field(default_factory=list)


def compute_link(
    rf: StationRF,
    sig: SignalAssumptions,
    elevation_deg: float,
    range_km: float,
    range_rate_km_s: float | None = None,
    pointing_error_deg: float = 0.0,
) -> LinkResult:
    """计算某一时刻的链路预算。确定性，无随机。"""
    reasons: list = []
    freq_mhz = sig.freq_mhz
    bw_khz = min(sig.bandwidth_khz, rf.sdr_max_bw_khz) if rf.sdr_max_bw_khz else sig.bandwidth_khz

    # 频段覆盖检查
    if not (rf.sdr_min_mhz <= freq_mhz <= rf.sdr_max_mhz):
        reasons.append(f"SDR 频率范围不覆盖 {freq_mhz} MHz")
    if rf.antenna_bands:
        band = band_of_freq(freq_mhz)
        if band not in rf.antenna_bands and band != "other":
            reasons.append(f"天线不覆盖 {band} 频段")

    path = fspl_db(range_km, freq_mhz)
    atm = _interp_atm_loss(elevation_deg)

    # 指向损失：定向天线依赖指向精度；全向天线无指向损失
    pointing_loss = 0.0
    if rf.antenna_directional:
        bw_deg = 12.0  # 默认波束
        if rf.has_rotator:
            bw_deg = max(1.0, rf.rotator_accuracy_deg * 2.5)
        if not rf.has_rotator:
            # 无转台：固定天顶指向，损失随偏离增大（cos 规律近似）
            off = 90.0 - elevation_deg
            pointing_loss = min(30.0, 30.0 * (1 - math.cos(math.radians(off))))
        elif pointing_error_deg > 0:
            frac = min(1.0, pointing_error_deg / bw_deg)
            pointing_loss = 12.0 * frac * frac

    # 滤波器：中心频率接近目标频率时生效（承担插入损耗，游戏中体现为抑制带外干扰，
    # 简化模型中仅扣除插入损耗；失谐时不生效）
    filter_loss = 0.0
    if rf.filter_center_mhz > 0 and abs(rf.filter_center_mhz - freq_mhz) < 5.0:
        filter_loss = rf.filter_loss_db

    eirp = sig.tx_power_dbm + sig.tx_gain_dbi
    rx_power = (
        eirp
        + rf.antenna_gain_dbi
        + rf.lna_gain_db
        - path
        - atm
        - pointing_loss
        - filter_loss
    )

    noise_dbm = -174.0 + 10.0 * math.log10(bw_khz * 1000.0) + rf.sdr_nf_db
    snr = rx_power - noise_dbm
    margin = snr - sig.required_snr_db

    doppler = doppler_shift_hz(sig.freq_mhz * 1e6, range_rate_km_s) if range_rate_km_s is not None else 0.0

    quality = max(0.0, min(100.0, 100.0 / (1.0 + math.exp(-margin / 4.0))))
    if margin <= 0:
        reasons.append(f"链路余量不足（{margin:.1f} dB）")

    freq_ok = not any(("覆盖" in r or "范围" in r) for r in reasons)
    return LinkResult(
        fspl_db=round(path, 2),
        rx_power_dbm=round(rx_power, 2),
        noise_dbm=round(noise_dbm, 2),
        snr_db=round(snr, 2),
        required_snr_db=sig.required_snr_db,
        margin_db=round(margin, 2),
        doppler_hz=round(doppler, 1),
        pointing_loss_db=round(pointing_loss, 2),
        quality=round(quality, 1),
        receivable=freq_ok and margin > 0,
        reasons=reasons,
    )
