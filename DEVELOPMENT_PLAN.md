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

## Phase 1：真实卫星探索系统 ✅ 2026-10-31

- [x] CelesTrak GP 获取 + OMM JSON/CSV 解析 + TLE 兼容 + 磁盘缓存 + 限速（2h）+ 离线回退
- [x] SGP4 传播（官方 sgp4.omm 路径 + TLE 路径，>5 位目录号，Alpha-5 上限 339999 已记录）
- [x] TEME→ECEF（GMST IAU-82）→WGS84、方位/仰角/距离/距离变化率、FSPL、多普勒
- [x] 过境预测（粗扫描 + 二分细化 + 三分求 TCA，最小仰角可配置）
- [x] 时间控制（锚点推导式时钟：现实/暂停/1×-1000×/自定义跳转/回现实，免疫标签页节流）
- [x] 3D 地球（昼夜 shader、大气、城市灯光纹理、拖拽缩放）
- [x] 卫星渲染（Points 批量 + 采样插值、类别配色、拾取、轨道线、地面轨迹）
- [x] 卫星详情面板（位置/根数/数据年龄/过境列表/来源标记）
- [x] 地面站选址（球面点击 + 弹窗 + 覆盖圈）
- [x] 测试：Vallado 参考值、OMM↔TLE 等价性、**Skyfield 独立交叉验证
      （位置 <2km、观察角 <0.3°、48h 过境次数与 AOS <60s）**

**验收结论：** 与独立轨道工具（Skyfield）核对通过 ✅；浏览器端到端
（建站→过境→时间加速）验证通过 ✅。提交：23fbf11、a3fbde7

## Phase 2：完整基础游戏（进行中）

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
