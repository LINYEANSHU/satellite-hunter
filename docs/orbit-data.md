# 轨道数据来源与说明

## 数据源

- **CelesTrak GP 数据**（https://celestrak.org/NORAD/elements/），
  请求 `gp.php?GROUP=<group>&FORMAT=json`，即 OMM（Orbit Mean-Elements Message）JSON 格式。
- 遵守 CelesTrak 使用政策：同一分组最新数据请求间隔 **≥ 2 小时**（`SH_ORBIT_CACHE_TTL_HOURS` 可调），
  失败后 10 分钟内不重试，避免对上游形成压力。
- 内置分组：空间站 / 气象 / 业余无线电 / 科学 / 肉眼可见 / 地球静止 / 全部活跃（约 2 万颗，首次加载较慢）。

## 缓存与离线

- 分组数据缓存于 `backend/data/orbit_cache/<group>.json`，内含 `fetched_at` 与全部 OMM 记录。
- 在线获取失败时自动回退到最近缓存并在 UI 标记"缓存过期"（数据年龄与历元随时可见）。
- 无网络且无缓存时返回明确错误（`ORBIT_DATA_UNAVAILABLE`），不伪造数据。

## 传播

- SGP4：python-sgp4（Vallado 参考实现的官方移植），OMM 路径使用库自带
  `sgp4.omm.initialize`（单位换算以库实现为准，项目测试交叉验证）。
- TLE 兼容：`twoline2rv` 直接解析；用户可粘贴 2 行/3 行 TLE 导入（并入"用户导入"分组）。
- 坐标：TEME→ECEF 采用 GMST(IAU-82) 旋转，速度含 ω×r 牵连项（多普勒计算用）。
- 目录号：全链路 int 存储，支持超过 5 位（>5 位经 SGP4 Alpha-5 编码，库上限 339999，
  当前 NORAD 目录约 6 万，数十年内不会触及；图鉴/API 层始终为完整整数）。

## 精度与限制（如实声明）

- SGP4 本身精度：LEO 约 1-3 km 级（取决于根数年龄）；历元超过 72h UI 显示精度警告，
  超过 30 天红色警告。远期预测不宣称准确。
- 本项目传播链路与 Skyfield 独立交叉验证：位置 <2 km、观察角 <0.3°、
  48h 过境次数与 AOS 时刻 <60 s（见 `backend/tests/test_cross_validation.py`，
  需网络下载 de421.bsp 后离线可跑）。
- 历史时间传播：SGP4 使用历元附近的根数外推，超出合理窗口（约 ±2 周）精度快速
  下降，游戏内通过数据年龄警告呈现，不提供"历史精确回放"承诺。

## 已知卫星频率数据

`backend/app/data/rf_assumptions.json`：
- `known_satellites`：ISS/天宫/NOAA 系列/Meteor 等约 10 颗知名目标的公开频率与模式；
- `category_defaults`：无可靠公开参数的卫星使用类别默认值，**在 UI 中明确标注为游戏假设**；
- 发射功率/所需 SNR 等属于游戏平衡数值，不代表真实规格。
