import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { gameApi, phase4Api, type AchievementView, type ResearchItem } from '../api/game'
import PageHeader from '../components/PageHeader'
import Icon from '../components/Icon'
import { useAchievementSfx } from '../lib/sfxHooks'
import { useGameStore } from '../stores/gameStore'
import { useLang, fmt, tr } from '../i18n'

/** 成就与研究（需求 7.3 + 8）：36 项事件驱动成就 + 研究加成。 */
export default function AchievementsPage() {
  const nav = useNavigate()
  const saveId = useGameStore((s) => s.saveId)
  const [data, setData] = useState<{ total: number; unlocked: number; items: AchievementView[] } | null>(null)
  const [research, setResearch] = useState<{ items: ResearchItem[]; effects: Record<string, number> } | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const { t } = useLang()
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
      setMsg(fmt(t.ach.msgUnlocked, { cost: r.cost_rp }))
      void reload()
    } catch (e) {
      setMsg(tr(e))
    }
  }

  if (!saveId) {
    return (
      <div className="h-full panel flex items-center justify-center text-sm text-ink-dim">
        {t.ach.noSave}
        <button className="btn ml-3" onClick={() => nav('/')}>
          {t.ach.backMenu}
        </button>
      </div>
    )
  }

  const items = data?.items ?? []
  const unlocked = items.filter((i) => i.unlocked)
  const locked = items.filter((i) => !i.unlocked)
  const achText = (a: AchievementView) => {
    const entry = (t.ach.items as Record<string, { name: string; desc: string }>)[a.id]
    return { name: entry?.name ?? a.name, desc: entry?.desc ?? a.desc }
  }
  const researchText = (r: ResearchItem) => {
    const entry = (t.ach.researchItems as Record<string, { name: string; desc: string }>)[r.id]
    return { name: entry?.name ?? r.name, desc: entry?.desc ?? r.desc }
  }

  return (
    <div className="h-full overflow-auto">
      <PageHeader
        title={t.ach.title}
        subtitle={fmt(t.ach.subtitle, { a: data?.unlocked ?? 0, b: data?.total ?? 0 })}
      />

      {msg && <div className="panel px-3 py-2 mb-3 text-xs text-signal max-w-2xl">{msg}</div>}

      <div className="space-y-4 pb-6">
        {research && (
          <section>
            <h3 className="text-xs text-ink-dim uppercase tracking-[0.2em] mb-2">
              {fmt(t.ach.research, { rp: Math.round(useGameStore.getState().researchPoints) })}
              {Object.entries(research.effects).length > 0 && (
                <span className="ml-2 normal-case data text-ok">
                  {fmt(t.ach.active, {
                    effects: Object.entries(research.effects)
                      .map(([k, v]) => `${k}+${v}`)
                      .join(' · '),
                  })}
                </span>
              )}
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
              {research.items.map((r) => {
                const txt = researchText(r)
                return (
                  <div key={r.id} className={`panel p-2.5 text-xs ${r.unlocked ? 'border-ok/30' : ''}`} data-testid={`research-${r.id}`}>
                    <div className="flex justify-between items-start gap-1">
                      <span className="text-ink text-[12px] leading-tight">{txt.name}</span>
                      <span className={`chip shrink-0 ${r.unlocked ? 'text-ok border-ok/40' : 'text-warn border-warn/40'}`}>
                        {r.unlocked ? <Icon name="check" size={11} /> : `${r.cost_rp} RP`}
                      </span>
                    </div>
                    <p className="text-[12px] text-ink-dim mt-1 leading-relaxed">{txt.desc}</p>
                    {!r.unlocked && (
                      <button className="btn btn-primary h-6 text-[12px] px-2 mt-1.5 w-full" onClick={() => void unlock(r.id)}>
                        {t.ach.unlock}
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          </section>
        )}

        <section>
          <h3 className="text-xs text-ink-dim uppercase tracking-[0.2em] mb-2">{t.ach.unlockedSection}</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2">
            {unlocked.length === 0 && <div className="text-xs text-ink-dim">{t.ach.emptyHint}</div>}
            {unlocked.map((a) => {
              const txt = achText(a)
              return (
                <div key={a.id} className="panel p-3 border-signal/30" data-testid={`ach-${a.id}`}>
                  <div className="flex items-start gap-2.5">
                    <span className="w-8 h-8 rounded-md bg-signal/10 text-signal flex items-center justify-center shrink-0">
                      <Icon name="trophy" size={16} />
                    </span>
                    <div className="min-w-0">
                      <div className="text-ink text-[13px]">{txt.name}</div>
                      <div className="text-[12.5px] text-ink-dim mt-0.5 leading-relaxed">{txt.desc}</div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        <section>
          <h3 className="text-xs text-ink-dim uppercase tracking-[0.2em] mb-2">{t.ach.lockedSection}</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2">
            {locked.map((a) => {
              const txt = achText(a)
              return (
                <div key={a.id} className="panel p-3 opacity-50" data-testid={`ach-${a.id}`}>
                  <div className="flex items-start gap-2.5">
                    <span className="w-8 h-8 rounded-md bg-ground-3 text-ink-faint flex items-center justify-center shrink-0">
                      <Icon name="trophy" size={16} />
                    </span>
                    <div className="min-w-0">
                      <div className="text-ink text-[13px]">{txt.name}</div>
                      <div className="text-[12.5px] text-ink-dim mt-0.5 leading-relaxed">{txt.desc}</div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      </div>
    </div>
  )
}
