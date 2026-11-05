import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CATEGORY_LABELS, gameApi, phase4Api, type EquipmentItem } from '../api/game'
import PageHeader from '../components/PageHeader'
import Icon from '../components/Icon'
import { useGameStore } from '../stores/gameStore'
import { useStationStore } from '../stores/stationStore'
import { useCatalogStore } from '../stores/catalogStore'
import { useLang, fmt, tr } from '../i18n'
import StationScene, { setSceneStation } from '../three/StationScene'

/** 地面站：3D 场景（转台实时指向选中卫星）+ 设备槽位管理。 */
export default function StationPage() {
  const nav = useNavigate()
  const saveId = useGameStore((s) => s.saveId)
  const stations = useStationStore((s) => s.stations)
  const activeId = useStationStore((s) => s.activeStationId)
  const setActive = useStationStore((s) => s.setActive)
  const bootstrap = useStationStore((s) => s.bootstrap)
  const selectedSatId = useCatalogStore((s) => s.selectedId)
  const [items, setItems] = useState<EquipmentItem[]>([])
  const [busy, setBusy] = useState(false)
  const { t } = useLang()

  const reload = useCallback(async () => {
    if (!saveId) return
    await bootstrap()
    setItems(await gameApi.equipment(saveId))
  }, [saveId, bootstrap])

  useEffect(() => {
    void reload()
  }, [reload])

  const station = stations.find((s) => s.id === activeId) ?? stations[0]

  // 给 3D 场景提供当前站坐标
  useEffect(() => {
    setSceneStation(station ? { lat: station.lat, lon: station.lon, alt_m: station.alt_m } : null)
    return () => setSceneStation(null)
  }, [station?.lat, station?.lon])

  const slots = useMemo(() => {
    const byCat: Record<string, EquipmentItem | undefined> = {}
    for (const it of items) {
      if (it.station_id === station?.id && it.category) byCat[it.category] = it
    }
    return byCat
  }, [items, station])

  const inventory = useMemo(() => items.filter((i) => !i.station_id), [items])

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await fn()
      await reload()
    } catch (e) {
      alert(tr(e))
    } finally {
      setBusy(false)
    }
  }

  if (!saveId) {
    return (
      <div className="h-full panel flex items-center justify-center">
        <div className="text-center text-sm text-ink-dim">
          {t.station.noSave}
          <button className="btn ml-3" onClick={() => nav('/')}>
            {t.station.backMenu}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col gap-3 min-h-0">
      <PageHeader
        title={t.station.title}
        subtitle={t.station.subtitle}
        right={
          stations.length > 1 ? (
            <select className="input !w-40" value={activeId ?? ''} onChange={(e) => setActive(e.target.value)}>
              {stations.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          ) : (
            <span className="text-[12px] text-ink-dim">{t.station.rotHint}</span>
          )
        }
      />

      {!station ? (
        <div className="panel p-6 text-sm text-ink-dim flex-1 flex flex-col items-center justify-center gap-4">
          <img
            src="/photos/antennas-at-awarua-satellite-ground-station.jpg"
            alt={t.station.arrayPhoto}
            className="max-h-48 rounded-lg object-cover"
          />
          <p>
            {t.station.noStation}
            <button className="btn btn-primary mx-2 h-7 text-xs" onClick={() => nav('/explorer')}>
              {t.station.goExplorer}
            </button>
            {t.station.noStationTail}
          </p>
        </div>
      ) : (
        <div className="flex-1 flex gap-3 min-h-0">
          {/* 左：3D 场景 + 站点信息 */}
          <div className="flex-1 min-w-0 flex flex-col gap-3">
            <div className="flex-1 panel overflow-hidden relative min-h-[300px]">
              <StationScene equipment={slots} />
              <div className="absolute top-2.5 left-2.5 flex flex-col gap-1 pointer-events-none rise">
                <div className="tag bg-ground-1/90">{station.name}</div>
                <div className="tag bg-ground-1/90 data">
                  {station.lat.toFixed(2)}°, {station.lon.toFixed(2)}° · {station.alt_m}m
                </div>
                {selectedSatId && (
                  <div className="tag bg-signal/15 text-signal" data-testid="tracking-hint">
                    {fmt(t.station.tracking, { id: selectedSatId })}
                  </div>
                )}
              </div>
              <div className="absolute bottom-2.5 right-2.5 pointer-events-none">
                <span className="tag bg-ground-1/90">{t.station.demoNote}</span>
              </div>
            </div>

            {/* 站点概览 + 真实照片 */}
            <div className="grid grid-cols-3 gap-3 shrink-0">
              <section className="panel col-span-2">
                <div className="panel-header">{t.station.params}</div>
                <div className="p-3 text-[13px] grid grid-cols-3 gap-x-4 gap-y-1.5">
                  <Spec k={t.station.minEl} v={`${station.min_elevation_deg}°`} />
                  <Spec k={t.station.status} v={station.status === 'active' ? t.station.running : station.status} cls="text-ok" />
                  <Spec k={t.station.type} v={station.is_virtual ? t.station.virtual : t.station.real} />
                  <Spec k={t.station.maint} v={`${Math.round(station.maintenance)}%`} />
                  <Spec k={t.station.equip} v={fmt(t.station.equipN, { n: Object.values(slots).filter(Boolean).length })} />
                  <Spec k={t.station.cost} v={nStationCost(stations, station.id, t)} />
                </div>
              </section>
              <div className="panel overflow-hidden relative min-h-[104px]">
                <img
                  src="/photos/erdfunkstelle-raisting-2.jpg"
                  alt={t.station.antennaPhoto}
                  className="absolute inset-0 w-full h-full object-cover opacity-80"
                />
                <span className="absolute bottom-1.5 left-2 text-[12px] text-ink/90">
                  {t.station.realAntenna}
                </span>
              </div>
            </div>
          </div>

          {/* 右：设备槽位 + 库存 */}
          <div className="w-80 shrink-0 flex flex-col gap-3 overflow-y-auto">
            <section className="panel">
              <div className="panel-header">
                <span>{t.station.slots}</span>
                <span className="data text-[12px] text-warn">
                  ₡{Math.round(useGameStore.getState().credits).toLocaleString()}
                </span>
              </div>
              <div className="p-2 space-y-1.5">
                {Object.entries(CATEGORY_LABELS).map(([cat]) => {
                  const eq = slots[cat]
                  return (
                    <div
                      key={cat}
                      className={`rounded-md px-2.5 py-2 text-[13px] ${eq ? 'bg-ground-2' : 'bg-ground-1 opacity-60'}`}
                      data-testid={`slot-${cat}`}
                    >
                      <div className="flex justify-between items-center mb-0.5">
                        <span className="text-ink-dim text-[12.5px]">
                          {(t.equip.cats as Record<string, string>)[cat] ?? cat}
                        </span>
                        {eq && (
                          <span
                            className={`inline-flex items-center gap-1 text-[12.5px] ${eq.status === 'ok' ? 'text-ok' : 'text-danger'}`}
                          >
                            <span className={`status-dot ${eq.status === 'ok' ? 'bg-ok' : 'bg-danger'}`} />
                            {eq.status === 'ok' ? t.station.ok : t.station.fault}
                          </span>
                        )}
                      </div>
                      {eq ? (
                        <>
                          <div className="text-ink">{itemName(eq, t)}</div>
                          <div className="flex gap-2 mt-1">
                            <button
                              className="btn h-6 text-[12.5px] px-2"
                              disabled={busy}
                              onClick={() => void act(() => gameApi.unequip(eq.id, saveId, station.id))}
                            >
                              {t.station.uninstall}
                            </button>
                            {eq.status === 'fault' && (
                              <button
                                className="btn btn-primary h-6 text-[12.5px] px-2"
                                disabled={busy}
                                onClick={() => void act(() => phase4Api.repair(eq.id, saveId))}
                              >
                                {t.station.repair}
                              </button>
                            )}
                          </div>
                        </>
                      ) : (
                        inventory.some((i) => i.category === cat) && (
                          <button
                            className="btn btn-primary h-6 text-[12.5px] px-2 mt-1"
                            disabled={busy}
                            onClick={() => {
                              const cand = inventory.find((i) => i.category === cat)!
                              void act(() => gameApi.install(cand.id, saveId, station.id))
                            }}
                          >
                            {t.station.installInv}
                          </button>
                        )
                      )}
                    </div>
                  )
                })}
              </div>
            </section>

            <section className="panel">
              <div className="panel-header">
                <span>{t.station.inventory}</span>
                <button className="text-[12px] text-signal hover:underline" onClick={() => nav('/equipment')}>
                  {t.station.goBuy}
                </button>
              </div>
              <div className="p-2 space-y-1">
                {inventory.length === 0 && <div className="text-[12px] text-ink-dim px-1 py-1">{t.station.invEmpty}</div>}
                {inventory.map((eq) => (
                  <div key={eq.id} className="row !py-1.5 rounded-md">
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] text-ink truncate">{itemName(eq, t)}</div>
                      <div className="text-[12.5px] text-ink-dim">
                        {(t.equip.cats as Record<string, string>)[eq.category ?? ''] ?? eq.category}
                      </div>
                    </div>
                    <button
                      className="btn btn-primary h-6 text-[12.5px] px-2"
                      disabled={busy}
                      onClick={() => void act(() => gameApi.install(eq.id, saveId, station.id))}
                    >
                      {t.station.install}
                    </button>
                    <button
                      className="btn btn-danger w-7 h-6 px-0"
                      disabled={busy}
                      title={fmt(t.station.sell, { price: ((eq.price ?? 0) / 2).toFixed(0) })}
                      onClick={() => void act(() => gameApi.sell(eq.id, saveId))}
                    >
                      <Icon name="trash" size={12} />
                    </button>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>
      )}
    </div>
  )
}

/** 设备名：目录内置条目按 catalog_id 映射当前语言，其余显示后端原文。 */
function itemName(eq: EquipmentItem, t: ReturnType<typeof useLang>['t']): string {
  const dict = (t.equip.items as Record<string, { name: string; desc: string }>)[eq.catalog_id]
  return dict?.name ?? eq.name
}

function nStationCost(
  stations: { id: string }[],
  id: string,
  t: ReturnType<typeof useLang>['t'],
): string {
  const idx = stations.findIndex((s) => s.id === id)
  return idx <= 0 ? t.station.free : `₡${(2000 * idx).toLocaleString()}`
}

function Spec({ k, v, cls }: { k: string; v: string; cls?: string }) {
  return (
    <div>
      <div className="text-[12.5px] text-ink-dim">{k}</div>
      <div className={`data text-[13px] ${cls ?? 'text-ink'}`}>{v}</div>
    </div>
  )
}
