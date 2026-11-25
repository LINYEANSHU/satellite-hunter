# 公开轨道目录

## 人造地球卫星

在线目录使用 CelesTrak GP 的 OMM CSV。每个分组以两小时为最短更新周期。遇到服务拒绝、限流或 5xx 时会暂缓请求，并读取上次可用缓存。随包空间站快照包含 20 条记录，采集于 2026-11-01 UTC。界面显示快照和轨道历元，轨道通过原有 SGP4 地球参考系求解。历史历元适用于离线演示，预测误差会随时间增加，实际过境需要近期要素。

设置 SH_ORBIT_OFFLINE=true 可只使用本地人造卫星要素。太阳系页面的 JPL 补查由用户主动发起。

[CelesTrak GP 格式](https://celestrak.org/NORAD/documentation/gp-data-formats.php) · [CelesTrak 使用政策](https://celestrak.org/usage-policy.php)

## 太阳系

离线目录含 8 个行星位置模型（地球项使用地月质心）、16,000 条已编号小行星要素、3,918 条去片段彗星要素。小天体数据来自 2026-11-25 的 NASA/JPL SBDB Query 请求。可按编号或名称向 JPL 补查离线目录之外的小天体，成功后要素保存在本地。

轨道使用日心 J2000 黄道坐标，以 AU 为单位。行星使用 JPL 1800–2050 年拟合。小天体从历元的瞬时轨道要素进行两体传播，支持椭圆、抛物线及双曲线。两体结果在远离历元或受到强摄动时误差会增大。教学图展示在给定时刻的轨迹和位置，精细历表可查看 JPL Horizons。

[行星近似位置](https://ssd.jpl.nasa.gov/planets/approx_pos.html) · [小天体目录查询](https://ssd-api.jpl.nasa.gov/doc/sbdb_query.html) · [单体要素查询](https://ssd-api.jpl.nasa.gov/doc/sbdb.html) · [JPL Horizons](https://ssd.jpl.nasa.gov/horizons/)

重新打包时将相同字段的两份 SBDB Query JSON 交给 scripts/pack-solar-catalog.py。随包数据与用户后续下载的数据分开存放。
