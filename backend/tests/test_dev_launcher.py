"""The Bash launcher must import the backend when started at the repository root."""
from __future__ import annotations

import json
import os
from pathlib import Path
import shlex
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request


def test_bash_backend_entry_starts_from_repository_root(tmp_path):
    root = Path(__file__).resolve().parents[2]
    line = next(line for line in (root / "scripts/dev.sh").read_text(encoding="utf-8").splitlines()
                if line.startswith('"$PYBIN" -m uvicorn '))
    args = shlex.split(line)[1:]
    args.remove("&")
    args.remove("--reload")  # Exercise the application entry, without a file watcher.
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    args[args.index("--port") + 1] = str(port)
    args.extend(["--host", "127.0.0.1", "--lifespan", "off"])
    env = {**os.environ, "SH_DATA_DIR": str(tmp_path / "runtime")}
    log_path = tmp_path / "launcher.log"
    response = None
    with log_path.open("w", encoding="utf-8") as log:
        process = subprocess.Popen([sys.executable, *args], cwd=root, env=env,
                                   stdout=log, stderr=subprocess.STDOUT)
        try:
            deadline = time.monotonic() + 15
            while time.monotonic() < deadline and process.poll() is None:
                try:
                    with urllib.request.urlopen(f"http://127.0.0.1:{port}/openapi.json", timeout=1) as reply:
                        response = json.load(reply)
                    break
                except (OSError, urllib.error.URLError):
                    time.sleep(0.1)
        finally:
            if process.poll() is None:
                process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
    assert response is not None, log_path.read_text(encoding="utf-8", errors="replace")
    assert response["info"]["title"] == "Satellite Hunter: Ground Station"
