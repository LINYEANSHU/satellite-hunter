import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { phase4Api, type GameEventView } from '../api/game'
import { useGameStore, useTimeStore } from '../stores/gameStore'

/** 全局游戏事件提示（需求 8.3：事件明确标记为虚拟）+ 首次教程。 */
export default function GameNotifications() {
  const saveId = useGameStore((s) => s.saveId)
  const location = useLocation()
  const [toasts, setToasts] = useState<{ id: number; text: string; kind: string }[]>([])
  const lastCheckedDay = useRef<string>('')

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
          text: describeEvent(e),
        }))
        if (items.length) setToasts((t) => [...t, ...items])
      })
      .catch(() => {})
  }, [saveId, location.pathname])

  useEffect(() => {
    if (!toasts.length) return
    const t = window.setTimeout(() => setToasts((ts) => ts.slice(1)), 9000)
    return () => window.clearTimeout(t)
  }, [toasts])

  return (
    <div className="fixed bottom-14 right-3 z-50 space-y-2 w-72 pointer-events-none">
      {toasts.map((t) => (
        <div key={t.id} className="panel px-3 py-2 text-xs border-hud-amber/40 bg-space-850/95" data-testid="event-toast">
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className="chip text-hud-violet border-hud-violet/40">GAME_EVENT</span>
          </div>
          <div className="text-slate-200 leading-relaxed">{t.text}</div>
        </div>
      ))}
    </div>
  )
}

function describeEvent(e: GameEventView): string {
  switch (e.kind) {
    case 'equipment_fault':
      return `⚠ 设备故障（虚拟事件）：${e.station} 的「${e.equipment}」损坏，请前往地面站页维修。`
    case 'bonus_window':
      return `★ 临时挑战（虚拟事件）：${e.station} 未来 24h 任务奖励 +50%！`
    case 'power_surge':
      return `⚡ 电力波动（虚拟事件）：${e.station}`
    case 'storage_warning':
      return `💾 存储空间不足（虚拟事件）：${e.station}`
    default:
      return `游戏事件：${e.kind}`
  }
}

/** 首次进入游戏教程（简单步骤卡，localStorage 记忆）。 */
export function TutorialOverlay() {
  const saveId = useGameStore((s) => s.saveId)
  const [step, setStep] = useState<number>(() => (localStorage.getItem('sh-tutorial-done') ? -1 : 0))
  if (!saveId || step < 0) return null

  const steps = [
    {
      title: '欢迎来到 Satellite Hunter',
      body: '你将运营一座地面站，追踪真实卫星、接收信号、建设全球网络。先熟悉三个核心页面。',
      hint: '',
    },
    {
      title: '① 轨道探索',
      body: '左侧选择卫星（ISS、天宫等真实目标），点击地球建站，右侧查看实时位置与未来 48 小时过境预测。',
      hint: '试试底部时间控制：1000× 加速快进过境。',
    },
    {
      title: '② 任务控制',
      body: '为目标卫星创建接收任务，用「自动调度」批量规划。任务执行时注意 SNR 与数据缓存。',
      hint: '任务奖励 Credits 与研究点数。',
    },
    {
      title: '③ 地面站与设备',
      body: '用 Credits 采购更好的天线/SDR/转台并安装，链路余量会显著改善。开始你的第一次任务吧！',
      hint: '本教程只显示一次。',
    },
  ]
  const s = steps[step]
  return (
    <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center" data-testid="tutorial">
      <div className="panel w-[420px] max-w-[92vw] p-5">
        <div className="text-hud-cyan text-[10px] font-mono tracking-[0.3em] mb-2">TUTORIAL {step + 1}/{steps.length}</div>
        <h3 className="text-lg font-semibold text-slate-100 mb-2">{s.title}</h3>
        <p className="text-sm text-slate-300 leading-relaxed">{s.body}</p>
        {s.hint && <p className="text-xs text-hud-dim mt-2">💡 {s.hint}</p>}
        <div className="flex justify-end gap-2 mt-4">
          <button
            className="btn"
            onClick={() => {
              localStorage.setItem('sh-tutorial-done', '1')
              setStep(-1)
            }}
          >
            跳过
          </button>
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
            {step === steps.length - 1 ? '开始游戏' : '下一步 →'}
          </button>
        </div>
      </div>
    </div>
  )
}
