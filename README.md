# Satellite Hunter: Ground Station

大型卫星探索与地面站模拟游戏。真实卫星轨道（CelesTrak GP / SGP4）+ 游戏化探索体验 + 无线电信号处理实验室（SatDump）。

![status](https://img.shields.io/badge/status-in%20development-orange)

## 快速开始

### 前置要求

- Python 3.11+（开发验证于 3.11.15）
- Node.js 20+（开发验证于 24.x）
- 可选：SatDump（信号解码用；未安装时游戏其余功能正常，见 `docs/satdump.md`）

### 一键启动

Windows（cmd / 双击）：

```bat
scripts\dev.bat
```

Git Bash / Linux / macOS：

```sh
./scripts/dev.sh
```

脚本会自动：创建 Python 虚拟环境 → 安装依赖 → 安装前端依赖 → 启动后端 (http://localhost:8000) 与前端 (http://localhost:5273)。

浏览器访问 **http://localhost:5273**。

### 手动启动

```sh
# 后端
cd backend
python -m venv .venv && .venv/Scripts/activate   # Linux: source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# 前端（另开终端）
cd frontend
npm install
npm run dev
```

## 测试

```sh
cd backend && python -m pytest -q      # 后端单元/集成测试
cd frontend && npm run test            # 前端测试 (vitest)
```

## 文档

- [开发计划与进度](DEVELOPMENT_PLAN.md)
- [系统架构](docs/architecture.md)
- [轨道数据来源](docs/orbit-data.md)
- [玩法说明](docs/gameplay.md)
- [API 文档](docs/api.md)（运行时另有 http://localhost:8000/docs 自动生成交互式文档）
- [已知问题与后续计划](docs/known-issues.md)

## 许可

- 本项目代码：MIT（见 LICENSE）
- 依赖的第三方组件（SatDump GPL-3.0 等）以独立进程方式集成，归属信息见 `docs/licenses.md`
