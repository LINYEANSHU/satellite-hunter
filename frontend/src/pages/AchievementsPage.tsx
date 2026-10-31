import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { gameApi, type AchievementView } from '../api/game'
import PageHeader from '../components/PageHeader'
import { useGameStore } from '../stores/gameStore'

/** 成就与研究（需求 7.3）：32 项事件驱动成就。 */
export default function AchievementsPage() {
  const nav = useNavigate()
  const saveId = useGameStore((s) => s.saveId)
  const [data, setData] = useState<{ total: number; unlocked: number; items: AchievementView[] } | null>(null)

  const reload = useCallback(async () => {
    if (!saveId) return
    setData(await gameApi.achievements(saveId))
  }, [saveId])

  useEffect(() => {
    void reload()
    const iv = window.setInterval(reload, 8000) // 成就随游戏事件持续解锁
    return () => window.clearInterval(iv)
  }, [reload])

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

  const items = data?.items ?? []
  const unlocked = items.filter((i) => i.unlocked)
  const locked = items.filter((i) => !i.unlocked)

  return (
    <div className="h-full overflow-auto">
      <PageHeader
        title="成就与研究"
        subtitle={`${data?.unlocked ?? 0} / ${data?.total ?? 0} 已解锁`}
      />

      <div className="space-y-4 pb-6">
        <section>
          <h3 className="text-xs text-hud-dim uppercase tracking-[0.2em] mb-2">已解锁</h3>
          <div className="grid grid-cols-4 gap-2">
            {unlocked.length === 0 && <div className="text-xs text-hud-dim">完成任务、建设站点即可解锁成就。</div>}
            {unlocked.map((a) => (
              <div key={a.id} className="panel p-3 border-hud-cyan/30" data-testid={`ach-${a.id}`}>
                <div className="flex items-start gap-2">
                  <span className="text-2xl leading-none">{a.icon}</span>
                  <div className="min-w-0">
                    <div className="text-slate-100 text-[13px]">{a.name}</div>
                    <div className="text-[10px] text-hud-dim mt-0.5 leading-relaxed">{a.desc}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h3 className="text-xs text-hud-dim uppercase tracking-[0.2em] mb-2">待解锁</h3>
          <div className="grid grid-cols-4 gap-2">
            {locked.map((a) => (
              <div key={a.id} className="panel p-3 opacity-45" data-testid={`ach-${a.id}`}>
                <div className="flex items-start gap-2">
                  <span className="text-2xl leading-none grayscale">{a.icon}</span>
                  <div className="min-w-0">
                    <div className="text-slate-300 text-[13px]">{a.name}</div>
                    <div className="text-[10px] text-hud-dim mt-0.5 leading-relaxed">{a.desc}</div>
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
