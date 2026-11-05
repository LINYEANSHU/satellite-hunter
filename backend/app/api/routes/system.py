"""系统级接口：健康检查、能力探测（SatDump / 磁盘 / 环境）。"""
from __future__ import annotations

import platform
import re
import shutil
import subprocess
import sys
import threading
import time

from fastapi import APIRouter

from app.core.config import settings
from app.core.logging import get_logger

router = APIRouter(tags=["system"])
log = get_logger(__name__)

_celestrak_status: dict = {"checked_at": 0.0, "reachable": None}

_SATDUMP_VERSION_RE = re.compile(r"satdump(?:\s+version)?[:\s]+v?([\w.\-]+)", re.IGNORECASE)

# SatDump 探测需要运行子进程（最长 15s + WSL 30s），结果缓存一段时间，
# 避免 /system/capabilities 与 /satdump/status 每次调用都重复探测。
# 缓存键包含探测目标（settings.satdump_bin / wsl_distro），目标变化时自动失效。
_SATDUMP_CACHE_TTL_S = 300.0
_satdump_cache: dict = {}
_satdump_lock = threading.Lock()


def _probe(cmd: list[str], timeout: float = 10.0) -> tuple[bool, str]:
    """运行探测命令，返回 (成功, stdout)。命令执行失败或超时不抛异常。"""
    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
            shell=False,
        )
        out = (proc.stdout or "") + (proc.stderr or "")
        return proc.returncode == 0, out
    except (OSError, subprocess.TimeoutExpired):
        return False, ""


def detect_satdump() -> dict:
    """探测 SatDump CLI：优先 Windows PATH，其次 WSL 发行版。

    只读探测，不修改任何系统状态。结果会被前端用于显示可用状态与安装指引。
    带短 TTL 缓存（子进程探测代价高，且安装状态在会话内极少变化）。
    """
    key = (settings.satdump_bin, settings.wsl_distro)
    with _satdump_lock:
        hit = _satdump_cache.get(key)
        if hit is not None and (time.time() - hit[0]) < _SATDUMP_CACHE_TTL_S:
            return dict(hit[1])
    result = _detect_satdump_impl()
    with _satdump_lock:
        _satdump_cache[key] = (time.time(), dict(result))
    return result


def _detect_satdump_impl() -> dict:
    result: dict = {
        "installed": False,
        "version": None,
        "source": None,
        "bin": None,
        "note": "",
    }

    # 1) Windows PATH
    which = shutil.which(settings.satdump_bin)
    if which:
        ok, out = _probe([which, "--version"], timeout=15)
        version = None
        m = _SATDUMP_VERSION_RE.search(out)
        if m:
            version = m.group(1)
        if ok or version:
            result.update(
                installed=True, version=version, source="windows", bin=which
            )
            return result

    # 2) WSL 发行版（需求书默认环境 Ubuntu 24.04）
    wsl_exe = shutil.which("wsl")
    if wsl_exe:
        ok, out = _probe(
            [wsl_exe, "-d", settings.wsl_distro, "--", "bash", "-lc",
             "command -v satdump >/dev/null 2>&1 && satdump --version 2>/dev/null | head -2"],
            timeout=30,
        )
        if ok and out.strip():
            version = None
            m = _SATDUMP_VERSION_RE.search(out)
            if m:
                version = m.group(1)
            result.update(
                installed=True,
                version=version or "unknown",
                source="wsl",
                bin=f"wsl:{settings.wsl_distro}:satdump",
            )
            return result

    result["note"] = (
        "未检测到 SatDump。信号解码功能不可用，游戏其余功能不受影响。"
        "安装指引见 docs/satdump.md。"
    )
    return result


@router.get("/health")
def health() -> dict:
    from datetime import datetime, timezone

    return {
        "status": "ok",
        "app": settings.app_name,
        "version": settings.version,
        "time_utc": datetime.now(timezone.utc).isoformat(),
        "python": sys.version.split()[0],
        "platform": platform.platform(),
    }


@router.get("/system/capabilities")
def capabilities() -> dict:
    """环境能力汇总：前端据此决定功能可用性与提示信息。"""
    settings.ensure_dirs()

    usage = shutil.disk_usage(settings.data_dir)
    cache_files = sorted(settings.orbit_cache_dir.glob("*.json")) if settings.orbit_cache_dir.exists() else []

    return {
        "app": {
            "name": settings.app_name,
            "version": settings.version,
            "python": sys.version.split()[0],
            "platform": platform.system(),
        },
        "satdump": detect_satdump(),
        "disk": {
            "free_gb": round(usage.free / 2**30, 2),
            "total_gb": round(usage.total / 2**30, 2),
        },
        "orbit": {
            "cache_dir": str(settings.orbit_cache_dir),
            "cached_groups": [f.stem for f in cache_files],
            "cache_ttl_hours": settings.orbit_cache_ttl_hours,
            "configured_groups": list(settings.orbit_groups),
        },
        "frontend_built": settings.frontend_dist.exists(),
        "data_dir": str(settings.data_dir),
    }
