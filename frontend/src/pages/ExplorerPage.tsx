import Icon from '../components/Icon'
import { useCallback, useEffect, useState } from 'react'
import GlobeScene from '../three/GlobeScene'
import SatelliteList from '../components/SatelliteList'
import SatelliteDetail from '../components/SatelliteDetail'
import { useStationStore } from '../stores/stationStore'
import { useLang, fmt } from '../i18n'

/** 3D 地球卫星探索主页（需求 11.3 布局：左列表 / 中地球 / 右详情 / 底时间控制）。 */
export default function ExplorerPage() {
  const [place, setPlace] = useState<{ lat: number; lon: number } | null>(null)
  const [name, setName] = useState('')
  const [minEl, setMinEl] = useState(5)
  const placementMode = useStationStore((s) => s.placementMode)
  const setPlacementMode = useStationStore((s) => s.setPlacementMode)
  const bootstrap = useStationStore((s) => s.bootstrap)
  const { t } = useLang()

  useEffect(() => {
    void bootstrap()
  }, [bootstrap])

  useEffect(() => {
    const h = (e: Event) => {
      const d = (e as CustomEvent).detail as { lat: number; lon: number }
      setPlace(d)
      setName('')
    }
    window.addEventListener('sh:place-station', h)
    return () => window.removeEventListener('sh:place-station', h)
  }, [])

  const submitStation = useCallback(async () => {
    if (!place) return
    await useStationStore.getState().addStation({
      name:
        name.trim() ||
        fmt(t.explorer.defaultName, { lat: place.lat.toFixed(1), lon: place.lon.toFixed(1) }),
      lat: place.lat,
      lon: place.lon,
      alt_m: 0,
      min_elevation_deg: minEl,
    })
    setPlace(null)
    setPlacementMode(false)
  }, [place, name, minEl, setPlacementMode, t])

  return (
    <div className="h-full flex flex-col gap-2 min-h-0">
      <div className="flex-1 flex gap-2 min-h-0 rise">
        {/* 左：目录与筛选 */}
        <div className="w-60 shrink-0 min-h-0">
          <SatelliteList />
        </div>

        {/* 中：3D 地球 */}
        <div className="flex-1 relative panel overflow-hidden min-w-0">
          <GlobeScene />

          {/* 顶部悬浮状态条 */}
          <div className="absolute top-2 left-2 right-2 flex items-center gap-2 pointer-events-none">
            <span className="tag bg-ground-1/90">{t.explorer.hint}</span>
            {placementMode && (
              <span className="chip bg-warn/10 border-warn/50 text-warn animate-pulseSoft">
                {t.explorer.placing}
              </span>
            )}
          </div>

          {/* 右下角工具 */}
          <div className="absolute bottom-2 right-2 flex flex-col gap-1.5">
            <button
              className={`btn h-8 ${placementMode ? 'btn-primary' : ''}`}
              onClick={() => setPlacementMode(!placementMode)}
              data-testid="place-station-btn"
              title={t.explorer.placeTitle}
            >
              {placementMode ? t.explorer.cancelPlace : t.explorer.place}
            </button>
            <StationQuickList />
          </div>
        </div>

        {/* 右：详情 */}
        <div className="w-72 shrink-0 min-h-0">
          <SatelliteDetail />
        </div>
      </div>

      {/* 建站弹窗 */}
      {place && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" data-testid="place-station-modal">
          <div className="panel w-80 p-4 space-y-3">
            <h3 className="text-sm font-semibold text-ink">{t.explorer.placeModal}</h3>
            <div className="data text-xs text-signal">
              {fmt(t.explorer.latLon, { lat: place.lat.toFixed(3), lon: place.lon.toFixed(3) })}
            </div>
            <label className="block text-xs text-ink-dim">
              {t.explorer.name}
              <input
                className="input mt-1"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t.explorer.namePh}
                autoFocus
                data-testid="station-name-input"
              />
            </label>
            <label className="block text-xs text-ink-dim">
              {fmt(t.explorer.minEl, { el: minEl })}
              <input
                type="range"
                min={0}
                max={30}
                value={minEl}
                onChange={(e) => setMinEl(Number(e.target.value))}
                className="w-full mt-1 accent-cyan-400"
              />
            </label>
            <p className="text-[12px] text-ink-dim leading-relaxed">{t.explorer.note}</p>
            <div className="flex gap-2 justify-end">
              <button className="btn" onClick={() => setPlace(null)}>
                {t.common.cancel}
              </button>
              <button className="btn btn-primary" onClick={() => void submitStation()} data-testid="station-submit">
                {t.explorer.create}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function StationQuickList() {
  const stations = useStationStore((s) => s.stations)
  const activeId = useStationStore((s) => s.activeStationId)
  const setActive = useStationStore((s) => s.setActive)
  const remove = useStationStore((s) => s.removeStation)
  const { t } = useLang()

  if (!stations.length) return null
  return (
    <div className="panel  w-44">
      {stations.map((st) => (
        <div
          key={st.id}
          className={`px-2 py-1 flex items-center justify-between text-[13px] cursor-pointer hover:bg-ground-2 ${
            st.id === activeId ? 'text-ok' : 'text-ink'
          }`}
          onClick={() => setActive(st.id)}
          data-testid={`station-row-${st.name}`}
        >
          <span className="truncate">{st.name}</span>
          <button
            className="text-ink-dim hover:text-danger px-1"
            onClick={(e) => {
              e.stopPropagation()
              void remove(st.id)
            }}
            title={t.explorer.delStation}
          >
            <Icon name="close" size={13} />
          </button>
        </div>
      ))}
    </div>
  )
}
