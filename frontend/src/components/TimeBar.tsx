import { useEffect, useState } from 'react'
import { useTimeStore } from '../stores/gameStore'
import { useLang, fmt } from '../i18n'
import Icon from './Icon'

const SPEEDS = [1, 10, 60, 300, 1000]

function fmtUTC(ms: number): string {
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19)
}

function fmtLocal(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** 全局时间控制：现实时间 / 暂停 / 1×-1000× / 自定义时刻 / 回到现在。快捷键：空格、1-4、N。 */
export default function TimeBar() {
  const { paused, scale, setPaused, setScale, resetToReal, jumpTo, now } = useTimeStore()
  const { t } = useLang()
  const [, setTick] = useState(0)

  useEffect(() => {
    const iv = window.setInterval(() => setTick((t) => t + 1), 250)
    return () => window.clearInterval(iv)
  }, [])

  const simTime = now()
  const offsetS = (simTime - Date.now()) / 1000
  const isReal = Math.abs(offsetS) < 3 && scale === 1 && !paused

  return (
    <div className="flex items-center gap-3 px-3 h-12 bg-ground-1 text-[13px]">
      <button
        className="btn w-9 px-0"
        onClick={() => setPaused(!paused)}
        title={paused ? t.time.playTitle : t.time.pauseTitle}
      >
        <Icon name={paused ? 'play' : 'pause'} size={14} />
      </button>

      <div className="flex items-center gap-1">
        {SPEEDS.map((s) => (
          <button
            key={s}
            className={`btn w-11 px-0 ${scale === s && !paused ? 'btn-primary' : ''}`}
            onClick={() => setScale(s)}
            title={fmt(t.time.speedTitle, { n: s, key: SPEEDS.indexOf(s) + 1 })}
          >
            {s}×
          </button>
        ))}
      </div>

      <input
        type="datetime-local"
        className="input !w-44 !h-8 text-[12px]"
        onChange={(e) => {
          if (e.target.value) jumpTo(new Date(e.target.value).getTime())
        }}
        title={t.time.jumpTitle}
      />

      <div className="flex-1" />

      <div className="text-right leading-tight">
        <div className="data text-signal text-[13px]" data-testid="time-utc">
          {fmtUTC(simTime)} UTC
        </div>
        <div className="text-ink-dim text-[11px]">{t.time.localLabel} {fmtLocal(simTime)}</div>
      </div>

      <div
        className={`text-[12px] px-2 py-1 rounded ${
          isReal ? 'text-ink-dim' : 'bg-warn/10 text-warn'
        }`}
        data-testid="time-mode"
      >
        {isReal
          ? t.time.realTime
          : paused
            ? fmt(t.time.paused, { offset: `${offsetS > 0 ? '+' : ''}${Math.round(offsetS / 60)}` })
            : fmt(t.time.sim, {
                scale,
                offset: `${offsetS > 0 ? '+' : ''}${Math.round(offsetS / 60)}`,
              })}
      </div>

      {!isReal && (
        <button className="btn" onClick={resetToReal} title={t.time.nowTitle}>
          <Icon name="clock" size={13} />
          {t.time.nowBtn}
        </button>
      )}
    </div>
  )
}
