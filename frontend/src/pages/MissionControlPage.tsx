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

const STATUS_TABS = [
  { key: '', label: '全部' },
  { key: 'planned', label: '已计划' },
  { key: 'active', label: '执行中' },
  { key: 'completed', label: '已完成' },
  { key: 'failed', label: '失败' },
]

const STATUS_COLORS: Record<string, string> = {
  planned: 'text-hud-blue border-hud-blue/40',
  active: 'text-hud-green border-hud-green/40',
  completed: 'text-hud-cyan border-hud-cyan/40',
  failed: 'text-hud-red border-hud-red/40',
  cancelled: 'text-hud-dim border-space-500/60',
  scheduled: 'text-hud-violet border-hud-violet/40',
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
      <div className="h-full panel flex items-center justify-center text-sm text-hud-dim">
        未进入存档
        <button className="btn ml-3" onClick={() => nav('/')}>
          返回主菜单
        </button>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col gap-3 min-h-0">
      <PageHeader
        title="任务控制中心"
        subtitle="任务日历 · 创建 · 执行监视"
        right={
          <>
            <span className="chip text-hud-amber border-hud-amber/40">₡{Math.round(credits).toLocaleString()}</span>
            <button className="btn btn-primary" onClick={() => setCreating(true)} data-testid="new-mission-btn">
              + 创建任务
            </button>
          </>
        }
      />

      <div className="flex gap-3 flex-1 min-h-0">
        {/* 任务列表 */}
        <div className="flex-1 min-w-0 flex flex-col gap-2">
          <div className="flex gap-1.5">
            {STATUS_TABS.map((t) => (
              <button
                key={t.key}
                className={`chip cursor-pointer ${tab === t.key ? 'text-hud-cyan border-hud-cyan/50' : 'hover:text-slate-300'}`}
                onClick={() => setTab(t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto space-y-1.5 pr-1 min-h-0" data-testid="mission-list">
            {filtered.length === 0 && (
              <div className="panel p-4 text-xs text-hud-dim text-center">
                暂无任务。点击「+ 创建任务」规划一次卫星接收。
              </div>
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
                    alert(e instanceof Error ? e.message : String(e))
                  }
                }}
              />
            ))}
          </div>
        </div>

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
  return (
    <div className="panel px-3 py-2 flex items-center gap-3" data-testid={`mission-${m.id}`}>
      <span className={`chip shrink-0 ${STATUS_COLORS[m.status] ?? ''}`}>{m.status}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-[13px] text-slate-200 truncate">{m.satellite_name || `NORAD ${m.satellite_id}`}</span>
          <span className="chip">{MISSION_TYPE_LABELS[m.type] ?? m.type}</span>
          {m.auto && <span className="chip text-hud-violet">自动</span>}
        </div>
        <div className="text-[10px] font-mono text-hud-dim mt-0.5">
          {aos ? aos.toLocaleString() : '—'} · {Math.round(m.planned_duration_s / 60)}min · 最高 {m.max_elevation_deg.toFixed(0)}°
          {m.frequency_hz ? ` · ${(m.frequency_hz / 1e6).toFixed(2)} MHz` : ''} · 站 {stationName(stations, m.station_id)}
        </div>
      </div>
      <div className="text-right text-[10px] font-mono shrink-0">
        <div className="text-hud-amber">+₡{m.reward_credits}</div>
        <div className="text-hud-dim">+{m.reward_rp} RP</div>
      </div>
      <div className="flex gap-1.5 shrink-0">
        {m.status === 'active' && (
          <button className="btn btn-primary h-7 text-xs" onClick={onExecute}>
            监视
          </button>
        )}
        {m.status === 'planned' && (
          <>
            <button className="btn btn-primary h-7 text-xs" onClick={onStart} data-testid={`start-${m.id}`}>
              启动
            </button>
            <button className="btn btn-danger h-7 text-xs" onClick={onCancel}>
              取消
            </button>
          </>
        )}
        {(m.status === 'completed' || m.status === 'failed') && (
          <button className="btn h-7 text-xs" onClick={onExecute}>
            详情
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
        <span className="normal-case tracking-normal text-slate-200 text-xs">
          {t.phase === 'receiving' ? '● 接收中' : t.phase === 'waiting' ? '○ 等待过境' : '任务结束'}
        </span>
        <button className="text-hud-dim hover:text-slate-200" onClick={onClose}>
          ✕
        </button>
      </div>
      <div className="p-3 space-y-3 text-xs">
        <div className="flex items-center justify-between">
          <span className="text-slate-200 text-[13px]">{m.satellite_name}</span>
          <span className={`chip ${STATUS_COLORS[m.status] ?? ''}`}>{m.status}</span>
        </div>

        {t.phase === 'waiting' && t.seconds_to_aos !== undefined && (
          <div className="panel p-3 text-center">
            <div className="text-hud-dim">距 AOS</div>
            <div className="font-mono text-2xl text-hud-cyan mt-1">
              {Math.floor(t.seconds_to_aos / 60)}:{String(Math.floor(t.seconds_to_aos % 60)).padStart(2, '0')}
            </div>
            <div className="text-[10px] text-hud-dim mt-1">使用底部时间控制推进到过境窗口</div>
          </div>
        )}

        {t.phase === 'receiving' && (
          <>
            {/* 指南针 */}
            <div className="flex justify-center">
              <Compass az={t.azimuth_deg ?? 0} el={t.elevation_deg ?? 0} />
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 font-mono">
              <KV k="方位角" v={`${t.azimuth_deg?.toFixed(1)}°`} />
              <KV k="仰角" v={`${t.elevation_deg?.toFixed(1)}°`} />
              <KV k="距离" v={`${t.range_km?.toFixed(0)} km`} />
              <KV k="多普勒" v={`${(t.doppler_hz ?? 0) >= 0 ? '+' : ''}${t.doppler_hz?.toFixed(0)} Hz`} />
            </div>
            {/* 信号强度 */}
            <div>
              <div className="flex justify-between text-[10px] text-hud-dim mb-1">
                <span>SNR {t.snr_db?.toFixed(1)} dB（需 {t.mission.frequency_hz ? '' : ''}{(t.margin_db ?? 0) >= 0 ? '余量 +' : '余量 '}{t.margin_db?.toFixed(1)} dB）</span>
                <span className="font-mono">质量 {t.quality?.toFixed(0)}%</span>
              </div>
              <div className="h-2 rounded bg-space-900 overflow-hidden">
                <div
                  className={`h-full ${(t.quality ?? 0) > 55 ? 'bg-hud-green' : (t.quality ?? 0) > 30 ? 'bg-hud-amber' : 'bg-hud-red'}`}
                  style={{ width: `${t.quality ?? 0}%` }}
                  data-testid="snr-bar"
                />
              </div>
            </div>
            {/* 进度与数据 */}
            <div>
              <div className="flex justify-between text-[10px] text-hud-dim mb-1">
                <span>任务进度</span>
                <span className="font-mono">{((t.progress ?? 0) * 100).toFixed(1)}%</span>
              </div>
              <div className="h-2 rounded bg-space-900 overflow-hidden">
                <div className="h-full bg-hud-cyan" style={{ width: `${(t.progress ?? 0) * 100}%` }} />
              </div>
              <div className="flex justify-between mt-2 text-[11px] font-mono">
                <span className="text-hud-dim">数据缓存</span>
                <span className="text-hud-cyan">{t.data_mb?.toFixed(2)} MB</span>
              </div>
            </div>
            <div className="flex justify-between text-[10px] font-mono text-hud-dim pt-1 border-t border-space-600/40">
              <span>{t.frequency_mhz?.toFixed(2)} MHz · {t.modulation}</span>
              <span className="text-hud-amber">SIMULATED_RF</span>
            </div>
          </>
        )}

        {t.phase === 'done' && (
          <div className="space-y-2">
            {m.status === 'completed' ? (
              <div className="panel p-3 text-hud-green">
                ✔ 任务成功
                <div className="text-[11px] font-mono text-hud-dim mt-1.5 space-y-0.5">
                  <div>数据 {(m.data_produced_mb as number)?.toFixed(2)} MB</div>
                  <div>链路余量 {(m.result as any)?.avg_margin_db} dB · 覆盖 {((m.result as any)?.coverage ?? 0) * 100}%</div>
                  <div className="text-hud-amber">奖励 +₡{m.reward_credits} +{m.reward_rp} RP</div>
                </div>
              </div>
            ) : (
              <div className="panel p-3 text-hud-red">
                ✖ 任务失败
                <div className="text-[11px] text-hud-dim mt-1">{m.failure_reason}</div>
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
      <span className="text-hud-dim">{k}</span>
      <span className="text-slate-300">{v}</span>
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

  useEffect(() => {
    if (q.length < 1) {
      setResults([])
      return
    }
    const t = window.setTimeout(async () => {
      try {
        const r = await orbitApi.list('stations', q, 30, 0)
        setResults(r.items)
      } catch {
        setResults([])
      }
    }, 300)
    return () => window.clearTimeout(t)
  }, [q])

  const submit = async () => {
    if (!sat || !stationId) return
    setBusy(true)
    setErr(null)
    try {
      await gameApi.createMission({ save_id: saveId, station_id: stationId, satellite_id: sat.norad_id, type })
      onCreated()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" data-testid="create-mission-modal">
      <div className="panel w-[520px] max-w-[92vw] p-4 space-y-3">
        <h3 className="text-sm font-semibold text-slate-100">创建接收任务</h3>

        <div>
          <label className="text-xs text-hud-dim">目标卫星（空间站分组搜索）</label>
          {sat ? (
            <div className="flex items-center justify-between mt-1 panel px-2 py-1.5">
              <span className="text-sm text-slate-200">
                {sat.name} <span className="text-hud-dim text-xs font-mono">#{sat.norad_id}</span>
              </span>
              <button className="text-hud-dim hover:text-slate-200" onClick={() => setSat(null)}>
                更换
              </button>
            </div>
          ) : (
            <>
              <input className="input mt-1" placeholder="搜索名称/目录号…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
              <div className="mt-1 max-h-44 overflow-y-auto space-y-0.5">
                {results.map((s) => (
                  <button
                    key={s.norad_id}
                    className="w-full text-left px-2 py-1.5 rounded hover:bg-space-700/50 text-[13px] text-slate-300 flex justify-between"
                    onClick={() => {
                      setSat(s)
                      setResults([])
                    }}
                  >
                    <span>{s.name}</span>
                    <span className="font-mono text-[10px] text-hud-dim">{s.norad_id}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs text-hud-dim">
            地面站
            <select className="input mt-1" value={stationId} onChange={(e) => setStationId(e.target.value)}>
              {stations.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-hud-dim">
            任务类型
            <select className="input mt-1" value={type} onChange={(e) => setType(e.target.value)}>
              {Object.entries(MISSION_TYPE_LABELS)
                .filter(([k]) => k !== 'decode')
                .map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
            </select>
          </label>
        </div>

        {err && <div className="text-xs text-hud-red">{err}</div>}

        <p className="text-[10px] text-hud-dim leading-relaxed">
          任务将自动规划该卫星下一次过境（72h 内）。系统会校验设备频段覆盖、站点冲突与计算机并发。
          模拟接收结果由简化链路模型 + 种子化抖动决定（SIMULATED_RF）。
        </p>

        <div className="flex justify-end gap-2">
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button className="btn btn-primary" disabled={!sat || busy} onClick={() => void submit()} data-testid="mission-submit">
            {busy ? '规划中…' : '规划任务'}
          </button>
        </div>
      </div>
    </div>
  )
}
