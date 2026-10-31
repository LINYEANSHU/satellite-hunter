# 系统架构

## 总览

```text
Satellite Hunter
│
├── Frontend (React 18 + TypeScript + Vite)          http://localhost:5273
│   ├── three/            3D 地球引擎（Three.js / R3F）
│   │   ├── Earth.tsx         昼夜混合 shader + Fresnel 大气
│   │   ├── SatelliteLayer    Points 批量渲染 + 采样插值
│   │   ├── OrbitPath         轨道线 + 地面投影
│   │   └── StationLayer      站点标记 + 覆盖圈
│   ├── pages/            10 个页面（探索/地面站/设备/任务/实验室/图鉴/成就/设置…）
│   ├── stores/           Zustand：gameStore(存档+时钟) / catalogStore(目录+轮询)
│   │                      / stationStore(站点) 
│   └── api/              类型化 API 客户端（client/orbit/game）
│
├── Backend (Python 3.11 + FastAPI)                   http://localhost:8000
│   ├── api/routes/       system / game(引导) / game2(存档设备任务图鉴成就)
│   │                     / game3(调度事件研究) / satellites / stations
│   │                     / recordings(+DSP+SatDump) / missions_ws(WebSocket)
│   ├── services/orbit/   catalog(CelesTrak+缓存) / omm(OMM/TLE解析)
│   │                     / propagator(SGP4批量) / transforms(坐标转换)
│   │                     / passes(过境预测)
│   ├── services/game/    equipment / rf_model / missions / achievements
│   │                     / scheduler / events(事件+研究)
│   ├── services/dsp/     IQ 分块读取 / 频谱 / 瀑布 / 统计
│   ├── services/satdump/ 独立进程适配器（白名单/任务队列/取消）
│   └── db/               SQLAlchemy 2.x + SQLite(WAL)
│
└── Data（backend/data/，运行时生成，已 gitignore）
    ├── satellite_hunter.db   游戏数据库
    ├── orbit_cache/          CelesTrak 分组缓存（JSON）
    ├── recordings/           上传的 IQ 录波
    ├── decoded/              SatDump 输出
    └── logs/                 运行日志 + 解码任务日志
```

## 关键设计决策

### 1. 惰性确定性仿真（无后台调度线程）

任务执行、特殊事件判定均为**仿真时间的确定性函数**：
- 前端持有锚点推导式时钟（`simTime = anchorSim + (Date.now()-anchorReal)×scale`），
  不依赖任何计时器推进，免疫浏览器标签页节流。
- 客户端轮询 `/api/missions/{id}/telemetry?at=<simTime>` 时，后端按需从 AOS
  积分到当前时刻（20s 步长 SGP4+链路预算），越过 LOS 即结算。
- 好处：时间任意跳转/回放结果一致（同种子）；服务重启无状态丢失。

### 2. 轨道计算链路

```
CelesTrak GP (OMM JSON) → 磁盘缓存（2h TTL + 离线回退 + 失败限速）
  → sgp4.omm.initialize → Satrec/SatrecArray（TEME）
  → GMST(IAU-82) 旋转 → ECEF → WGS84 大地坐标 / ENU 观察角
  → 过境预测（30s 粗扫描 + 二分细化 + 三分求 TCA）
```
交叉验证：Vallado SGP4 参考用例 + OMM↔TLE 等价性 + **Skyfield 独立实现对比**
（位置 <2km、观察角 <0.3°、48h 过境次数与 AOS <60s）。

### 3. 性能策略（需求 12）

- 卫星点：单 Points + DynamicDrawUsage，前端在两个服务端采样间直线插值
- 轮询降频：暂停且无时间跳转时 300ms→静默；轨道线仅在时间跳远时重取
- 大分组限制：positions ≤2000/次；调度扫描 ≤300 星；station passes ≤500 星
- DSP 全部后端分块按需计算，浏览器只收可视化数据

### 4. 数据真实性标记（需求 9.4）

所有外部世界数据携带 `source` 字段：
`REAL_ORBIT`（轨道/根数）、`SIMULATED_RF`（模拟接收）、`RECORDED_IQ`（导入录波）、
`DECODED_OUTPUT`（SatDump 输出）、`GAME_EVENT`（游戏事件，UI 显式标注"虚拟"）。
模拟接收结果由确定性链路模型+种子化抖动生成，绝不混入真实观测。

### 5. 安全

- SatDump：参数白名单（pipeline 来自 CLI 实际输出）、输入限定录波目录、
  无 shell 拼接、单工作线程、可取消
- 上传：512MB 上限、文件名消毒、仅写入专用目录
- Web 服务默认绑定 127.0.0.1；CORS 白名单本地开发端口
- 任何 SDR 硬件接入（Phase 5 预留）仅实现接收，不实现发射
