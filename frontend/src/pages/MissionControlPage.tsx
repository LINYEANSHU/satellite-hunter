import Icon from '../components/Icon'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { orbitApi, type SatelliteItem } from '../api/orbit'
import {
  MISSION_TYPE_LABELS,
  gameApi,
  stationName,
  type MissionView,
  type Telemetry,
} from '../api/game'
import PageHeader from '../components/PageHeader'
import { useGameStore, useTimeStore } from '../stores/gameStore'
import { useStationStore } from '../stores/stationStore'
import { phase4Api, type ScheduleSuggestion } from '../api/game'
import MissionTimeline from '../components/MissionTimeline'
import { useLang, fmt, translateFailure, tr } from '../i18n'
import { sfx, useMissionSfx } from '../lib/sfxHooks'

const STATUS_KEYS = ['', 'planned', 'active', 'completed', 'failed'] as const

const STATUS_COLORS: Record<string, string> = {
  planned: 'text-signal border-signal/40',
  active: 'text-ok border-ok/40',
  completed: 'text-signal border-signal/40',
  failed: 'text-danger border-danger/40',
  cancelled: 'text-ink-dim ',
  scheduled: 'text-signal border-signal/40',
}

function useRefreshCredits() {
  const saveId = useGameStore((s) => s.saveId)
  return useCallback(async () => {
    if (!saveId) return
    const st = await gameApi.state(saveId)
    useGameStore.getState().setSession({
      credits: st.player.credits,
      researchPoints: st.player.research_points,
      xp: st.player.xp,
      level: st.player.level,
      totalMissionsDone: st.player.total_missions_done,
      satellitesDiscovered: st.player.satellites_discovered,
    })
  }, [saveId])
}

/** 任务控制中心（需求 5.2/5.3）：日历列表 + 创建 + 执行动态界面。 */
export default function MissionControlPage() {
  const nav = useNavigate()
  const saveId = useGameStore((s) => s.saveId)
  const credits = useGameStore((s) => s.credits)
  const stations = useStationStore((s) => s.stations)
  const activeStationId = useStationStore((s) => s.activeStationId)
  const [missions, setMissions] = useState<MissionView[]>([])
  const [tab, setTab] = useState('')
  const [creating, setCreating] = useState(false)
  const [executingId, setExecutingId] = useState<string | null>(null)
  const { t } = useLang()

  const reload = useCallback(async () => {
    if (!saveId) return
    setMissions(await gameApi.missions(saveId))
  }, [saveId])

  useEffect(() => {
    void reload()
    const iv = window.setInterval(() => void reload(), 5000) // 状态刷新（惰性结算在此发生）
    return () => window.clearInterval(iv)
  }, [reload])

  const activeMission = missions.find((m) => m.status === 'active')
  useEffect(() => {
    if (activeMission) setExecutingId(activeMission.id)
  }, [activeMission?.id])

  const filtered = tab ? missions.filter((m) => m.status === tab) : missions

  if (!saveId) {
    return (
      <div className="h-full panel flex items-center justify-center text-sm text-ink-dim">
        {t.missions.noSave}
        <button className="btn ml-3" onClick={() => nav('/')}>
          {t.missions.backMenu}
        </button>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col gap-3 min-h-0">
      <PageHeader
        title={t.missions.title}
        subtitle={t.missions.subtitle}
        right={
          <>
            <span className="chip text-warn border-warn/40">₡{Math.round(credits).toLocaleString()}</span>
            <button className="btn btn-primary" onClick={() => setCreating(true)} data-testid="new-mission-btn">
              {t.missions.create}
            </button>
          </>
        }
      />

      <StatsStrip saveId={saveId} />

      <div className="flex gap-3 flex-1 min-h-0">
        {/* 任务列表 */}
        <div className="flex-1 min-w-0 flex flex-col gap-2">
          <div className="panel px-1 pt-1 pb-0 overflow-hidden shrink-0" data-testid="timeline-panel">
            <MissionTimeline
              missions={missions}
              selectedId={executingId}
              onSelect={(id) => {
                setExecutingId(id)
                sfx.click()
              }}
            />
          </div>
          <div className="flex gap-1.5">
            {STATUS_KEYS.map((k) => (
              <button
                key={k}
                className={`chip cursor-pointer ${tab === k ? 'text-signal border-signal/50' : 'hover:text-ink'}`}
                onClick={() => setTab(k)}
              >
                {(t.missions.status as Record<string, string>)[k || 'all']}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto space-y-1.5 pr-1 min-h-0" data-testid="mission-list">
            {filtered.length === 0 && (
              <div className="panel p-4 text-xs text-ink-dim text-center">{t.missions.empty}</div>
            )}
            {filtered.map((m) => (
              <MissionRow
                key={m.id}
                m={m}
                stations={stations}
                onExecute={() => setExecutingId(m.id)}
                onCancel={async () => {
                  await gameApi.cancelMission(m.id)
                  void reload()
                }}
                onStart={async () => {
                  try {
                    await gameApi.startMission(m.id)
                    await reload()
                  } catch (e) {
                    alert(tr(e))
                  }
                }}
              />
            ))}
          </div>
        </div>

        {/* 自动调度面板（需求 8.2/8.4） */}
        {stations.length > 0 && (
          <SchedulerPanel saveId={saveId} stations={stations} defaultStation={activeStationId} onApplied={reload} />
        )}

        {/* 执行面板 */}
        {executingId && (
          <MissionExecPanel
            missionId={executingId}
            onClose={() => setExecutingId(null)}
            onChanged={reload}
          />
        )}
      </div>

      {creating && (
        <CreateMissionModal
          saveId={saveId}
          stations={stations}
          defaultStation={activeStationId}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false)
            void reload()
          }}
        />
      )}
    </div>
  )
}

function MissionRow({
  m,
  stations,
  onExecute,
  onStart,
  onCancel,
}: {
  m: MissionView
  stations: { id: string; name: string }[]
  onExecute: () => void
  onStart: () => void
  onCancel: () => void
}) {
  const aos = m.aos ? new Date(m.aos) : null
  const { t } = useLang()
  return (
    <div className="panel px-3 py-2 flex items-center gap-3" data-testid={`mission-${m.id}`}>
      <span className={`chip shrink-0 ${STATUS_COLORS[m.status] ?? ''}`}>
        {(t.missions.status as Record<string, string>)[m.status] ?? m.status}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-[13px] text-ink truncate">{m.satellite_name || `NORAD ${m.satellite_id}`}</span>
          <span className="chip">
            {(t.missions.type as Record<string, string>)[m.type] ?? m.type}
          </span>
          {m.auto && <span className="chip text-signal">{t.missions.auto}</span>}
        </div>
        <div className="text-[12px] data text-ink-dim mt-0.5">
          {aos ? aos.toLocaleString() : '—'} · {fmt(t.missions.min, { n: Math.round(m.planned_duration_s / 60) })} ·{' '}
          {fmt(t.missions.maxEl, { el: m.max_elevation_deg.toFixed(0) })}
          {m.frequency_hz ? ` · ${(m.frequency_hz / 1e6).toFixed(2)} MHz` : ''} ·{' '}
          {fmt(t.missions.at, { station: stationName(stations, m.station_id) })}
        </div>
      </div>
      <div className="text-right text-[12px] data shrink-0">
        <div className="text-warn">+₡{m.reward_credits}</div>
        <div className="text-ink-dim">+{m.reward_rp} RP</div>
      </div>
      <div className="flex gap-1.5 shrink-0">
        {m.status === 'active' && (
          <button className="btn btn-primary h-7 text-xs" onClick={onExecute}>
            {t.missions.monitor}
          </button>
        )}
        {m.status === 'planned' && (
          <>
            <button className="btn btn-primary h-7 text-xs" onClick={onStart} data-testid={`start-${m.id}`}>
              {t.missions.start}
            </button>
            <button className="btn btn-danger h-7 text-xs" onClick={onCancel}>
              {t.missions.cancel}
            </button>
          </>
        )}
        {(m.status === 'completed' || m.status === 'failed') && (
          <button className="btn h-7 text-xs" onClick={onExecute}>
            {t.missions.detail}
          </button>
        )}
      </div>
    </div>
  )
}

/** 任务执行动态界面（需求 5.3）：方位/仰角、SNR、多普勒、进度、数据缓存。 */
function MissionExecPanel({ missionId, onClose, onChanged }: { missionId: string; onClose: () => void; onChanged: () => void }) {
  const [t, setT] = useState<Telemetry | null>(null)
  const simNow = useRef(0)
  const refreshCredits = useRefreshCredits()
  const notifiedDone = useRef(false)
  const { lang, t: dict } = useLang()
  const em = dict.missions.exec
  useMissionSfx(t?.mission.status, t?.phase)

  useEffect(() => {
    let alive = true
    const poll = async () => {
      simNow.current = useTimeStore.getState().now()
      try {
        const data = await gameApi.telemetry(missionId, new Date(simNow.current).toISOString())
        if (alive) setT(data)
        if (data.phase === 'done' && !notifiedDone.current) {
          notifiedDone.current = true
          void refreshCredits()
          onChanged()
        }
      } catch {
        /* 静默重试 */
      }
    }
    void poll()
    const iv = window.setInterval(poll, 800)
    return () => {
      alive = false
      window.clearInterval(iv)
    }
  }, [missionId, onChanged, refreshCredits])

  if (!t) return null
  const m = t.mission

  return (
    <div className="w-80 shrink-0 panel overflow-y-auto" data-testid="mission-exec">
      <div className="panel-header">
        <span className="normal-case tracking-normal text-ink text-xs">
          {t.phase === 'receiving' ? em.receiving : t.phase === 'waiting' ? em.waiting : em.done}
        </span>
        <button className="text-ink-dim hover:text-ink" onClick={onClose}>
          <Icon name="close" size={13} />
        </button>
      </div>
      <div className="p-3 space-y-3 text-xs">
        <div className="flex items-center justify-between">
          <span className="text-ink text-[13px]">{m.satellite_name}</span>
          <span className={`chip ${STATUS_COLORS[m.status] ?? ''}`}>
            {(dict.missions.status as Record<string, string>)[m.status] ?? m.status}
          </span>
        </div>

        {t.phase === 'waiting' && t.seconds_to_aos !== undefined && (
          <div className="panel p-3 text-center">
            <div className="text-ink-dim">{em.toAos}</div>
            <div className="data text-2xl text-signal mt-1">
              {Math.floor(t.seconds_to_aos / 60)}:{String(Math.floor(t.seconds_to_aos % 60)).padStart(2, '0')}
            </div>
            <div className="text-[12px] text-ink-dim mt-1">{em.pushTime}</div>
          </div>
        )}

        {t.phase === 'receiving' && (
          <>
            {/* 指南针 */}
            <div className="flex justify-center">
              <Compass az={t.azimuth_deg ?? 0} el={t.elevation_deg ?? 0} />
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 data">
              <KV k={em.az} v={`${t.azimuth_deg?.toFixed(1)}°`} />
              <KV k={em.el} v={`${t.elevation_deg?.toFixed(1)}°`} />
              <KV k={em.range} v={`${t.range_km?.toFixed(0)} km`} />
              <KV k={em.doppler} v={`${(t.doppler_hz ?? 0) >= 0 ? '+' : ''}${t.doppler_hz?.toFixed(0)} Hz`} />
            </div>
            {/* 信号强度 */}
            <div>
              <div className="flex justify-between text-[12px] text-ink-dim mb-1">
                <span>
                  {(t.margin_db ?? 0) >= 0
                    ? fmt(em.snrMarginOk, { snr: t.snr_db?.toFixed(1) ?? '—', margin: t.margin_db?.toFixed(1) ?? '—' })
                    : fmt(em.snrMarginBad, { snr: t.snr_db?.toFixed(1) ?? '—', margin: t.margin_db?.toFixed(1) ?? '—' })}
                </span>
                <span className="data">{fmt(em.quality, { q: t.quality?.toFixed(0) ?? '—' })}</span>
              </div>
              <div className="h-2 rounded bg-ground-1 overflow-hidden">
                <div
                  className={`h-full ${(t.quality ?? 0) > 55 ? 'bg-ok' : (t.quality ?? 0) > 30 ? 'bg-warn' : 'bg-danger'}`}
                  style={{ width: `${t.quality ?? 0}%` }}
                  data-testid="snr-bar"
                />
              </div>
            </div>
            {/* 进度与数据 */}
            <div>
              <div className="flex justify-between text-[12px] text-ink-dim mb-1">
                <span>{em.progress}</span>
                <span className="data">{((t.progress ?? 0) * 100).toFixed(1)}%</span>
              </div>
              <div className="h-2 rounded bg-ground-1 overflow-hidden">
                <div className="h-full bg-signal" style={{ width: `${(t.progress ?? 0) * 100}%` }} />
              </div>
              <div className="flex justify-between mt-2 text-[12.5px] data">
                <span className="text-ink-dim">{em.dataCache}</span>
                <span className="text-signal">{t.data_mb?.toFixed(2)} MB</span>
              </div>
            </div>
            <div className="flex justify-between text-[12px] data text-ink-dim pt-1 ">
              <span>{t.frequency_mhz?.toFixed(2)} MHz · {t.modulation}</span>
              <span className="text-warn">SIMULATED_RF</span>
            </div>
          </>
        )}

        {t.phase === 'done' && (
          <div className="space-y-2">
            {m.status === 'completed' ? (
              <div className="panel p-3 text-ok">
                {em.success}
                <div className="text-[12.5px] data text-ink-dim mt-1.5 space-y-0.5">
                  <div>{fmt(em.data, { mb: (m.data_produced_mb as number)?.toFixed(2) })}</div>
                  <div>
                    {fmt(em.linkMargin, {
                      margin: (m.result as any)?.avg_margin_db,
                      cov: (((m.result as any)?.coverage ?? 0) * 100).toFixed(0),
                    })}
                  </div>
                  <div className="text-warn">
                    {fmt(em.reward, { credits: m.reward_credits, rp: m.reward_rp })}
                  </div>
                </div>
              </div>
            ) : (
              <div className="panel p-3 text-danger">
                {em.fail}
                <div className="text-[12.5px] text-ink-dim mt-1">
                  {translateFailure(lang, m.failure_reason)}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function Compass({ az, el }: { az: number; el: number }) {
  const size = 130
  const c = size / 2
  const r = c - 14
  const rad = ((az - 90) * Math.PI) / 180
  const scale = 0.25 + 0.75 * Math.max(0, Math.min(90, el)) / 90 // 仰角越高越靠中心
  const x = c + Math.cos(rad) * r * (1 - scale * 0.75)
  const y = c + Math.sin(rad) * r * (1 - scale * 0.75)
  return (
    <svg width={size} height={size} data-testid="compass">
      <circle cx={c} cy={c} r={r} fill="none" stroke="#243247" strokeWidth="1" />
      <circle cx={c} cy={c} r={r * 0.55} fill="none" stroke="#1a2536" strokeWidth="1" />
      {[['N', 0], ['E', 90], ['S', 180], ['W', 270]].map(([l, deg]) => {
        const a = ((Number(deg) - 90) * Math.PI) / 180
        return (
          <text
            key={l as string}
            x={c + Math.cos(a) * (r + 8)}
            y={c + Math.sin(a) * (r + 8) + 4}
            textAnchor="middle"
            fontSize="10"
            fill="#5b6b82"
          >
            {l}
          </text>
        )
      })}
      <line x1={c} y1={c} x2={x} y2={y} stroke="#22d3ee" strokeWidth="1.5" />
      <circle cx={x} cy={y} r="4" fill="#22d3ee" />
      <text x={c} y={size - 2} textAnchor="middle" fontSize="9" fill="#5b6b82" fontFamily="monospace">
        AZ {az.toFixed(0)}° EL {el.toFixed(0)}°
      </text>
    </svg>
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

/** 创建任务弹窗：选择卫星（搜索）+ 站点 + 类型。 */
function CreateMissionModal({
  saveId,
  stations,
  defaultStation,
  onClose,
  onCreated,
}: {
  saveId: string
  stations: { id: string; name: string }[]
  defaultStation: string | null
  onClose: () => void
  onCreated: () => void
}) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<SatelliteItem[]>([])
  const [sat, setSat] = useState<SatelliteItem | null>(null)
  const [stationId, setStationId] = useState(defaultStation ?? stations[0]?.id ?? '')
  const [type, setType] = useState('capture')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const { t } = useLang()

  useEffect(() => {
    if (q.length < 1) {
      setResults([])
      return
    }
    const timer = window.setTimeout(async () => {
      try {
        const r = await orbitApi.list('stations', q, 30, 0)
        setResults(r.items)
      } catch {
        setResults([])
      }
    }, 300)
    return () => window.clearTimeout(timer)
  }, [q])

  const submit = async () => {
    if (!sat || !stationId) return
    setBusy(true)
    setErr(null)
    try {
      await gameApi.createMission({ save_id: saveId, station_id: stationId, satellite_id: sat.norad_id, type })
      onCreated()
    } catch (e) {
      setErr(tr(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" data-testid="create-mission-modal">
      <div className="panel w-[520px] max-w-[92vw] p-4 space-y-3">
        <h3 className="text-sm font-semibold text-ink">{t.missions.modal.title}</h3>

        <div>
          <label className="text-xs text-ink-dim">{t.missions.modal.target}</label>
          {sat ? (
            <div className="flex items-center justify-between mt-1 panel px-2 py-1.5">
              <span className="text-sm text-ink">
                {sat.name} <span className="text-ink-dim text-xs data">#{sat.norad_id}</span>
              </span>
              <button className="text-ink-dim hover:text-ink" onClick={() => setSat(null)}>
                {t.missions.modal.change}
              </button>
            </div>
          ) : (
            <>
              <input className="input mt-1" placeholder={t.missions.modal.searchPh} value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
              <div className="mt-1 max-h-44 overflow-y-auto space-y-0.5">
                {results.map((s) => (
                  <button
                    key={s.norad_id}
                    className="w-full text-left px-2 py-1.5 rounded hover:bg-ground-2 text-[13px] text-ink flex justify-between"
                    onClick={() => {
                      setSat(s)
                      setResults([])
                    }}
                  >
                    <span>{s.name}</span>
                    <span className="data text-[12px] text-ink-dim">{s.norad_id}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs text-ink-dim">
            {t.missions.modal.groundStation}
            <select className="input mt-1" value={stationId} onChange={(e) => setStationId(e.target.value)}>
              {stations.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-ink-dim">
            {t.missions.modal.missionType}
            <select className="input mt-1" value={type} onChange={(e) => setType(e.target.value)}>
              {Object.keys(MISSION_TYPE_LABELS)
                .filter((k) => k !== 'decode')
                .map((k) => (
                  <option key={k} value={k}>
                    {(t.missions.type as Record<string, string>)[k] ?? k}
                  </option>
                ))}
            </select>
          </label>
        </div>

        {err && <div className="text-xs text-danger">{err}</div>}

        <p className="text-[12px] text-ink-dim leading-relaxed">{t.missions.modal.note}</p>

        <div className="flex justify-end gap-2">
          <button className="btn" onClick={onClose}>
            {t.common.cancel}
          </button>
          <button className="btn btn-primary" disabled={!sat || busy} onClick={() => void submit()} data-testid="mission-submit">
            {busy ? t.missions.modal.planning : t.missions.modal.submit}
          </button>
        </div>
      </div>
    </div>
  )
}

/** 自动调度面板：确定性规则（需求 8.2）+ 玩家优先级（需求 8.4）。 */
function SchedulerPanel({
  saveId,
  stations,
  defaultStation,
  onApplied,
}: {
  saveId: string
  stations: { id: string; name: string }[]
  defaultStation: string | null
  onApplied: () => void
}) {
  const [stationId, setStationId] = useState(defaultStation ?? stations[0]?.id ?? '')
  const [hours, setHours] = useState(24)
  const [minEl, setMinEl] = useState(20)
  const [preferUncollected, setPreferUncollected] = useState(true)
  const [suggestions, setSuggestions] = useState<ScheduleSuggestion[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const { t } = useLang()

  const preview = async () => {
    setBusy(true)
    setMsg(null)
    try {
      const r = await phase4Api.schedulePlan({
        save_id: saveId,
        station_id: stationId,
        hours,
        rules: { min_max_elevation: minEl, prefer_uncollected: preferUncollected ? 1.5 : 0, max_missions: 8 },
      })
      setSuggestions(r.suggestions)
    } catch (e) {
      setMsg(tr(e))
    } finally {
      setBusy(false)
    }
  }

  const apply = async () => {
    setBusy(true)
    try {
      const r = await phase4Api.schedulePlan({
        save_id: saveId,
        station_id: stationId,
        hours,
        rules: { min_max_elevation: minEl, prefer_uncollected: preferUncollected ? 1.5 : 0, max_missions: 8 },
        apply: true,
      })
      setMsg(fmt(t.missions.sched.created, { n: r.created }))
      setSuggestions(null)
      onApplied()
    } catch (e) {
      setMsg(tr(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="w-72 shrink-0 panel overflow-y-auto" data-testid="scheduler-panel">
      <div className="panel-header">{t.missions.sched.title}</div>
      <div className="p-3 space-y-2.5 text-xs">
        <select className="input !h-7 text-[12.5px]" value={stationId} onChange={(e) => setStationId(e.target.value)}>
          {stations.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <label className="block text-ink-dim">
          {fmt(t.missions.sched.window, { h: hours })}
          <input type="range" min={6} max={72} step={6} value={hours} onChange={(e) => setHours(Number(e.target.value))} className="w-full accent-cyan-400" />
        </label>
        <label className="block text-ink-dim">
          {fmt(t.missions.sched.minEl, { el: minEl })}
          <input type="range" min={5} max={60} step={5} value={minEl} onChange={(e) => setMinEl(Number(e.target.value))} className="w-full accent-cyan-400" />
        </label>
        <label className="flex items-center gap-2 text-ink-dim">
          <input type="checkbox" checked={preferUncollected} onChange={(e) => setPreferUncollected(e.target.checked)} className="accent-cyan-400" />
          {t.missions.sched.preferFav}
        </label>
        <div className="flex gap-2">
          <button className="btn h-7 text-[12.5px] flex-1" disabled={busy} onClick={() => void preview()} data-testid="scheduler-preview">
            {t.missions.sched.preview}
          </button>
          <button
            className="btn btn-primary h-7 text-[12.5px] flex-1"
            disabled={busy || !suggestions?.length}
            onClick={() => void apply()}
            data-testid="scheduler-apply"
          >
            {t.missions.sched.apply}
          </button>
        </div>
        {msg && <div className="text-[12.5px] text-signal">{msg}</div>}
        {suggestions && (
          <div className="space-y-1">
            {suggestions.length === 0 && <div className="text-[12.5px] text-ink-dim">{t.missions.sched.noSuggestion}</div>}
            {suggestions.map((s) => (
              <div key={s.satellite_id + s.aos} className="panel px-2 py-1.5 flex items-center justify-between">
                <div className="min-w-0">
                  <div className="text-[12.5px] text-ink truncate">
                    {s.new_satellite && <span className="text-signal mr-1">NEW</span>}
                    {s.satellite_name}
                  </div>
                  <div className="text-[12px] data text-ink-dim">
                    {new Date(s.aos).toLocaleString()} · {s.max_elevation_deg}°
                  </div>
                </div>
                <span className="chip text-warn shrink-0">+₡{s.reward_credits}</span>
              </div>
            ))}
          </div>
        )}
        <p className="text-[12px] text-ink-faint leading-relaxed pt-2 bg-ground-1 rounded px-2 py-1.5">
          {t.missions.sched.note}
        </p>
      </div>
    </div>
  )
}

/** 运营统计条：全部来自真实任务记录（/api/game/stats）。 */
function StatsStrip({ saveId }: { saveId: string }) {
  const [stats, setStats] = useState<Record<string, unknown> | null>(null)
  const { t } = useLang()
  useEffect(() => {
    if (!saveId) return
    let alive = true
    const load = () =>
      fetch(`/api/game/stats?save_id=${saveId}`)
        .then((r) => r.json())
        .then((d) => alive && setStats(d))
        .catch(() => {})
    void load()
    const iv = window.setInterval(load, 6000)
    return () => {
      alive = false
      window.clearInterval(iv)
    }
  }, [saveId])

  if (!stats) return null
  const rate = stats.success_rate as number | null
  const daily = (stats.daily as { date: string; completed: number }[]) ?? []
  const maxDaily = Math.max(1, ...daily.map((d) => d.completed))
  const st = t.missions.stats

  return (
    <div className="panel px-4 py-2.5 flex items-center gap-6 shrink-0 rise" data-testid="stats-strip">
      <Metric k={st.successRate} v={rate === null || rate === undefined ? '—' : `${Math.round(rate * 100)}%`} />
      <Metric k={st.completed} v={String(stats.missions_completed)} />
      <Metric k={st.last24h} v={String(stats.completed_last_24h)} />
      <Metric k={st.streak} v={String(stats.success_streak)} />
      <Metric k={st.data} v={`${(stats.data_total_mb as number).toFixed(1)} MB`} />
      <Metric k={st.discovered} v={String(stats.discovered)} />
      <Metric k={st.stations} v={String(stats.stations)} />
      {/* 近 7 天迷你柱状图 */}
      <div className="flex items-end gap-1 ml-auto h-8" title={st.dailyTitle}>
        {daily.map((d) => (
          <div
            key={d.date}
            className="w-2 rounded-sm bg-signal/40"
            style={{ height: `${Math.max(8, (d.completed / maxDaily) * 100)}%` }}
            title={fmt(st.dailyTip, { date: d.date, n: d.completed })}
          />
        ))}
      </div>
    </div>
  )
}

function Metric({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <div className="text-[12.5px] text-ink-dim">{k}</div>
      <div className="data text-[15px] text-ink">{v}</div>
    </div>
  )
}
