# API 文档

运行时交互式文档：**http://localhost:8000/docs**（OpenAPI 自动生成）。
所有响应错误格式统一：`{"error": {"code": "...", "message": "..."}}`。

## 系统

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | 健康检查 |
| GET | `/api/system/capabilities` | 环境能力（SatDump/磁盘/轨道缓存） |

## 存档与会话

| 方法 | 路径 | 说明 |
|---|---|---|
| GET/POST/DELETE | `/api/saves[/{id}]` | 存档 CRUD |
| POST | `/api/game/bootstrap` | 幂等引导默认存档 |
| GET | `/api/game/state?save_id=` | 完整会话状态（更新 last_played） |

## 卫星与轨道

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/satellites/groups` | 分组缓存状态 |
| GET | `/api/satellites?group=&q=&limit=&offset=` | 目录列表/搜索 |
| GET | `/api/satellites/{norad_id}` | 详情 + 实时位置（REAL_ORBIT） |
| GET | `/api/satellites/{norad_id}/track?minutes=&step_s=&at=` | 轨迹点（ECEF+大地） |
| GET | `/api/satellites/{norad_id}/passes?station_id=&hours=&min_el=&at=` | 单星过境预测 |
| GET | `/api/satellites/positions?group=&at=&ids=&max_n=` | 批量位置（紧凑数组） |
| POST | `/api/satellites/refresh` `{group}` | 强制刷新（受 2h 限速） |
| POST | `/api/satellites/import_tle` `{text}` | TLE 导入（兼容旧格式） |

## 地面站

| 方法 | 路径 | 说明 |
|---|---|---|
| GET/POST | `/api/stations` | 列表 / 建站（第 n 站成本 2000×n，赠初始设备） |
| PATCH/DELETE | `/api/stations/{id}` | 更新 / 删除 |
| GET | `/api/stations/{id}/passes?group=&hours=&min_el=&at=` | 批量过境（≤500 星） |

## 设备

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/equipment/catalog` | 设备目录（7 类） |
| GET | `/api/equipment?save_id=` | 拥有设备 |
| POST | `/api/equipment/buy` | 购买 |
| POST | `/api/equipment/{id}/install` / `unequip` | 安装/拆卸 |
| DELETE | `/api/equipment/{id}?save_id=` | 出售（半价） |
| POST | `/api/game/equipment/{id}/repair` | 维修故障设备 |

## 任务

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/missions?save_id=&status=` | 任务列表 |
| POST | `/api/missions` | 创建（校验频段/可见性/冲突） |
| POST | `/api/missions/{id}/start` / `cancel` | 启动/取消 |
| GET | `/api/missions/{id}/telemetry?at=` | 实时遥测（惰性推进状态机+结算） |

## 调度 / 事件 / 研究

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/game/scheduler/plan` | 调度建议/应用（确定性规则，支持 at 重放） |
| GET | `/api/game/events?save_id=` | 事件流 |
| POST | `/api/game/events/check` | 惰性日事件判定（幂等） |
| GET | `/api/game/research?save_id=` | 研究列表与已生效加成 |
| POST | `/api/game/research/{id}/unlock` | 解锁研究 |

## 图鉴 / 成就

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/collection?save_id=` | 卫星图鉴 |
| POST | `/api/collection/{satellite_id}/favorite?save_id=` | 收藏切换 |
| GET/POST | `/api/collection/items` | 数据收藏（带来源标记） |
| GET | `/api/achievements?save_id=` | 成就状态（32 项） |

## 录波 / DSP / SatDump

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/recordings/import` | multipart 上传（≤512MB） |
| GET | `/api/recordings/{id}/spectrum / waterfall / constellation / waveform / stats` | 分块 DSP 分析 |
| GET | `/api/satdump/status` / POST `/api/satdump/pipelines` | 探测 |
| POST/GET | `/api/satdump/jobs[/{id}]` | 解码任务（进度/结果文件） |
| GET | `/api/satdump/jobs/{id}/log` | 任务日志 |
| POST | `/api/satdump/jobs/{id}/cancel` / `collect` | 取消 / 收藏（DECODED_OUTPUT） |

## WebSocket

`ws://localhost:8000/ws/{topic}` — 按 topic 广播；客户端可发 `{"action":"ping"}`
心跳。预留用于任务进度与解码事件推送（当前 UI 采用轮询，保证一致性优先）。
