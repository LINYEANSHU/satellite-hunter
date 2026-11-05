"""Phase 3 SatDump 适配器测试。

使用 mock 可执行文件替代真实 satdump（ honest：仅替换外部进程本身，
适配器逻辑——pipeline 解析、参数白名单、任务生命周期、取消、路径校验——
全部按真实路径执行）。真实 SatDump 环境检测见 test_environment。
"""
from __future__ import annotations

import json
import os
import stat
import time
from pathlib import Path

import numpy as np
import pytest

MOCK_SATDUMP_PY = r'''
import sys, time, os, json
from pathlib import Path
# mock satdump：模拟真实 CLI 的两个子命令
args = sys.argv[1:]
if not args:
    print("satdump version v1.2.3-mock"); sys.exit(0)
if args[0] == "--version":
    print("SatDump v1.2.3-mock"); sys.exit(0)
if args[0] == "pipelines":
    print("Available pipelines:")
    print("metop_ahrpt   - MetOp AHRPT direct downlink")
    print("noaa_apt      - NOAA APT (137 MHz)")
    print("meteor_m2_x   - Meteor-M2 LRPT")
    sys.exit(0)
if args[0] == "pipeline":
    # pipeline <name> <input> <output> [opts...]
    name, inp, out = args[1], args[2], args[3]
    opts = args[4:]
    kv = {}
    for i, o in enumerate(opts):
        if o.startswith("--"):
            kv[o[2:]] = opts[i + 1] if i + 1 < len(opts) else ""
    # 模拟一个 90% 报错 + 慢速完成的管道（供取消测试）；其余快速产出文件
    if name == "noaa_apt" and "slow" in kv.get("sat_name", ""):
        for i in range(30):
            print(f"processing... {i*3}%", flush=True)
            time.sleep(0.2)
    Path(out).mkdir(parents=True, exist_ok=True)
    (Path(out) / "product.png").write_bytes(b"\x89PNG mock")
    (Path(out) / "result.json").write_text(json.dumps({"pipeline": name, "opts": kv}))
    print("done 100%")
    sys.exit(0)
print("unknown command", file=sys.stderr)
sys.exit(2)
'''


@pytest.fixture()
def mock_satdump(tmp_path, monkeypatch):
    """创建 mock satdump 可执行：Windows 用 .cmd 批处理，POSIX 用 shell 包装脚本。"""
    from app.core import config as cfg

    script = tmp_path / "mock_satdump.py"
    script.write_text(MOCK_SATDUMP_PY, encoding="utf-8")
    if os.name == "nt":
        cmd = tmp_path / "mock_satdump.cmd"
        # cmd.exe 以系统 ANSI 代码页(mbcs)解析批处理——venv 路径含中文，必须用 mbcs 编码
        cmd.write_bytes(
            f'@echo off\r\n"{os.sys.executable}" "%~dp0mock_satdump.py" %*\r\n'.encode("mbcs", "replace")
        )
    else:
        cmd = tmp_path / "mock_satdump"
        cmd.write_text(
            f'#!/bin/sh\nexec "{os.sys.executable}" "{script}" "$@"\n',
            encoding="utf-8",
        )
    cmd.chmod(cmd.stat().st_mode | stat.S_IEXEC)

    old_bin = cfg.settings.satdump_bin
    cfg.settings.satdump_bin = str(cmd)
    yield cmd
    cfg.settings.satdump_bin = old_bin


@pytest.fixture()
def save_id(client):
    from app.db.database import db_session
    from app.db.models import PlayerState, Save

    with db_session() as db:
        s = Save(name="信号实验室")
        db.add(s)
        db.flush()
        db.add(PlayerState(save_id=s.id))
        return s.id


def _upload_recording(client, save_id: str, tmp_path) -> dict:
    """上传一段已知合成录波（6000Hz 单音）。"""
    fs = 48000
    n = 65536
    t = np.arange(n) / fs
    iq = (0.6 * np.exp(2j * np.pi * (fs / 8) * t)).astype(np.complex64)
    data = np.empty(n * 2, dtype=np.float32)
    data[0::2] = iq.real
    data[1::2] = iq.imag
    p = tmp_path / "tone.iq"
    data.tofile(p)

    with open(p, "rb") as f:
        r = client.post(
            "/api/recordings/import",
            data={
                "save_id": save_id,
                "format": "cf32",
                "sample_rate_hz": fs,
                "center_frequency_hz": 137_000_000,
                "notes": "6000Hz 单音测试录波",
            },
            files={"file": ("tone.iq", f, "application/octet-stream")},
        )
    assert r.status_code == 200, r.text
    return r.json()


def test_recording_upload_and_spectrum(client, save_id, tmp_path):
    rec = _upload_recording(client, save_id, tmp_path)
    # detail 端点补充 IQ 元数据
    rec = client.get(f"/api/recordings/{rec['id']}").json()
    assert rec["samples"] == 65536
    assert rec["duration_s"] == pytest.approx(65536 / 48000, rel=1e-3)

    # 频谱峰在 Fs/8
    r = client.get(f"/api/recordings/{rec['id']}/spectrum", params={"fft": 1024, "avg": 8})
    assert r.status_code == 200
    body = r.json()
    peak_bin = int(np.argmax(body["db"]))
    peak_freq = (peak_bin - 512) * 48000 / 1024
    assert abs(peak_freq - 6000) < 48000 / 1024

    # 统计
    r = client.get(f"/api/recordings/{rec['id']}/stats")
    assert abs(r.json()["freq_offset_hz"] - 6000) < 100

    # 瀑布图
    r = client.get(f"/api/recordings/{rec['id']}/waterfall", params={"rows": 32, "fft": 128})
    assert r.status_code == 200
    assert len(r.json()["db"]) == 32

    # 星座图 / 波形
    for ep in ("constellation", "waveform"):
        r = client.get(f"/api/recordings/{rec['id']}/{ep}", params={"n": 1000})
        assert r.status_code == 200

    # 删除
    r = client.delete(f"/api/recordings/{rec['id']}")
    assert r.status_code == 200
    assert client.get("/api/recordings", params={"save_id": save_id}).json() == []


def test_recording_bad_format_rejected(client, save_id, tmp_path):
    p = tmp_path / "x.iq"
    p.write_bytes(b"\x00" * 1024)
    with open(p, "rb") as f:
        r = client.post(
            "/api/recordings/import",
            data={"save_id": save_id, "format": "wav"},
            files={"file": ("x.iq", f)},
        )
    assert r.status_code == 400


def test_satdump_pipelines_mock(mock_satdump, client):
    r = client.post("/api/satdump/pipelines")
    assert r.status_code == 200
    body = r.json()
    names = {p["name"] for p in body["pipelines"]}
    assert {"noaa_apt", "metop_ahrpt", "meteor_m2_x"} <= names


def test_satdump_job_lifecycle(mock_satdump, client, save_id, tmp_path):
    rec = _upload_recording(client, save_id, tmp_path)
    # 刷新 pipeline 缓存
    client.post("/api/satdump/pipelines")

    r = client.post(
        "/api/satdump/jobs",
        json={
            "save_id": save_id,
            "recording_id": rec["id"],
            "pipeline": "noaa_apt",
            "samplerate": 48000,
            "frequency": 137_000_000,
            "baseband_format": "cf32",
        },
    )
    assert r.status_code == 200, r.text
    job = r.json()

    # 等待完成（mock 很快）
    for _ in range(50):
        j = client.get(f"/api/satdump/jobs/{job['id']}").json()
        if j["status"] in ("done", "failed", "cancelled"):
            break
        time.sleep(0.2)
    assert j["status"] == "done", j
    assert j["progress"] == 1.0
    files = {f["path"] for f in j["result_files"]}
    assert "product.png" in files

    # 收藏到图鉴
    r = client.post(
        f"/api/satdump/jobs/{job['id']}/collect",
        json={"save_id": save_id, "title": "NOAA APT 解码测试", "satellite_id": 28654},
    )
    assert r.status_code == 200
    assert r.json()["source"] == "DECODED_OUTPUT"


def test_satdump_unknown_pipeline_rejected(mock_satdump, client, save_id, tmp_path):
    rec = _upload_recording(client, save_id, tmp_path)
    r = client.post(
        "/api/satdump/jobs",
        json={"save_id": save_id, "recording_id": rec["id"], "pipeline": "not_a_pipeline"},
    )
    assert r.status_code == 422


def test_satdump_path_traversal_blocked(mock_satdump, client, save_id, tmp_path):
    """安全：输入路径限定在录波目录内（需求 14.1）。"""
    from app.services.satdump.adapter import validate_input_path

    outside = tmp_path / "evil.iq"
    outside.write_bytes(b"\x00" * 64)
    with pytest.raises(ValueError):
        validate_input_path(str(outside))


def test_satdump_cancel(mock_satdump, client, save_id, tmp_path):
    """取消运行中的任务（mock slow 管道）。"""
    rec = _upload_recording(client, save_id, tmp_path)
    client.post("/api/satdump/pipelines")

    r = client.post(
        "/api/satdump/jobs",
        json={
            "save_id": save_id,
            "recording_id": rec["id"],
            "pipeline": "noaa_apt",
            "sat_name": "slow test",
        },
    )
    assert r.status_code == 200
    job = r.json()
    time.sleep(0.8)  # 让它进入 running
    r = client.post(f"/api/satdump/jobs/{job['id']}/cancel")
    assert r.status_code == 200
    for _ in range(30):
        j = client.get(f"/api/satdump/jobs/{job['id']}").json()
        if j["status"] in ("cancelled", "failed", "done"):
            break
        time.sleep(0.2)
    assert j["status"] in ("cancelled", "failed")  # 取消或被终止


def test_satdump_status_reports(mock_satdump, client):
    r = client.get("/api/satdump/status")
    assert r.status_code == 200
    body = r.json()
    assert body["installed"] is True
    assert body["source"] == "windows"
