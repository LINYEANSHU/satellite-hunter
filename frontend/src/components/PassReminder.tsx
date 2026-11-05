import { useEffect, useMemo, useRef, useState } from 'react'
import { stationApi, type PassInfo } from '../api/orbit'
import { useStationStore } from '../stores/stationStore'
import { useTimeStore } from '../stores/gameStore'
import { useCatalogStore } from '../stores/catalogStore'
import { sfx } from '../lib/sfx'
import { useLang, fmt } from '../i18n'

/**
 * 过境预报提醒（精进阶段 F2）：以当前激活地面站为参考，
 * 监听空间站分组未来 24h 的过境，在 AOS 前 10 分钟弹出倒计时提醒，
 * 过境进行中显示"接收窗口开启 · 距 LOS"。
 *
 * - 所有时刻均使用仿真时间（useTimeStore），加速快进时倒计时同步加速；
 * - 每条过境（卫星 + AOS）仅提醒一次，sessionStorage 记忆防页面刷新重复弹；
 * - 轮询 60s + 组件挂载时刷新；过境预测走后端缓存（/stations/{id}/passes）。
 */

interface PassToast {
  key: string
  satName: string
  noradId: number
  aosMs: number
  losMs: number
  maxEl: number
  stage: 'upcoming' | 'ongoing'
}

const LEAD_MS = 10 * 60_000 // AOS 前 10 分钟提醒
const GROUP = 'stations'
const HOURS = 24
const MAX_TOASTS = 3
const FIRED_STORE_KEY = 'sh-pass-alerts'

function loadFired(): Set<string> {
  try {
    const raw = sessionStorage.getItem(FIRED_STORE_KEY)
    return new Set(raw ? (JSON.parse(raw) as string[]) : [])
  } catch {
    return new Set()
  }
}

function saveFired(fired: Set<string>) {
  try {
    sessionStorage.setItem(FIRED_STORE_KEY, JSON.stringify([...fired].slice(-100)))
  } catch {
    /* 无 sessionStorage 时仅内存记忆 */
  }
}

function fmtCountdown(msLeft: number): string {
  const s = Math.max(0, Math.floor(msLeft / 1000))
  const m = Math.floor(s / 60)
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

export default function PassReminder() {
  const { t } = useLang()
  const activeStationId = useStationStore((s) => s.activeStationId)
  const stations = useStationStore((s) => s.stations)
  const satNames = useMemo(() => {
    const m = new Map<number, string>()
    for (const it of useCatalogStore.getState().satellites) m.set(it.norad_id, it.name)
    return m
  }, [])
  const [passes, setPasses] = useState<PassInfo[]>([])
  const [toasts, setToasts] = useState<PassToast[]>([])
  const [now, setNow] = useState(() => useTimeStore.getState().now())
  const firedRef = useRef<Set<string>>(loadFired())

  // 拉取过境预报：挂载/换站 + 每 60s
  useEffect(() => {
    if (!activeStationId) return
    let alive = true
    const load = () =>
      stationApi
        .passes(activeStationId, GROUP, HOURS)
        .then((r) => alive && setPasses(r.passes ?? []))
        .catch(() => {})
    void load()
    const iv = window.setInterval(load, 60_000)
    return () => {
      alive = false
      window.clearInterval(iv)
    }
  }, [activeStationId])

  // 1s 倒计时 tick（仿真时间）
  useEffect(() => {
    const iv = window.setInterval(() => setNow(useTimeStore.getState().now()), 1000)
    return () => window.clearInterval(iv)
  }, [])

  // 提醒判定：依赖 passes 与 now
  useEffect(() => {
    if (!passes.length) return
    const fired = firedRef.current
    const add: PassToast[] = []
    for (const p of passes) {
      const aosMs = Date.parse(p.aos)
      const losMs = Date.parse(p.los)
      if (!Number.isFinite(aosMs) || !Number.isFinite(losMs)) continue
      const key = `${p.satellite_id}:${p.aos}`
      if (fired.has(key)) continue
      const stage: PassToast['stage'] | null =
        now < aosMs && aosMs - now <= LEAD_MS
          ? 'upcoming'
          : now >= aosMs && now < losMs
            ? 'ongoing'
            : null
      if (!stage) continue
      fired.add(key)
      saveFired(fired)
      add.push({
        key,
        satName: satNames.get(p.satellite_id) ?? `NORAD ${p.satellite_id}`,
        noradId: p.satellite_id,
        aosMs,
        losMs,
        maxEl: p.max_elevation_deg,
        stage,
      })
    }
    if (add.length) {
      sfx.click()
      setToasts((t) => [...t, ...add].slice(-MAX_TOASTS))
    }
  }, [passes, now, satNames])

  // 清理：LOS 结束 30s 后移除 toast
  useEffect(() => {
    if (!toasts.length) return
    const alive = toasts.filter((t) => t.losMs + 30_000 > now)
    if (alive.length !== toasts.length) setToasts(alive)
  }, [now, toasts])

  const stationName = stations.find((s) => s.id === activeStationId)?.name
  if (!activeStationId || !toasts.length) return null

  return (
    <div className="fixed bottom-3 right-3 z-50 space-y-2 w-72 pointer-events-none" data-testid="pass-reminder">
      {toasts.map((toast) => {
        const ongoing = toast.stage === 'ongoing' || now >= toast.aosMs
        return (
          <div
            key={toast.key}
            className={`panel px-3 py-2 text-xs bg-ground-1 ${ongoing ? 'border-ok/50' : 'border-signal/40'}`}
            data-testid="pass-toast"
          >
            <div className="flex items-center gap-1.5 mb-1">
              <span className={`chip ${ongoing ? 'text-ok border-ok/40' : 'text-signal border-signal/40'}`}>
                {ongoing ? t.passCard.ongoing : t.passCard.upcoming}
              </span>
              <span className="text-ink-dim">{stationName}</span>
            </div>
            <div className="text-ink leading-relaxed">
              {toast.satName}
              <span className="text-ink-dim">{fmt(t.passCard.maxEl, { el: toast.maxEl.toFixed(0) })}</span>
            </div>
            <div className={`data text-lg mt-0.5 ${ongoing ? 'text-ok' : 'text-signal'}`}>
              {ongoing
                ? fmt(t.passCard.los, { time: fmtCountdown(toast.losMs - now) })
                : fmt(t.passCard.tminus, { time: fmtCountdown(toast.aosMs - now) })}
            </div>
            <div className="text-[11px] text-ink-dim mt-0.5">{t.passCard.simNote}</div>
          </div>
        )
      })}
    </div>
  )
}
