# Satellite Hunter: Ground Station — 开发计划

> 本文件是项目的任务分解与进度记录，随开发持续更新。
> 需求来源：`../项目需求书.md`

## 技术决策记录

| 决策 | 内容 | 原因 |
|---|---|---|
| 运行环境 | Windows 原生 Python 3.11 + Node 24 | 避免跨文件系统 I/O 瓶颈；满足"经验证兼容版本"要求 |
| SatDump | 独立进程 CLI 调用；同时探测 Windows PATH 与 WSL2 (Ubuntu-24.04) | 需求书要求独立进程集成，不复制源码 |
| 轨道数据 | CelesTrak GP (OMM JSON) + 本地磁盘缓存 | 需求书指定；支持离线回退 |
| 坐标转换 | TEME→ECEF 采用 GMST 旋转（与 skyfield/gpredict 一致的标准做法） | 轻量、无 astropy 重依赖；用参考值交叉验证 |
| 数据库 | SQLAlchemy 2.x + SQLite（同步，FastAPI threadpool） | 单机游戏规模足够，减少复杂度 |
| 前端 3D | React 18 + Three.js (@react-three/fiber 8) | 稳定组合 |
| 状态管理 | Zustand | 需求书指定 |
| UI | Tailwind CSS 3 | 需求书指定 |

## Phase 0：项目基础与环境检测 ✅

- [x] 环境检查（Python / Node / git / 网络 / WSL）
- [x] Git 仓库与目录结构
- [x] 后端：FastAPI 应用工厂、配置管理、日志系统、SQLite、健康检查、能力探测（/api/system/capabilities）
- [x] 前端：Vite + React + TS + Tailwind + Zustand，主界面骨架（10 个页面路由）
- [x] 一键开发脚本（scripts/dev.bat、scripts/dev.sh）
- [x] 基础单元测试（pytest）

## Phase 1：真实卫星探索系统

- [ ] CelesTrak GP 获取 + OMM JSON/CSV 解析 + TLE 兼容 + 磁盘缓存 + 限速（2h）
- [ ] SGP4 传播器（TEME 位置/速度、误差码处理、>5 位目录号）
- [ ] TEME→ECEF→大地坐标、方位角/仰角/距离
- [ ] 过境预测（AOS/LOS/TCA/最大仰角，最小仰角可配置）
- [ ] 时间控制（现实/暂停/1×/10×/100×/自定义/回当前，UTC 内部）
- [ ] 3D 地球（纹理、昼夜、大气、城市/地面站标注、拖拽缩放）
- [ ] 卫星渲染（Instancing、类别筛选、轨道线、地面轨迹、LOD）
- [ ] 卫星详情面板、收藏
- [ ] 地面站选址（地图点击）
- [ ] 测试：轨道传播参考值、坐标转换、可视窗口、FSPL、时区

## Phase 2：完整基础游戏

- [ ] 设备目录（天线/SDR/放大器/滤波器/转台/计算机/存储）+ 安装/升级/拆除
- [ ] 经济系统（Credits / RP / 电力 / 维护）
- [ ] 任务系统（7 类任务、日历、冲突、生命周期状态机）
- [ ] 简化 RF 模型（FSPL + 链路预算 + SNR + 确定性随机种子）
- [ ] 卫星图鉴（发现状态、分类、收藏）
- [ ] 数据收藏（来源标记 REAL_ORBIT / SIMULATED_RF / …）
- [ ] 成就系统 ≥30 个（事件驱动判定）
- [ ] 存档系统（多存档、保存/恢复）
- [ ] 任务执行动态界面（方位/仰角/距离/信号强度/进度/缓存）

## Phase 3：信号实验室

- [ ] IQ 导入（分块读取、格式解析 uint8/int8/int16/float32、元数据）
- [ ] 频谱 / 瀑布 / IQ 波形 / 星座图（后端分块计算 FFT）
- [ ] 录波回放控制
- [ ] SatDump 适配器（检测、版本、pipeline 列表、离线解码任务、日志、取消、结果解析）
- [ ] 实验结果管理 + 解码文件收藏
- [ ] 真实测试录波验证

## Phase 4：完整游戏体验

- [ ] 多地面站 + 全球覆盖可视化
- [ ] 自动调度（确定性规则）+ 玩家优先级规则
- [ ] 特殊事件（虚拟，明确标记）
- [ ] UI 动画、教程、更多图鉴与成就

## Phase 5：真实 SDR（预留接口）

- [ ] SDR 设备接口抽象、真实接收模式（数据来源 LIVE_SDR）
- [ ] 天线控制扩展接口、自动录制、多普勒补偿

## 进度日志

- 2026-10-31: 环境检查完成；项目骨架建立；开始 Phase 0。
