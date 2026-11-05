import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { phase4Api, type GameEventView } from '../api/game'
import { sfx } from '../lib/sfx'
import { useGameStore, useTimeStore } from '../stores/gameStore'
import { useLang, fmt } from '../i18n'

/** 全局游戏事件提示（需求 8.3：事件明确标记为虚拟）+ 首次教程。 */
export default function GameNotifications() {
  const saveId = useGameStore((s) => s.saveId)
  const location = useLocation()
  const [toasts, setToasts] = useState<{ id: number; text: string; kind: string }[]>([])
  const lastCheckedDay = useRef<string>('')
  const { lang, t } = useLang()

  useEffect(() => {
    if (!saveId || location.pathname === '/') return
    const dayKey = new Date(useTimeStore.getState().now()).toISOString().slice(0, 10)
    if (dayKey === lastCheckedDay.current) return
    lastCheckedDay.current = dayKey
    phase4Api
      .eventsCheck(saveId, new Date(useTimeStore.getState().now()).toISOString())
      .then((r) => {
        const items = (r.fired || []).map((e: GameEventView, i: number) => ({
          id: Date.now() + i,
          kind: String(e.kind ?? ''),
          text: describeEvent(e, t.events),
        }))
        if (items.length) setToasts((prev) => [...prev, ...items])
      })
      .catch(() => {})
  }, [saveId, location.pathname, lang, t])

  useEffect(() => {
    if (!toasts.length) return
    const timer = window.setTimeout(() => setToasts((ts) => ts.slice(1)), 9000)
    return () => window.clearTimeout(timer)
  }, [toasts])

  return (
    <div className="fixed bottom-14 right-3 z-50 space-y-2 w-72 pointer-events-none">
      {toasts.map((toast) => (
        <div key={toast.id} className="panel px-3 py-2 text-xs border-warn/40 bg-ground-1" data-testid="event-toast">
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className="chip text-signal border-signal/40">{t.events.tag}</span>
          </div>
          <div className="text-ink leading-relaxed">{toast.text}</div>
        </div>
      ))}
    </div>
  )
}

function describeEvent(e: GameEventView, ev: import('../i18n').Dict['events']): string {
  const station = String(e.station ?? '')
  const equipment = String(e.equipment ?? '')
  switch (e.kind) {
    case 'equipment_fault':
      return fmt(ev.equipmentFault, { station, equipment })
    case 'bonus_window':
      return fmt(ev.bonusWindow, { station })
    case 'power_surge':
      return fmt(ev.powerSurge, { station })
    case 'storage_warning':
      return fmt(ev.storageWarning, { station })
    default:
      return fmt(ev.generic, { kind: String(e.kind ?? '') })
  }
}

/** 首次进入游戏教程（简单步骤卡，localStorage 记忆）。 */
export function TutorialOverlay() {
  const saveId = useGameStore((s) => s.saveId)
  const { t } = useLang()
  const [step, setStep] = useState<number>(() => (localStorage.getItem('sh-tutorial-done') ? -1 : 0))
  if (!saveId || step < 0) return null

  const steps = [
    { title: t.tutorial.s1t, body: t.tutorial.s1b, hint: '' },
    { title: t.tutorial.s2t, body: t.tutorial.s2b, hint: t.tutorial.s2h },
    { title: t.tutorial.s3t, body: t.tutorial.s3b, hint: t.tutorial.s3h },
    { title: t.tutorial.s4t, body: t.tutorial.s4b, hint: t.tutorial.s4h },
  ]
  const s = steps[step]
  return (
    <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center" data-testid="tutorial">
      <div className="panel w-[420px] max-w-[92vw] p-5">
        <div className="text-signal text-[12px] data tracking-[0.3em] mb-2">
          {fmt(t.tutorial.progress, { n: step + 1, total: steps.length })}
        </div>
        <h3 className="text-lg font-semibold text-ink mb-2">{s.title}</h3>
        <p className="text-sm text-ink leading-relaxed">{s.body}</p>
        {s.hint && <p className="text-xs text-ink-dim mt-2">{s.hint}</p>}
        <div className="flex justify-end gap-2 mt-4">
          <button
            className="btn"
            onClick={() => {
              localStorage.setItem('sh-tutorial-done', '1')
              setStep(-1)
            }}
          >
            {t.tutorial.skip}
          </button>
          {step === steps.length - 1 && (
            <button
              className="btn"
              data-testid="tutorial-seed"
              onClick={async () => {
                try {
                  const r = await fetch('/api/game/tutorial/seed', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ save_id: useGameStore.getState().saveId }),
                  })
                  const d = await r.json()
                  if (d.created > 0) sfx.achievement()
                } catch {
                  /* 新手任务可稍后在任务页手动创建 */
                }
                localStorage.setItem('sh-tutorial-done', '1')
                setStep(-1)
              }}
            >
              {t.tutorial.seed}
            </button>
          )}
          <button
            className="btn btn-primary"
            data-testid="tutorial-next"
            onClick={() => {
              if (step === steps.length - 1) {
                localStorage.setItem('sh-tutorial-done', '1')
                setStep(-1)
              } else setStep(step + 1)
            }}
          >
            {step === steps.length - 1 ? t.tutorial.finish : t.tutorial.next}
          </button>
        </div>
      </div>
    </div>
  )
}
