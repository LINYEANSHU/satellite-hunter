import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CATEGORY_LABELS, gameApi, phase4Api, type EquipmentItem } from '../api/game'
import PageHeader from '../components/PageHeader'
import { useGameStore } from '../stores/gameStore'
import { useStationStore } from '../stores/stationStore'

/** 地面站管理：设备槽位（每类一件）+ 安装/拆卸 + 站点概览（需求 4.2/4.3）。 */
export default function StationPage() {
  const nav = useNavigate()
  const saveId = useGameStore((s) => s.saveId)
  const stations = useStationStore((s) => s.stations)
  const activeId = useStationStore((s) => s.activeStationId)
  const setActive = useStationStore((s) => s.setActive)
  const bootstrap = useStationStore((s) => s.bootstrap)
  const [items, setItems] = useState<EquipmentItem[]>([])
  const [busy, setBusy] = useState(false)

  const reload = useCallback(async () => {
    if (!saveId) return
    await bootstrap()
    setItems(await gameApi.equipment(saveId))
  }, [saveId, bootstrap])

  useEffect(() => {
    void reload()
  }, [reload])

  const station = stations.find((s) => s.id === activeId) ?? stations[0]

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
      alert(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  if (!saveId) {
    return (
      <div className="h-full panel flex items-center justify-center">
        <div className="text-center text-sm text-hud-dim">
          未进入存档
          <button className="btn ml-3" onClick={() => nav('/')}>
            返回主菜单
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full overflow-auto">
      <PageHeader
        title="地面站管理"
        subtitle="设备槽位 · 安装拆卸 · 站点概览"
        right={
          stations.length > 1 && (
            <select className="input !w-40" value={activeId ?? ''} onChange={(e) => setActive(e.target.value)}>
              {stations.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          )
        }
      />

      {!station ? (
        <div className="panel p-6 text-sm text-hud-dim">
          还没有地面站。前往
          <button className="btn btn-primary mx-2 h-7 text-xs" onClick={() => nav('/explorer')}>
            轨道探索
          </button>
          页点击「选址建站」。
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-3">
          {/* 站点概览 */}
          <section className="panel col-span-1">
            <div className="panel-header">站点概览</div>
            <div className="p-3 space-y-1.5 text-xs">
              <Row k="名称" v={station.name} />
              <Row k="坐标" v={`${station.lat.toFixed(3)}°, ${station.lon.toFixed(3)}°`} />
              <Row k="海拔" v={`${station.alt_m} m`} />
              <Row k="最小仰角" v={`${station.min_elevation_deg}°`} />
              <Row k="状态" v={station.status} cls="text-hud-green" />
              <Row k="类型" v={station.is_virtual ? '虚拟站（模拟模式）' : '真实站'} />
            </div>
            <div className="px-3 pb-3 text-[10px] text-hud-dim leading-relaxed border-t border-space-600/40 pt-2">
              3D 站内场景将在后续阶段加入；当前以设备槽位视图管理。
            </div>
          </section>

          {/* 设备槽位 */}
          <section className="panel col-span-2">
            <div className="panel-header">
              <span>设备槽位</span>
              <span className="font-mono normal-case">Credits ₡{Math.round(useGameStore.getState().credits).toLocaleString()}</span>
            </div>
            <div className="grid grid-cols-2 gap-2 p-3">
              {Object.entries(CATEGORY_LABELS).map(([cat, label]) => {
                const eq = slots[cat]
                return (
                  <div
                    key={cat}
                    className={`rounded border p-2.5 text-xs ${
                      eq ? 'border-space-500/70 bg-space-800/60' : 'border-dashed border-space-600/60 bg-space-900/40'
                    }`}
                    data-testid={`slot-${cat}`}
                  >
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-hud-dim text-[10px] uppercase tracking-wider">{label}</span>
                      {eq && (
                        <span className={`chip ${eq.status === 'ok' ? 'text-hud-green' : 'text-hud-amber'}`}>
                          {eq.status === 'ok' ? '正常' : eq.status}
                        </span>
                      )}
                    </div>
                    {eq ? (
                      <>
                        <div className="text-slate-200 text-[13px]">{eq.name}</div>
                        {eq.status === 'fault' && (
                          <div className="text-hud-red text-[10px] mt-0.5">⚠ 故障（磨损 {Math.round(100 - eq.condition)}%）— 需维修</div>
                        )}
                        <div className="flex gap-2 mt-1.5">
                          <button
                            className="btn h-6 text-[11px] px-2"
                            disabled={busy}
                            onClick={() => void act(() => gameApi.unequip(eq.id, saveId, station.id))}
                          >
                            拆卸
                          </button>
                          {eq.status === 'fault' && (
                            <button
                              className="btn btn-primary h-6 text-[11px] px-2"
                              disabled={busy}
                              onClick={() => void act(() => phase4Api.repair(eq.id, saveId))}
                              data-testid={`repair-${eq.id}`}
                            >
                              维修
                            </button>
                          )}
                        </div>
                      </>
                    ) : (
                      <div className="text-hud-dim text-[11px] py-1.5">
                        空槽
                        {inventory.some((i) => i.category === cat) && (
                          <button
                            className="btn btn-primary h-6 text-[11px] px-2 ml-2"
                            disabled={busy}
                            onClick={() => {
                              const cand = inventory.find((i) => i.category === cat)!
                              void act(() => gameApi.install(cand.id, saveId, station.id))
                            }}
                          >
                            安装库存
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </section>

          {/* 库存 */}
          <section className="panel col-span-3">
            <div className="panel-header">
              <span>设备库存</span>
              <button className="btn h-6 text-[11px]" onClick={() => nav('/equipment')}>
                前往采购 →
              </button>
            </div>
            <div className="p-3 grid grid-cols-4 gap-2">
              {inventory.length === 0 && <div className="text-xs text-hud-dim col-span-4">库存为空</div>}
              {inventory.map((eq) => (
                <div key={eq.id} className="rounded border border-space-500/70 bg-space-800/60 p-2.5 text-xs">
                  <div className="text-[10px] text-hud-dim mb-1">{CATEGORY_LABELS[eq.category ?? ''] ?? eq.category}</div>
                  <div className="text-slate-200 text-[13px] mb-1.5">{eq.name}</div>
                  <div className="flex gap-1.5">
                    <button
                      className="btn btn-primary h-6 text-[11px] px-2"
                      disabled={busy}
                      onClick={() => void act(() => gameApi.install(eq.id, saveId, station.id))}
                    >
                      安装到此站
                    </button>
                    <button
                      className="btn btn-danger h-6 text-[11px] px-2"
                      disabled={busy}
                      onClick={() => void act(() => gameApi.sell(eq.id, saveId))}
                      title={`出售（半价 ₡${((eq.price ?? 0) / 2).toFixed(0)}）`}
                    >
                      出售
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  )
}

function Row({ k, v, cls }: { k: string; v: string; cls?: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-hud-dim shrink-0">{k}</span>
      <span className={cls ?? 'text-slate-300'}>{v}</span>
    </div>
  )
}
