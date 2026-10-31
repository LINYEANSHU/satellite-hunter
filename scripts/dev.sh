#!/usr/bin/env bash
# Satellite Hunter 一键开发启动（Git Bash / Linux / macOS）
set -e
cd "$(dirname "$0")/.."

# 定位 venv python（Windows venv 与 Linux venv 布局不同）
find_venv_python() {
  for p in backend/.venv/Scripts/python.exe backend/.venv/bin/python; do
    [ -f "$p" ] && { echo "$p"; return; }
  done
  echo ""
}

PYBIN="$(find_venv_python)"
if [ -z "$PYBIN" ]; then
  echo "创建 Python 虚拟环境..."
  (cd backend && python -m venv .venv)
  PYBIN="$(find_venv_python)"
  "$PYBIN" -m pip install --upgrade pip -q
  "$PYBIN" -m pip install -r backend/requirements.txt -q
fi

echo "[Satellite Hunter] 检查前端依赖..."
if [ ! -d frontend/node_modules ]; then
  (cd frontend && npm install --no-audit --no-fund)
fi

echo "启动后端 (http://localhost:8000)..."
"$PYBIN" -m uvicorn app.main:app --reload --port 8000 &
BACK_PID=$!

echo "启动前端 (http://localhost:5273)..."
(cd frontend && npm run dev) &
FRONT_PID=$!

trap 'kill $BACK_PID $FRONT_PID 2>/dev/null' EXIT
echo "浏览器访问 http://localhost:5273 （Ctrl+C 停止全部服务）"
wait
