import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, type Capabilities } from '../api/client'
import { gameApi, type SaveInfo } from '../api/game'
import { useGameStore } from '../stores/gameStore'

/** 主菜单：多存档管理（需求 11.2-1）。 */
export default function MainMenuPage() {
  const nav = useNavigate()
  const [caps, setCaps] = useState<Capabilities | null>(null)
  const [saves, setSaves] = useState<SaveInfo[]>([])
  const [newName, setNewName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const setSession = useGameStore((s) => s.setSession)

  const refresh = useCallback(() => {
    api.capabilities().then(setCaps).catch((e) => setError(e.message))
    gameApi.saves().then(setSaves).catch((e) => setError(e.message))
  }, [])

  useEffect(refresh, [refresh])

  const enter = (s: SaveInfo) => {
    setSession({
      saveId: s.id,
      saveName: s.name,
      credits: s.credits,
      researchPoints: s.research_points,
      level: s.level,
      totalMissionsDone: s.total_missions_done,
      satellitesDiscovered: s.satellites_discovered,
    })
    nav('/explorer')
  }

  const create = async () => {
    if (!newName.trim()) return
    try {
      const s = await gameApi.createSave(newName.trim())
      setNewName('')
      refresh()
      enter({ ...s, last_played_at: null, credits: 5000, research_points: 0, level: 1, total_missions_done: 0, satellites_discovered: 0 })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="h-full flex flex-col items-center justify-center bg-[radial-gradient(ellipse_at_top,#0d1420_0%,#070b12_65%)] overflow-auto py-8">
      <div className="text-center mb-8">
        <div className="text-6xl text-hud-cyan mb-4 animate-pulseSoft">◉</div>
        <h1 className="text-3xl font-semibold tracking-[0.25em] text-slate-100">SATELLITE HUNTER</h1>
        <p className="mt-2 text-hud-dim tracking-[0.4em] text-sm">GROUND STATION</p>
      </div>

      <div className="w-[480px] max-w-[90vw] space-y-3">
        <div className="panel">
          <div className="panel-header">
            <span>存档管理</span>
            <span className="font-mono normal-case">{saves.length} 个存档</span>
          </div>
          <div className="divide-y divide-space-600/40">
            {saves.length === 0 && (
              <div className="p-4 text-xs text-hud-dim text-center">还没有存档——创建一个开始游戏</div>
            )}
            {saves.map((s) => (
              <div key={s.id} className="flex items-center gap-3 px-3 py-2.5 hover:bg-space-700/30">
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-slate-200">{s.name}</div>
                  <div className="text-[10px] font-mono text-hud-dim mt-0.5">
                    Lv.{s.level} · ₡{Math.round(s.credits).toLocaleString()} · 任务 {s.total_missions_done} · 发现 {s.satellites_discovered}
                    {s.last_played_at && ` · ${new Date(s.last_played_at).toLocaleString()}`}
                  </div>
                </div>
                <button className="btn btn-primary h-7 text-xs" onClick={() => enter(s)} data-testid={`enter-${s.name}`}>
                  进入
                </button>
                <button
                  className="btn btn-danger h-7 text-xs"
                  onClick={async () => {
                    if (confirm(`删除存档「${s.name}」？此操作不可恢复。`)) {
                      await gameApi.deleteSave(s.id)
                      refresh()
                    }
                  }}
                  data-testid={`delete-${s.name}`}
                >
                  删除
                </button>
              </div>
            ))}
          </div>
          <div className="p-3 border-t border-space-600/40 flex gap-2">
            <input
              className="input"
              placeholder="新存档名称…"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void create()}
              data-testid="new-save-input"
            />
            <button className="btn btn-primary" onClick={() => void create()} data-testid="create-save">
              新建
            </button>
          </div>
        </div>

        <div className="panel px-4 py-3 text-xs font-mono text-hud-dim">
          <div className="flex justify-between py-0.5">
            <span>后端连接</span>
            <span className={error ? 'text-hud-red' : 'text-hud-green'}>{error ? 'FAIL' : 'OK'}</span>
          </div>
          <div className="flex justify-between py-0.5">
            <span>后端版本</span>
            <span className="text-slate-400">{caps?.app.version ?? '—'}</span>
          </div>
          <div className="flex justify-between py-0.5">
            <span>SatDump 解码</span>
            <span className={caps?.satdump.installed ? 'text-hud-green' : 'text-hud-amber'}>
              {caps ? (caps.satdump.installed ? `OK (${caps.satdump.source})` : '未安装') : '—'}
            </span>
          </div>
        </div>
      </div>

      {error && <p className="mt-4 text-xs text-hud-red">{error}</p>}
    </div>
  )
}
