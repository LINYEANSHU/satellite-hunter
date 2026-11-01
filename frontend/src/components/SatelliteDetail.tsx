import { useEffect, useState } from 'react'
import Icon from './Icon'
import { useNavigate } from 'react-router-dom'
import { orbitApi, type PassInfo, type SatelliteDetail as Detail } from '../api/orbit'
import { gameApi } from '../api/game'
import { useCatalogStore } from '../stores/catalogStore'
import { useGameStore, useTimeStore } from '../stores/gameStore'
import { useStationStore } from '../stores/stationStore'

function ageClass(h: number | null): string {
  if (h === null) return 'text-ink-dim'
  if (h > 24 * 30) return 'text-danger'
  if (h > 72) return 'text-warn'
  return 'text-ok'
}

/** 右侧面板：选中卫星详情 + 过境预测 + 快捷任务/收藏。 */
export default function SatelliteDetail() {
  const selectedId = useCatalogStore((s) => s.selectedId)
  const select = useCatalogStore((s) => s.select)
  const activeStation = useStationStore((s) => s.stations.find((x) => x.id === s.activeStationId))
  const saveId = useGameStore((s) => s.saveId)
  const nav = useNavigate()
  const [detail, setDetail] = useState<Detail | null>(null)
  const [passes, setPasses] = useState<PassInfo[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [actionMsg, setActionMsg] = useState<string | null>(null)

  useEffect(() => {
    if (!selectedId) {
      setDetail(null)
      setPasses([])
      return
    }
    let alive = true
    setErr(null)
    const load = () => {
      const atIso = new Date(useTimeStore.getState().now()).toISOString()
      orbitApi
        .detail(selectedId)
        .then((d) => alive && setDetail(d))
        .catch((e) => alive && setErr(e.message))
      if (activeStation) {
        orbitApi
          .passes(selectedId, activeStation.id, 48, atIso)
          .then((r) => alive && setPasses(r.passes))
          .catch(() => alive && setPasses([]))
      }
    }
    load()
    const iv = window.setInterval(load, 2000) // 详情低频刷新（未选中对象更低频原则）
    return () => {
      alive = false
      window.clearInterval(iv)
    }
  }, [selectedId, activeStation?.id])

  if (!selectedId) {
    return (
      <div className="panel h-full flex items-center justify-center text-ink-dim text-xs text-center px-4">
        <div>
          <Icon name="satellite" size={30} className="text-ink-faint mx-auto mb-2" />
          点击地球上的卫星点或左侧列表选择目标
          <div className="mt-1 text-[13px]">单击选中 · 再次单击取消</div>
        </div>
      </div>
    )
  }

  const pos = detail?.position
  return (
    <div className="panel h-full overflow-y-auto" data-testid="satellite-detail">
      <div className="panel-header">
        <span className="normal-case tracking-normal text-ink text-xs font-semibold">
          {detail?.name ?? '…'}
        </span>
        <button className="text-ink-dim hover:text-ink" onClick={() => select(null)}>
          <Icon name="close" size={13} />
        </button>
      </div>

      <div className="p-3 space-y-3 text-xs">
        <div className="flex items-center gap-2">
          <span className="chip">NORAD {selectedId}</span>
          <span className="chip text-ok border-ok/40">REAL_ORBIT</span>
          {detail?.origin === 'tle_import' && <span className="chip text-signal">TLE 导入</span>}
        </div>

        {err && <div className="text-danger">{err}</div>}

        {pos && !pos.error && (
          <section>
            <h3 className="text-ink-dim text-[13px] font-medium text-ink-dim mb-1.5">当前状态</h3>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 data">
              <KV k="纬度" v={`${pos.lat?.toFixed(2)}°`} />
              <KV k="经度" v={`${pos.lon?.toFixed(2)}°`} />
              <KV k="高度" v={`${pos.alt_km?.toFixed(0)} km`} />
              <KV k="速度" v={`${pos.speed_km_s?.toFixed(2)} km/s`} />
            </div>
          </section>
        )}
        {pos?.error ? (
          <div className="text-danger text-[13px]">轨道传播失败: {pos.error_msg}</div>
        ) : null}

        {detail && (
          <section>
            <h3 className="text-ink-dim text-[13px] font-medium text-ink-dim mb-1.5">轨道根数</h3>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 data">
              <KV k="倾角" v={`${detail.omm.INCLINATION}°`} />
              <KV k="周期" v={`${(1440 / Number(detail.omm.MEAN_MOTION ?? 1)).toFixed(1)} min`} />
              <KV k="偏心率" v={detail.omm.ECCENTRICITY ?? '—'} />
              <KV k="历元" v={detail.omm.EPOCH?.slice(0, 16) ?? '—'} />
            </div>
            <div className={`mt-1 data text-[13px] ${ageClass(detail.data_age_hours)}`}>
              数据年龄 {detail.data_age_hours !== null ? `${detail.data_age_hours} h` : '未知'}
              {detail.data_age_hours !== null && detail.data_age_hours > 72 && ' · 轨道精度已下降'}
            </div>
          </section>
        )}

        <section>
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-ink-dim text-[13px] font-medium text-ink-dim">未来 48h 过境</h3>
            {activeStation ? (
              <span className="chip text-ok border-ok/40">{activeStation.name}</span>
            ) : (
              <span className="chip text-warn">未选择地面站</span>
            )}
          </div>
          {!activeStation && (
            <p className="text-[13px] text-ink-dim leading-relaxed">
              在下方"选址"模式点击地球建立地面站后，即可预测该站的过境时间。
            </p>
          )}
          {activeStation && passes.length === 0 && (
            <p className="text-[13px] text-ink-dim">48 小时内无 ≥{activeStation.min_elevation_deg}° 的过境。</p>
          )}
          <div className="space-y-1">
            {passes.slice(0, 8).map((p) => (
              <div
                key={p.aos}
                className="flex items-center justify-between bg-ground-2 rounded px-2 py-1.5 data text-[13px]"
                data-testid="pass-row"
              >
                <div>
                  <div className="text-ink">{p.aos.slice(11, 16)} → {p.los.slice(11, 16)} UTC</div>
                  <div className="text-ink-dim text-[13px]">
                    {new Date(p.aos).toLocaleDateString()} · 时长 {(p.duration_s / 60).toFixed(1)} min
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-signal">最高 {p.max_elevation_deg.toFixed(0)}°</div>
                  <div className="text-ink-dim text-[13px]">AOS {p.aos_azimuth_deg.toFixed(0)}° → LOS {p.los_azimuth_deg.toFixed(0)}°</div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="flex gap-2 pt-1 border-transparent">
          <button
            className="btn btn-primary flex-1"
            disabled={!saveId || !activeStation}
            title={!saveId ? '请先进入存档' : !activeStation ? '请先建立地面站' : '以下一次过境创建信号捕获任务'}
            onClick={async () => {
              if (!selectedId || !saveId || !activeStation) return
              try {
                setActionMsg(null)
                await gameApi.createMission({
                  save_id: saveId,
                  station_id: activeStation.id,
                  satellite_id: selectedId,
                  type: 'capture',
                })
                setActionMsg('已规划捕获任务，前往任务控制中心查看')
              } catch (e) {
                setActionMsg(e instanceof Error ? e.message : String(e))
              }
            }}
            data-testid="quick-mission"
          >
            建立接收任务
          </button>
          <button
            className="btn flex-1"
            disabled={!saveId}
            title={!saveId ? '请先进入存档' : '收藏该卫星到图鉴'}
            onClick={async () => {
              if (!selectedId || !saveId) return
              try {
                await gameApi.favorite(selectedId, saveId)
                setActionMsg('已收藏')
              } catch (e) {
                setActionMsg(e instanceof Error ? e.message : String(e))
              }
            }}
            data-testid="quick-favorite"
          >
            收藏卫星
          </button>
        </section>
        {actionMsg && <div className="text-[13px] text-signal">{actionMsg}</div>}
        {!saveId && (
          <button className="btn h-7 text-xs w-full" onClick={() => nav('/')}>
            进入存档以启用任务与收藏
          </button>
        )}
      </div>
    </div>
  )
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-ink-dim">{k}</span>
      <span className="text-ink">{v}</span>
    </div>
  )
}
