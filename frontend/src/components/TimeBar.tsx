import { useEffect, useState } from 'react'
import { useTimeStore } from '../stores/gameStore'

const SPEEDS = [1, 10, 60, 300, 1000]

function fmtUTC(ms: number): string {
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19)
}

function fmtLocal(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** 底部时间控制条：现实时间 / 暂停 / 1×-1000× / 回到当前（需求 3.4）。

  时钟为锚点推导式（见 gameStore），此处仅按 250ms 触发重渲染。 */
export default function TimeBar() {
  const { paused, scale, setPaused, setScale, resetToReal, jumpTo, now } = useTimeStore()
  const [, setTick] = useState(0)

  useEffect(() => {
    const iv = window.setInterval(() => setTick((t) => t + 1), 250)
    return () => window.clearInterval(iv)
  }, [])

  const simTime = now()
  const offsetS = (simTime - Date.now()) / 1000
  const isReal = Math.abs(offsetS) < 3 && scale === 1 && !paused

  return (
    <div className="flex items-center gap-3 px-3 h-11 border-t border-space-600/60 bg-space-900/90 text-xs">
      <button
        className={`btn h-7 px-2 ${paused ? 'btn-primary' : ''}`}
        onClick={() => setPaused(!paused)}
        data-testid="time-pause"
        title={paused ? '继续' : '暂停'}
      >
        {paused ? '▶' : '❚❚'}
      </button>

      <div className="flex items-center gap-1">
        {SPEEDS.map((s) => (
          <button
            key={s}
            className={`btn h-7 px-2 font-mono ${scale === s && !paused ? 'btn-primary' : ''}`}
            onClick={() => setScale(s)}
            data-testid={`speed-${s}x`}
          >
            {s}×
          </button>
        ))}
      </div>

      {/* 自定义时刻跳转 */}
      <input
        type="datetime-local"
        className="input !w-44 !h-7 text-[11px]"
        onChange={(e) => {
          if (e.target.value) jumpTo(new Date(e.target.value).getTime())
        }}
        title="跳转到指定时刻（本地时区）"
      />

      <div className="flex-1" />

      <div className="font-mono text-right leading-tight">
        <div className="text-hud-cyan" data-testid="time-utc">
          {fmtUTC(simTime)} <span className="text-hud-dim">UTC</span>
        </div>
        <div className="text-hud-dim text-[10px]">本地 {fmtLocal(simTime)}</div>
      </div>

      <div className={`chip ${isReal ? '' : 'text-hud-amber border-hud-amber/40'}`} data-testid="time-mode">
        {isReal
          ? '现实时间'
          : paused
            ? `已暂停 (偏移 ${offsetS > 0 ? '+' : ''}${Math.round(offsetS / 60)}min)`
            : `游戏时间 ${scale}× (偏移 ${offsetS > 0 ? '+' : ''}${Math.round(offsetS / 60)}min)`}
      </div>

      {!isReal && (
        <button className="btn h-7 px-2" onClick={resetToReal} title="回到当前现实时间">
          ⏱ 现在
        </button>
      )}
    </div>
  )
}
