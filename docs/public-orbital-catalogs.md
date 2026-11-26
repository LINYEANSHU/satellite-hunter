# 公开轨道目录

## 人造地球卫星

气象和业余无线电目录优先使用 SatNOGS DB 的公开 TLE 与发射机服务分类。气象目录在 SatNOGS 不可用时还会尝试 EUMETSAT 运营方发布的 NOAA、Suomi-NPP 和 Metop 要素。CelesTrak GP CSV 保留为补充源，遵循更新间隔与 Retry-After。

随包提供 **52 条气象卫星、154 条业余卫星**的 SatNOGS 快照，另保留原有 20 条空间站快照。SatNOGS 快照许可为 CC BY-SA 4.0，转换与归属见 [数据声明](../backend/app/data/orbit_seed/SATNOGS-DATA.md)。随包快照与用户后续获取的缓存分开存放。EUMETSAT 要素按需获取到本地。

游戏运行时，启动后在后台检查气象与业余目录，默认每 6 小时检查一次。成功取得的要素保存到本地。局部更新会按 NORAD 编号保留历元较新的要素，并保留此次未覆盖的卫星。取得目录失败时可继续读取有效缓存或随包快照。目录显示来源、获取时间和最新轨道历元。

设置 SH_ORBIT_AUTO_REFRESH_HOURS=0 关闭后台检查，设置 SH_ORBIT_OFFLINE=true 只使用本地卫星要素。位置、轨迹和过境都在本机通过 SGP4 计算。预测误差会随时刻与历元相隔时间增加。太阳系页面的 JPL 补查由用户主动发起。

[SatNOGS DB](https://wiki.satnogs.org/DB) · [EUMETSAT TLE](https://service.eumetsat.int/tle/) · [CelesTrak GP 格式](https://celestrak.org/NORAD/documentation/gp-data-formats.php) · [CelesTrak 使用政策](https://celestrak.org/usage-policy.php)

## 太阳系

离线目录含 8 个行星位置模型（地球项使用地月质心）、16,000 条已编号小行星要素、3,918 条去片段彗星要素。小天体数据来自 2026-11-25 的 NASA/JPL SBDB Query 请求。可按编号或名称向 JPL 补查离线目录之外的小天体，成功后要素保存在本地。

轨道使用日心 J2000 黄道坐标，以 AU 为单位。行星使用 JPL 1800–2050 年拟合。小天体从历元的瞬时轨道要素进行两体传播，支持椭圆、抛物线及双曲线。两体结果在远离历元或受到强摄动时误差会增大。教学图展示在给定时刻的轨迹和位置，精细历表可查看 JPL Horizons。

[行星近似位置](https://ssd.jpl.nasa.gov/planets/approx_pos.html) · [小天体目录查询](https://ssd-api.jpl.nasa.gov/doc/sbdb_query.html) · [单体要素查询](https://ssd-api.jpl.nasa.gov/doc/sbdb.html) · [JPL Horizons](https://ssd.jpl.nasa.gov/horizons/)

重新打包时将相同字段的两份 SBDB Query JSON 交给 scripts/pack-solar-catalog.py。随包数据与用户后续下载的数据分开存放。
