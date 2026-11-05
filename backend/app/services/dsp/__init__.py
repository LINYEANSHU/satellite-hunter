"""DSP 服务：IQ 录波读取（分块）、频谱/瀑布图/星座图计算。

性能约束（需求 12.2）：
- 不允许整段录波载入内存：所有接口按需 seek + 分块读取
- FFT 在后端完成，浏览器只接收可视化数据
"""
from __future__ import annotations

import math
import struct
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import numpy as np

# 格式: (dtype, 字节/分量, 说明)
IQ_FORMATS = {
    "cu8": (np.uint8, 1, "uint8 I/Q（RTL 电视棒常见）"),
    "cs8": (np.int8, 1, "int8 I/Q"),
    "cs16": (np.int16, 2, "int16 I/Q（SigMF 常见）"),
    "cu16": (np.uint16, 2, "uint16 I/Q"),
    "cf32": (np.float32, 4, "float32 复数（SatDump 默认）"),
}


@dataclass
class IQMeta:
    samples: int
    bytes_total: int
    duration_s: float | None  # 需采样率
    bytes_per_sample: int


def iq_meta(path: str | Path, fmt: str) -> IQMeta:
    if fmt not in IQ_FORMATS:
        raise ValueError(f"不支持的 IQ 格式: {fmt}")
    dtype, bpc, _ = IQ_FORMATS[fmt]
    size = Path(path).stat().st_size
    bytes_per_sample = bpc * 2  # I + Q
    n = size // bytes_per_sample
    return IQMeta(samples=n, bytes_total=size, duration_s=None, bytes_per_sample=bytes_per_sample)


def read_iq_block(path: str | Path, fmt: str, start_sample: int, n_samples: int) -> np.ndarray:
    """读取 [start_sample, start_sample+n) 的复数采样块，返回 complex64。"""
    if fmt not in IQ_FORMATS:
        raise ValueError(f"不支持的 IQ 格式: {fmt}")
    with open(path, "rb") as f:
        return _read_iq_from(f, fmt, start_sample, n_samples)


def _read_iq_from(f, fmt: str, start_sample: int, n_samples: int) -> np.ndarray:
    """read_iq_block 的文件句柄复用版本（瀑布图逐行读取时避免重复开文件）。"""
    dtype, bpc, _ = IQ_FORMATS[fmt]
    bps = bpc * 2
    f.seek(start_sample * bps)
    raw = f.read(n_samples * bps)
    if not raw:
        return np.zeros(0, dtype=np.complex64)
    n = len(raw) // bps
    arr = np.frombuffer(raw[: n * bps], dtype=dtype).astype(np.float32)
    if fmt == "cu8":
        arr = (arr - 127.5) / 127.5
    elif fmt == "cu16":
        arr = (arr - 32767.5) / 32767.5
    elif fmt == "cs8":
        arr = arr / 127.5
    elif fmt == "cs16":
        arr = arr / 32767.5
    iq = arr[0::2] + 1j * arr[1::2]
    return iq.astype(np.complex64)


@lru_cache(maxsize=16)
def _hanning_window(fft_size: int) -> np.ndarray:
    """hanning 窗与能量归一化系数缓存（compute_spectrum 高频调用）。"""
    window = np.hanning(fft_size).astype(np.float32)
    return window, np.float64(np.sum(window**2))


def compute_spectrum(iq: np.ndarray, fft_size: int = 1024, avg: int = 8) -> np.ndarray:
    """功率谱（dB），对 avg 段做平均（类 Welch）。返回长度 fft_size。"""
    if len(iq) < fft_size:
        iq = np.pad(iq, (0, fft_size - len(iq)))
    n_seg = max(1, min(avg, len(iq) // fft_size))
    acc = np.zeros(fft_size)
    window, win_norm = _hanning_window(fft_size)
    for k in range(n_seg):
        seg = iq[k * fft_size : (k + 1) * fft_size] * window
        spec = np.fft.fftshift(np.fft.fft(seg))
        acc += np.abs(spec) ** 2 / win_norm
    acc /= n_seg
    acc = np.maximum(acc, 1e-20)
    return 10.0 * np.log10(acc)


def compute_waterfall(
    path: str | Path,
    fmt: str,
    fft_size: int = 256,
    rows: int = 128,
    t0_frac: float = 0.0,
    t1_frac: float = 1.0,
) -> tuple[np.ndarray, dict]:
    """瀑布图：时间 × 频率 dB 矩阵（rows × fft_size）。

    分块读取：每行从文件不同位置取样（大文件自动跨步采样，不整读）。
    返回 (矩阵 dB, 元数据)。
    """
    meta = iq_meta(path, fmt)
    total = meta.samples
    if total == 0:
        return np.zeros((rows, fft_size)), {"samples": 0}

    t0 = max(0.0, min(1.0, t0_frac))
    t1 = max(t0, min(1.0, t1_frac))
    span = int(total * (t1 - t0))
    start0 = int(total * t0)
    row_step = max(1, span // rows)

    out = np.zeros((rows, fft_size), dtype=np.float32)
    with open(path, "rb") as f:
        for r in range(rows):
            s = start0 + r * row_step
            n = min(fft_size * 4, total - s)
            if n <= 0:
                break
            iq = _read_iq_from(f, fmt, s, n)
            if len(iq) < fft_size:
                continue
            # 每行取若干段平均
            seg_len = len(iq) // max(1, len(iq) // fft_size)
            spec = compute_spectrum(iq[: seg_len * max(1, len(iq) // fft_size)], fft_size, avg=4)
            out[r] = spec.astype(np.float32)

    return out, {"samples": total, "row_step": row_step, "t0": t0, "t1": t1}


def iq_stats(iq: np.ndarray) -> dict:
    """I/Q 统计：均值(DC 偏移)、标准差、峰值、饱和比例。"""
    if len(iq) == 0:
        return {}
    i = iq.real
    q = iq.imag
    mag = np.abs(iq)
    return {
        "n": int(len(iq)),
        "i_mean": float(np.mean(i)),
        "q_mean": float(np.mean(q)),
        "i_std": float(np.std(i)),
        "q_std": float(np.std(q)),
        "mag_mean": float(np.mean(mag)),
        "mag_peak": float(np.max(mag)),
        "clip_ratio": float(np.mean(mag > 0.98)),
        "power_dbfs": float(10 * math.log10(max(float(np.mean(mag**2)), 1e-20))),
    }


def freq_offset_estimate(iq: np.ndarray, sample_rate: float) -> float:
    """粗略载波频偏估计：频谱质心（Hz）。"""
    spec = np.abs(np.fft.fftshift(np.fft.fft(iq))) ** 2
    f = np.fft.fftshift(np.fft.fftfreq(len(iq), 1.0 / sample_rate))
    total = spec.sum()
    if total <= 0:
        return 0.0
    return float((spec * f).sum() / total)
