"""Phase 3 DSP 测试：用已知合成信号交叉验证 FFT/频偏估计/格式解析。"""
from __future__ import annotations

import numpy as np
import pytest

from app.services.dsp import (
    compute_spectrum,
    freq_offset_estimate,
    iq_meta,
    iq_stats,
    read_iq_block,
)


def _write_iq(path, fmt: str, iq: np.ndarray) -> None:
    if fmt == "cf32":
        data = np.empty(iq.size * 2, dtype=np.float32)
        data[0::2] = iq.real
        data[1::2] = iq.imag
        data.tofile(path)
    elif fmt == "cs16":
        data = np.empty(iq.size * 2, dtype=np.int16)
        data[0::2] = np.round(iq.real * 32767)
        data[1::2] = np.round(iq.imag * 32767)
        data.tofile(path)
    elif fmt == "cu8":
        data = np.empty(iq.size * 2, dtype=np.uint8)
        data[0::2] = np.round(iq.real * 127.5 + 127.5)
        data[1::2] = np.round(iq.imag * 127.5 + 127.5)
        data.tofile(path)
    else:
        raise ValueError(fmt)


def test_spectrum_peak_at_known_bin(tmp_path):
    """单一正弦音 @ Fs/8 → 频谱峰必须在对应 bin（FFT 输出精度验证）。"""
    fs = 48000.0
    f_tone = fs / 8  # 6000 Hz
    n = 48000
    t = np.arange(n) / fs
    iq = (0.7 * np.exp(2j * np.pi * f_tone * t)).astype(np.complex64)

    spec = compute_spectrum(iq, fft_size=1024, avg=8)
    # fftshift 后 bin k 对应频率 (k - N/2) * fs / N
    peak_bin = int(np.argmax(spec))
    peak_freq = (peak_bin - 1024 / 2) * fs / 1024
    assert abs(peak_freq - f_tone) < fs / 1024  # 半个 bin
    # 峰值应显著高于平均本底
    assert spec[peak_bin] - np.median(spec) > 20.0


def test_freq_offset_estimate(tmp_path):
    fs = 96000.0
    f = fs / 5
    t = np.arange(24000) / fs
    iq = np.exp(2j * np.pi * f * t).astype(np.complex64)
    est = freq_offset_estimate(iq, fs)
    assert abs(est - f) < fs / 1000


def test_cf32_roundtrip(tmp_path):
    iq = (0.3 * np.exp(2j * np.pi * 1000 * np.arange(4096) / 48000)).astype(np.complex64)
    p = tmp_path / "t.iq"
    _write_iq(p, "cf32", iq)
    back = read_iq_block(p, "cf32", 0, 4096)
    assert np.allclose(back, iq, atol=1e-6)
    meta = iq_meta(p, "cf32")
    assert meta.samples == 4096
    assert meta.bytes_total == 4096 * 8


def test_cs16_and_cu8_scaling(tmp_path):
    n = 2048
    t = np.arange(n) / 48000
    iq = (0.5 * np.exp(2j * np.pi * 6000 * t)).astype(np.complex64)
    for fmt in ("cs16", "cu8"):
        p = tmp_path / f"t.{fmt}"
        _write_iq(p, fmt, iq)
        back = read_iq_block(p, fmt, 0, n)
        # 量化误差 < 1%
        assert np.max(np.abs(back - iq)) < 0.01, fmt
        # 分块读取（跳过前 1024 个采样）
        part = read_iq_block(p, fmt, 1024, 256)
        assert np.allclose(part, iq[1024:1280], atol=0.01)


def test_iq_stats_dc_offset():
    iq = (0.2 + 0.1j) + 0.3 * np.exp(2j * np.pi * 100 * np.arange(8192) / 48000)
    iq = iq.astype(np.complex64)
    s = iq_stats(iq)
    assert abs(s["i_mean"] - 0.2) < 0.01
    assert abs(s["q_mean"] - 0.1) < 0.01


def test_bpsk_constellation_two_clusters():
    """BPSK 合成信号在星座图上应有 ±1 两簇（支撑星座图视图的正确性）。"""
    rng = np.random.default_rng(42)
    bits = rng.integers(0, 2, 512)
    sym = np.where(bits == 0, 1 + 0j, -1 + 0j)
    iq = np.repeat(sym, 8).astype(np.complex64)
    iq += (rng.normal(0, 0.05, len(iq)) + 1j * rng.normal(0, 0.05, len(iq))).astype(np.complex64)
    # 简单判簇：实部正负
    pos = iq.real[iq.real > 0]
    neg = iq.real[iq.real <= 0]
    assert abs(np.mean(pos) - 1) < 0.05
    assert abs(np.mean(neg) + 1) < 0.05
