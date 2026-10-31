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

## Phase 2：完整基础游戏 ✅ 2026-10-31

- [x] 设备目录（7 类，真实 RF 参数与游戏数值分离）+ 购买/安装/拆卸/出售 + 初始套件
- [x] 经济系统（Credits / RP / XP 等级 / 建站成本递增 / 维修）
- [x] 任务系统（6 类任务 + 频段覆盖校验 + 冲突检测 + 并发限制 + 惰性确定性状态机）
- [x] 简化 RF 模型（FSPL + 大气 + 指向 + 噪声 → SNR/质量/多普勒，SIMULATED_RF）
- [x] 卫星图鉴（tracked→received→decoded、收藏、分类）
- [x] 数据收藏（来源标记 REAL_ORBIT / SIMULATED_RF / …）
- [x] 成就系统 32 项（事件驱动判定）
- [x] 存档系统（多存档 CRUD、localStorage 会话恢复）
- [x] 任务执行动态界面（罗盘/SNR 条/多普勒/进度/数据缓存）
- [x] 浏览器 E2E：建站→任务→1000× 加速→结算→奖励→图鉴→4 项成就解锁

## Phase 3：信号实验室 ✅ 2026-10-31

- [x] IQ 导入（cu8/cs8/cs16/cu16/cf32、512MB 上限、文件名消毒）
- [x] 频谱/瀑布/IQ 波形/星座图（后端分块 FFT + Canvas 渲染）
- [x] 录波回放（播放/暂停/拖动联动视图）+ DC/裁剪/频偏统计
- [x] SatDump 适配器（Windows/WSL 探测、CLI 实际 pipeline 探测、参数白名单、
      路径穿越防护、任务队列/进度/取消/输出收集/DECODED_OUTPUT 收藏）
- [x] 测试：合成信号参考值（Fs/8 单音峰位/频偏估计/格式往返/BPSK 双簇）
      + mock satdump 全生命周期
- [x] 环境如实报告：开发环境无法静默安装 SatDump（WSL sudo 需密码），
      适配层已验证，安装指引 docs/satdump.md，其余功能不受影响

## Phase 4：完整游戏体验 ✅ 2026-10-31

- [x] 多地面站管理 + 覆盖圈可视化
- [x] 自动调度（确定性规则：频段覆盖→冲突→仰角/收藏/奖励加权评分，固定起点重放；
      真实 CelesTrak 数据验证）
- [x] 特殊事件（每游戏日种子判定：设备故障需维修/奖励窗口；幂等；GAME_EVENT 标注）
- [x] 研究系统（5 项 RP 解锁被动加成，前置链，接入 SNR/数据/奖励/调度上限）
- [x] 教程引导、事件 toast、全局时间控制条
- [x] 交付文档：架构/玩法/API/轨道数据/已知问题/许可（需求第十四节）

## Phase 5：真实 SDR（预留接口）

- [ ] SDR 设备接口抽象、真实接收模式（数据来源 LIVE_SDR）
- [ ] 天线控制扩展接口、自动录制、多普勒补偿

## 进度日志

- 2026-10-31: 环境检查（Python 3.11/Node 24/git/网络/WSL2 全可用）。
  Phase 0-4 全部交付，按阶段提交：23fbf11（后端基础设施+轨道系统）→
  a3fbde7（3D 探索前端）→ a6fbc10（游戏闭环）→ e9f701f（信号实验室）→
  298ecb6+（Phase 4 + 文档）。
  测试：后端 66 项（含 Skyfield 独立交叉验证、Vallado 参考值、mock SatDump
  生命周期）+ 前端 5 项；8 连跑稳定。
  浏览器端到端：存档→建站→任务→1000× 时间加速→自动结算→奖励→成就→
  图鉴；合成 BPSK 录波→频谱边带峰/星座双簇分析。
- 待办：SatDump 真实解码实测（用户安装后即可）、Phase 5 SDR 硬件接口、
  经济数值二轮调优。详见 docs/known-issues.md。
