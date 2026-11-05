import { useEffect, useState } from 'react'
import Icon from './Icon'
import { useNavigate } from 'react-router-dom'
import { orbitApi, type PassInfo, type SatelliteDetail as Detail } from '../api/orbit'
import { gameApi } from '../api/game'
import { useCatalogStore } from '../stores/catalogStore'
import { useGameStore, useTimeStore } from '../stores/gameStore'
import { useStationStore } from '../stores/stationStore'
import { useLang, fmt, tr } from '../i18n'

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
  const { t } = useLang()
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
          {t.detail.clickHint}
          <div className="mt-1 text-[13px]">{t.detail.clickSub}</div>
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
          <span className="chip text-ok border-ok/40">{t.detail.realOrbit}</span>
          {detail?.origin === 'tle_import' && <span className="chip text-signal">{t.detail.tleImport}</span>}
        </div>

        {err && <div className="text-danger">{err}</div>}

        {pos && !pos.error && (
          <section>
            <h3 className="text-ink-dim text-[13px] font-medium text-ink-dim mb-1.5">{t.detail.current}</h3>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 data">
              <KV k={t.detail.lat} v={`${pos.lat?.toFixed(2)}°`} />
              <KV k={t.detail.lon} v={`${pos.lon?.toFixed(2)}°`} />
              <KV k={t.detail.alt} v={`${pos.alt_km?.toFixed(0)} km`} />
              <KV k={t.detail.speed} v={`${pos.speed_km_s?.toFixed(2)} km/s`} />
            </div>
          </section>
        )}
        {pos?.error ? (
          <div className="text-danger text-[13px]">{fmt(t.detail.propFail, { msg: pos.error_msg ?? '' })}</div>
        ) : null}

        {detail && (
          <section>
            <h3 className="text-ink-dim text-[13px] font-medium text-ink-dim mb-1.5">{t.detail.elements}</h3>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 data">
              <KV k={t.detail.inclination} v={`${detail.omm.INCLINATION}°`} />
              <KV k={t.detail.period} v={`${(1440 / Number(detail.omm.MEAN_MOTION ?? 1)).toFixed(1)} min`} />
              <KV k={t.detail.ecc} v={detail.omm.ECCENTRICITY ?? '—'} />
              <KV k={t.detail.epoch} v={detail.omm.EPOCH?.slice(0, 16) ?? '—'} />
            </div>
            <div className={`mt-1 data text-[13px] ${ageClass(detail.data_age_hours)}`}>
              {detail.data_age_hours !== null ? fmt(t.detail.dataAge, { h: detail.data_age_hours }) : t.detail.ageUnknown}
              {detail.data_age_hours !== null && detail.data_age_hours > 72 && t.detail.precisionDrop}
            </div>
          </section>
        )}

        <section>
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-ink-dim text-[13px] font-medium text-ink-dim">{t.detail.passes48}</h3>
            {activeStation ? (
              <span className="chip text-ok border-ok/40">{activeStation.name}</span>
            ) : (
              <span className="chip text-warn">{t.detail.noStationSel}</span>
            )}
          </div>
          {!activeStation && (
            <p className="text-[13px] text-ink-dim leading-relaxed">{t.detail.noStationHint}</p>
          )}
          {activeStation && passes.length === 0 && (
            <p className="text-[13px] text-ink-dim">{fmt(t.detail.noPass, { el: activeStation.min_elevation_deg })}</p>
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
                    {new Date(p.aos).toLocaleDateString()} · {fmt(t.detail.duration, { min: (p.duration_s / 60).toFixed(1) })}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-signal">{fmt(t.detail.maxEl, { el: p.max_elevation_deg.toFixed(0) })}</div>
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
            title={!saveId ? t.detail.needSaveTitle : !activeStation ? t.detail.needStationTitle : t.detail.quickMissionTitle}
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
                setActionMsg(t.detail.plannedMsg)
              } catch (e) {
                setActionMsg(tr(e))
              }
            }}
            data-testid="quick-mission"
          >
            {t.detail.quickMission}
          </button>
          <button
            className="btn flex-1"
            disabled={!saveId}
            title={!saveId ? t.detail.needSaveTitle : t.detail.favTitle}
            onClick={async () => {
              if (!selectedId || !saveId) return
              try {
                await gameApi.favorite(selectedId, saveId)
                setActionMsg(t.detail.favedMsg)
              } catch (e) {
                setActionMsg(tr(e))
              }
            }}
            data-testid="quick-favorite"
          >
            {t.detail.fav}
          </button>
        </section>
        {actionMsg && <div className="text-[13px] text-signal">{actionMsg}</div>}
        {!saveId && (
          <button className="btn h-7 text-xs w-full" onClick={() => nav('/')}>
            {t.detail.enterSave}
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
