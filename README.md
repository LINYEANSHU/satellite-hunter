<p align="center">
  <img src="./assets/readme/hero.svg" width="100%" alt="Satellite Hunter：地面站模拟游戏 —— 真实 SGP4 轨道、过境预报、链路预算与 SatDump 信号解码">
</p>

<p align="center">
  <a href="README.en.md">English</a> · <b>中文</b>
</p>

<p align="center">
  <a href="https://github.com/LINYEANSHU/satellite-hunter/actions/workflows/ci.yml"><img src="https://github.com/LINYEANSHU/satellite-hunter/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License"></a>
  <img src="https://img.shields.io/badge/python-3.11%2B-3776AB?logo=python&logoColor=white" alt="Python 3.11+">
  <img src="https://img.shields.io/badge/node-22%2B-339933?logo=nodedotjs&logoColor=white" alt="Node 22+">
</p>

**Satellite Hunter** 是一款基于真实轨道数据的地面站模拟游戏：所有卫星都来自 CelesTrak 的真实两行根数（TLE/GP），用 SGP4 传播；过境预报、多普勒、链路预算全部按真实物理计算，而价格与奖励是游戏平衡数值。你练出来的是真的能用的技能。

## 玩法循环

```
选址建站 → 预报过境 → 追踪接收 → 解码分析 → 得分·成就·扩建
```

1. **选址建站** —— 在 3D 地球上点击任意位置放置地面站，设定最小仰角；
2. **预报过境** —— SGP4 传播 + 过境缓存，给出未来 24–72h 的 AOS/LOS、最高仰角与方位角；
3. **追踪接收** —— 转台实时指向卫星，监控方位/仰角、SNR、多普勒与数据缓存；
4. **解码分析** —— 导入 IQ 录波查看频谱/瀑布图/星座图，或交给外部 SatDump 真实解码；
5. **得分·成就·扩建** —— 赚取 Credits 与研究点数，解锁 36 项成就，把单站升级为全球观测网络。

无需任何无线电台硬件即可完整游玩；接上真实 SDR 录波后，分析流程同样适用。

## 特性

- **真实轨道系统**：CelesTrak GP/TLE 拉取 + 2 小时缓存限速，SGP4 全量传播，开发期经 Skyfield 交叉验证
- **过境预报引擎**：带缓存的过境搜索（AOS/LOS/最高仰角/AOS·LOS 方位角），临近过境自动倒计时提醒
- **物理合理的接收模型**：链路预算决定成败（设备增益、噪声系数、频段覆盖、转台指向），结果用种子化抖动保持可复现（SIMULATED_RF）
- **信号实验室**：频谱、瀑布图、IQ 波形、星座图；SatDump 以外部进程集成，解码产物可收藏进存档
- **36 项事件驱动成就** + 研究加成系统 + 确定性自动调度器
- **3D 地球**：Three.js 渲染地球、实时卫星位置、选中标记与尾迹、轨道线与地面站

## 快速开始

前置要求：Python 3.11+、Node.js 20+（CI 在 Node 22 上验证）。可选：SatDump（用于真实信号解码，未安装不影响其余功能，见 `docs/satdump.md`）。

### 一键启动

```bat
:: Windows（cmd / 双击）
scripts\dev.bat
```

```sh
# Git Bash / Linux / macOS
./scripts/dev.sh
```

脚本会自动创建虚拟环境、安装依赖，并启动后端（http://localhost:8000）与前端（http://localhost:5273）。浏览器访问 **http://localhost:5273**。

### 手动启动

```sh
# 后端
cd backend
python -m venv .venv
.venv/Scripts/activate          # Linux/macOS: source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

```sh
# 前端（另开终端）
cd frontend
npm install
npm run dev                     # http://localhost:5273
```

### 测试

```sh
cd backend && python -m pytest -q     # 后端单元/集成测试（77 项）
cd frontend && npm run test           # 前端测试（vitest）
```

## 架构简述

```
frontend (React + Three.js + Zustand)
   │  REST + WebSocket
backend (FastAPI)
   ├─ orbit/    CelesTrak GP 拉取 → 磁盘缓存 → SGP4 传播 → 过境搜索（带缓存）
   ├─ game/     存档、设备目录、任务调度、RF 链路模型、成就、事件、研究
   ├─ dsp/      录波导入、频谱/瀑布/星座统计
   └─ satdump/  外部 SatDump 进程适配层（Windows PATH / WSL）
SQLite 存档（backend/data/，全部运行数据可随时删除重建）
```

- **CelesTrak 拉取**：按分组（空间站/气象/业余/科学等）拉取 GP 数据，磁盘缓存 + 最小 2 小时重取间隔
- **SGP4 传播**：批量位置快照 + 前端插值，渲染热路径无逐帧 HTTP 请求
- **过境缓存**：站点×分组×时刻的过境结果落盘，重复查询零成本
- **SatDump 适配层**：检测本机 SatDump 可执行文件（或 WSL 发行版），提交解码作业并回传日志与产物

更多细节见 [docs/architecture.md](docs/architecture.md)、[docs/orbit-data.md](docs/orbit-data.md) 与 [docs/api.md](docs/api.md)。

## 文档

- [开发计划与进度](DEVELOPMENT_PLAN.md)
- [系统架构](docs/architecture.md)
- [轨道数据来源](docs/orbit-data.md)
- [玩法说明](docs/gameplay.md)
- [API 文档](docs/api.md)（运行时另有 http://localhost:8000/docs 自动生成交互式文档）
- [已知问题与后续计划](docs/known-issues.md)

## 参考与致谢

- [python-sgp4](https://github.com/brandon-rhodes/python-sgp4) —— 轨道传播核心（SGP4/SDP4）
- [Skyfield](https://github.com/skyfielders/python-skyfield) —— 开发期用于轨道计算交叉验证
- [CelesTrak](https://celestrak.org/) —— TLE/GP 轨道数据来源（感谢 Dr. T.S. Kelso）
- [SatDump](https://github.com/SatDump/SatDump) —— 外部卫星信号解码工具，以独立进程方式适配（GPL-3.0，归属信息见 [docs/licenses.md](docs/licenses.md)）
- [Three.js](https://github.com/mrdoob/three.js) 与 React 生态 —— 3D 地球可视化
- 页面影像来自 NASA（公有领域）与 Wikimedia Commons 摄影者（署名见主菜单页脚）

## 许可

本项目代码以 [MIT](LICENSE) 许可发布。依赖的第三方组件（SatDump 等）以独立进程方式集成，各自保留原有许可。
