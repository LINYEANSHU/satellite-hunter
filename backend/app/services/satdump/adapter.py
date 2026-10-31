"""SatDump 独立进程适配器（需求 6.3）。

安全设计（需求 14.1）：
- 仅通过 CLI 调用，不修改 SatDump 源码
- 参数白名单：pipeline 必须来自 CLI 实际输出；输入路径限定在录波目录；
  输出固定在 decoded/{job_id}；标量参数做类型/范围校验
- 不使用 shell=True，杜绝注入

兼容性策略：首先探测当前 CLI 实际支持的命令与 pipeline 列表
（不同版本不一致），探测失败时如实报告而不是臆测。
"""
from __future__ import annotations

import json
import os
import queue
import re
import shutil
import subprocess
import threading
import time
from dataclasses import dataclass
from pathlib import Path

from app.core.config import settings
from app.core.logging import get_logger

log = get_logger(__name__)

_VERSION_RE = re.compile(r"satdump(?:\s+version)?[:\s]+v?([\w.\-]+)", re.IGNORECASE)
_PROGRESS_RE = re.compile(r"\b(\d{1,3})\s?%")


def _build_command(prefix: list[str], args: list[str]) -> list[str]:
    """Windows: 直接执行；WSL: 前缀 wsl -d <distro> -- bash -lc。"""
    if prefix:
        return prefix + ["bash", "-lc", " ".join(args)]
    return args


def satdump_invocation() -> tuple[list[str] | None, str, str | None]:
    """返回 (命令前缀, 来源标识, 版本)。未安装返回 (None, '', None)。"""
    which = shutil.which(settings.satdump_bin)
    if which:
        out = _run_quick([which, "--version"])
        m = _VERSION_RE.search(out)
        return [], "windows", m.group(1) if m else "unknown"
    wsl = shutil.which("wsl")
    if wsl:
        out = _run_quick(
            [wsl, "-d", settings.wsl_distro, "--", "bash", "-lc",
             "command -v satdump >/dev/null 2>&1 && satdump --version 2>/dev/null | head -2"]
        )
        if out.strip():
            m = _VERSION_RE.search(out)
            return [wsl, "-d", settings.wsl_distro, "--"], "wsl", m.group(1) if m else "unknown"
    return None, "", None


def _run_quick(cmd: list[str], timeout: float = 30.0) -> str:
    try:
        p = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
            shell=False,
        )
        return (p.stdout or "") + (p.stderr or "")
    except (OSError, subprocess.TimeoutExpired):
        return ""


@dataclass
class PipelineInfo:
    name: str
    desc: str


def list_pipelines() -> tuple[list[PipelineInfo], str]:
    """探测 CLI 实际支持的 pipeline 列表。返回 (列表, note)。"""
    prefix, source, version = satdump_invocation()
    if prefix is None:
        return [], "SatDump 未安装"
    base = prefix + [settings.satdump_bin]
    candidates = [
        base + ["pipelines"],
        base + ["pipeline", "list"],
        base + ["--help"],
    ]
    for cmd in candidates:
        out = _run_quick(_build_command(prefix, cmd), timeout=45)
        if not out:
            continue
        pipes = _parse_pipelines(out)
        if pipes:
            return pipes, f"来源: {source} {version or ''}".strip()
    return [], "无法从 CLI 输出解析 pipeline 列表（版本差异），请手动确认 satdump 命令行用法"


def _parse_pipelines(text: str) -> list[PipelineInfo]:
    """解析 satdump pipelines 输出。已知格式：

    - 'name  -  description' 或 'name: description' 行
    - 跳过空行/横线分隔/标题
    """
    out: list[PipelineInfo] = []
    for line in text.splitlines():
        line = line.strip()
        if not line or set(line) <= set("-= ") or line.lower().startswith(("available", "usage", "pipelines")):
            continue
        m = re.match(r"^([\w\-]+)\s*(?:-|:|\t)\s*(.+)$", line)
        if m:
            out.append(PipelineInfo(name=m.group(1), desc=m.group(2).strip()))
    return out


# ---------------------------------------------------------------- 任务执行
class _JobQueue:
    """单工作线程的解码任务队列（外部进程，可取消）。"""

    def __init__(self) -> None:
        self._q: queue.Queue = queue.Queue()
        self._thread: threading.Thread | None = None
        self._procs: dict[str, subprocess.Popen] = {}
        self._cancelled: set[str] = set()
        self._lock = threading.Lock()

    def _ensure_thread(self) -> None:
        if self._thread is None or not self._thread.is_alive():
            self._thread = threading.Thread(target=self._worker, daemon=True, name="satdump-worker")
            self._thread.start()

    def submit(self, job_id: str, runner) -> None:
        self._q.put((job_id, runner))
        self._ensure_thread()

    def cancel(self, job_id: str) -> bool:
        with self._lock:
            self._cancelled.add(job_id)
            proc = self._procs.get(job_id)
        if proc and proc.poll() is None:
            proc.terminate()
            return True
        return proc is not None

    def _worker(self) -> None:
        while True:
            job_id, runner = self._q.get()
            try:
                runner(job_id, self)
            except Exception as ex:  # runner 内部已处理常规错误；此处兜底
                log.exception("satdump job %s crashed", job_id)
                _set_job_state(job_id, "failed", error=str(ex))
            finally:
                with self._lock:
                    self._procs.pop(job_id, None)
                    self._cancelled.discard(job_id)


_job_queue = _JobQueue()


def _set_job_state(job_id: str, status: str, progress: float | None = None, error: str | None = None) -> None:
    """在独立会话中更新任务状态（工作线程与请求线程隔离）。"""
    from app.db.database import db_session
    from app.db.models import SatdumpJob

    with db_session() as db:
        job = db.get(SatdumpJob, job_id)
        if job is None:
            return
        job.status = status
        if progress is not None:
            job.progress = progress
        if error is not None:
            job.error = error
        if status in ("done", "failed", "cancelled"):
            from datetime import datetime

            job.ended_at = datetime.utcnow()


def build_command(job_params: dict, input_path: Path, output_dir: Path) -> list[str]:
    """构造 satdump CLI 参数（白名单）。调用方保证 input 在录波目录内。"""
    pipeline = job_params["pipeline"]
    args: list[str] = [settings.satdump_bin, "pipeline", pipeline, str(input_path), str(output_dir)]
    if job_params.get("samplerate"):
        args += ["--samplerate", str(int(float(job_params["samplerate"])))]
    if job_params.get("frequency"):
        args += ["--frequency", str(int(float(job_params["frequency"])))]
    if job_params.get("baseband_format"):
        bf = str(job_params["baseband_format"])
        if bf not in ("cu8", "cs8", "cs16", "cu16", "cf32", "cf64"):
            raise ValueError(f"不允许的 baseband_format: {bf}")
        args += ["--baseband_format", bf]
    if job_params.get("sat_name"):
        sn = re.sub(r"[^\w\- ]", "", str(job_params["sat_name"]))[:64]
        args += ["--sat_name", sn]
    return args


def validate_input_path(input_path: str) -> Path:
    p = Path(input_path).resolve()
    recordings_root = settings.recordings_dir.resolve()
    if recordings_root not in p.parents:
        raise ValueError(f"输入文件必须在录波目录内: {recordings_root}")
    if not p.exists():
        raise ValueError(f"输入文件不存在: {p}")
    return p


def start_job(job_id: str, recording_path: str, pipeline: str, params: dict, pipelines_known: list[str]) -> None:
    """排队执行解码任务（异步）。"""
    if pipeline not in pipelines_known:
        raise ValueError(f"未知 pipeline: {pipeline}（请先刷新 pipeline 列表）")
    input_path = validate_input_path(recording_path)
    output_dir = settings.decoded_dir / job_id
    output_dir.mkdir(parents=True, exist_ok=True)
    cmd = build_command({**params, "pipeline": pipeline}, input_path, output_dir)

    prefix, source, _ = satdump_invocation()
    if prefix is None:
        raise RuntimeError("SatDump 未安装")
    full = _build_command(prefix, cmd)

    log_path = settings.logs_dir / f"satdump_{job_id}.log"

    def runner(jid: str, q: _JobQueue) -> None:
        _set_job_state(jid, "running", progress=0.0)
        last_progress = 0.0
        try:
            with open(log_path, "w", encoding="utf-8", errors="replace") as lf:
                lf.write(f"$ {' '.join(full)}\n")
                lf.flush()
                proc = subprocess.Popen(
                    full,
                    stdout=lf,
                    stderr=subprocess.STDOUT,
                    shell=False,
                )
                with q._lock:
                    q._procs[jid] = proc
                # 等待退出并跟踪进度（读日志）
                while proc.poll() is None:
                    time.sleep(0.5)
                    if jid in q._cancelled:
                        proc.terminate()
                    try:
                        with open(log_path, "r", encoding="utf-8", errors="replace") as f2:
                            tail = f2.read()[-4096:]
                        m = None
                        for m in _PROGRESS_RE.finditer(tail):
                            pass
                        if m:
                            val = min(100.0, float(m.group(1)))
                            if val >= last_progress:
                                last_progress = val
                                _set_job_state(jid, "running", progress=val / 100.0)
                    except OSError:
                        pass
                rc = proc.returncode
            files = _collect_outputs(output_dir)
            from app.db.database import db_session

            with db_session() as db:
                from app.db.models import SatdumpJob

                job = db.get(SatdumpJob, jid)
                if job:
                    job.result_files = files
                    job.log_path = str(log_path)
                    job.output_dir = str(output_dir)
            if jid in q._cancelled:
                _set_job_state(jid, "cancelled", progress=last_progress / 100.0)
            elif rc == 0:
                _set_job_state(jid, "done", progress=1.0)
            else:
                _set_job_state(jid, "failed", error=f"satdump 退出码 {rc}")
        except Exception as ex:
            _set_job_state(jid, "failed", error=str(ex))

    from app.db.database import db_session

    with db_session() as db:
        from app.db.models import SatdumpJob

        job = db.get(SatdumpJob, job_id)
        if job:
            job.log_path = str(log_path)
            job.output_dir = str(output_dir)

    _job_queue.submit(job_id, runner)


def cancel_job(job_id: str) -> bool:
    return _job_queue.cancel(job_id)


def _collect_outputs(output_dir: Path) -> list[dict]:
    files = []
    if output_dir.exists():
        for f in sorted(output_dir.rglob("*")):
            if f.is_file():
                files.append(
                    {
                        "path": str(f.relative_to(output_dir)),
                        "size": f.stat().st_size,
                    }
                )
    return files
