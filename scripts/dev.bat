@echo off
rem Satellite Hunter 一键开发启动（Windows）
setlocal
cd /d "%~dp0.."

echo [Satellite Hunter] 检查后端虚拟环境...
if not exist backend\.venv\Scripts\python.exe (
  echo 创建 Python 虚拟环境...
  pushd backend
  python -m venv .venv || goto :error
  .venv\Scripts\python.exe -m pip install --upgrade pip -q || goto :error
  .venv\Scripts\python.exe -m pip install -r requirements.txt -q || goto :error
  popd
)

echo [Satellite Hunter] 检查前端依赖...
if not exist frontend\node_modules (
  pushd frontend
  npm install --no-audit --no-fund || goto :error
  popd
)

echo 启动后端 (http://localhost:8000) 与前端 (http://localhost:5173)...
start "SH-Backend" cmd /k "cd /d %~dp0..\backend && .venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000"
start "SH-Frontend" cmd /k "cd /d %~dp0..\frontend && npm run dev"
timeout /t 3 /nobreak >nul
start http://localhost:5173
echo 完成。两个服务窗口已启动，浏览器即将打开。
goto :eof

:error
echo 启动失败，请检查上方错误信息。
exit /b 1
