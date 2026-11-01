import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { gameApi, phase4Api, type AchievementView, type ResearchItem } from '../api/game'
import PageHeader from '../components/PageHeader'
import Icon from '../components/Icon'
import { useAchievementSfx } from '../lib/sfxHooks'
import { useGameStore } from '../stores/gameStore'

/** 成就与研究（需求 7.3 + 8）：32 项事件驱动成就 + 研究加成。 */
export default function AchievementsPage() {
  const nav = useNavigate()
  const saveId = useGameStore((s) => s.saveId)
  const [data, setData] = useState<{ total: number; unlocked: number; items: AchievementView[] } | null>(null)
  const [research, setResearch] = useState<{ items: ResearchItem[]; effects: Record<string, number> } | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  useAchievementSfx(data?.unlocked)

  const reload = useCallback(async () => {
    if (!saveId) return
    setData(await gameApi.achievements(saveId))
    setResearch(await phase4Api.research(saveId))
  }, [saveId])

  useEffect(() => {
    void reload()
    const iv = window.setInterval(reload, 8000)
    return () => window.clearInterval(iv)
  }, [reload])

  const unlock = async (rid: string) => {
    if (!saveId) return
    try {
      const r = await phase4Api.researchUnlock(rid, saveId)
      setMsg(`已解锁研究（消耗 ${r.cost_rp} RP）`)
      void reload()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
    }
  }

  if (!saveId) {
    return (
      <div className="h-full panel flex items-center justify-center text-sm text-ink-dim">
        未进入存档
        <button className="btn ml-3" onClick={() => nav('/')}>
          返回主菜单
        </button>
      </div>
    )
  }

  const items = data?.items ?? []
  const unlocked = items.filter((i) => i.unlocked)
  const locked = items.filter((i) => !i.unlocked)

  return (
    <div className="h-full overflow-auto">
      <PageHeader title="成就与研究" subtitle={`${data?.unlocked ?? 0} / ${data?.total ?? 0} 已解锁`} />

      {msg && <div className="panel px-3 py-2 mb-3 text-xs text-signal max-w-2xl">{msg}</div>}

      <div className="space-y-4 pb-6">
        {research && (
          <section>
            <h3 className="text-xs text-ink-dim uppercase tracking-[0.2em] mb-2">
              研究加成（RP {Math.round(useGameStore.getState().researchPoints)}）
              {Object.entries(research.effects).length > 0 && (
                <span className="ml-2 normal-case data text-ok">
                  生效中: {Object.entries(research.effects).map(([k, v]) => `${k}+${v}`).join(' · ')}
                </span>
              )}
            </h3>
            <div className="grid grid-cols-5 gap-2">
              {research.items.map((r) => (
                <div key={r.id} className={`panel p-2.5 text-xs ${r.unlocked ? 'border-ok/30' : ''}`} data-testid={`research-${r.id}`}>
                  <div className="flex justify-between items-start gap-1">
                    <span className="text-ink text-[12px] leading-tight">{r.name}</span>
                    <span className={`chip shrink-0 ${r.unlocked ? 'text-ok border-ok/40' : 'text-warn border-warn/40'}`}>
                      {r.unlocked ? <Icon name="check" size={11} /> : `${r.cost_rp} RP`}
                    </span>
                  </div>
                  <p className="text-[12px] text-ink-dim mt-1 leading-relaxed">{r.desc}</p>
                  {!r.unlocked && (
                    <button className="btn btn-primary h-6 text-[12px] px-2 mt-1.5 w-full" onClick={() => void unlock(r.id)}>
                      解锁
                    </button>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        <section>
          <h3 className="text-xs text-ink-dim uppercase tracking-[0.2em] mb-2">已解锁成就</h3>
          <div className="grid grid-cols-4 gap-2">
            {unlocked.length === 0 && <div className="text-xs text-ink-dim">完成任务、建设站点即可解锁成就。</div>}
            {unlocked.map((a) => (
              <div key={a.id} className="panel p-3 border-signal/30" data-testid={`ach-${a.id}`}>
                <div className="flex items-start gap-2.5">
                  <span className="w-8 h-8 rounded-md bg-signal/10 text-signal flex items-center justify-center shrink-0">
                    <Icon name="trophy" size={16} />
                  </span>
                  <div className="min-w-0">
                    <div className="text-ink text-[13px]">{a.name}</div>
                    <div className="text-[12.5px] text-ink-dim mt-0.5 leading-relaxed">{a.desc}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h3 className="text-xs text-ink-dim uppercase tracking-[0.2em] mb-2">待解锁</h3>
          <div className="grid grid-cols-4 gap-2">
            {locked.map((a) => (
              <div key={a.id} className="panel p-3 opacity-50" data-testid={`ach-${a.id}`}>
                <div className="flex items-start gap-2.5">
                  <span className="w-8 h-8 rounded-md bg-ground-3 text-ink-faint flex items-center justify-center shrink-0">
                    <Icon name="trophy" size={16} />
                  </span>
                  <div className="min-w-0">
                    <div className="text-ink text-[13px]">{a.name}</div>
                    <div className="text-[12.5px] text-ink-dim mt-0.5 leading-relaxed">{a.desc}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
