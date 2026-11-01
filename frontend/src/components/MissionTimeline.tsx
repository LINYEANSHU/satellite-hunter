import { useEffect, useRef } from 'react'
import type { MissionView } from '../api/game'

const HOURS = 48

/** 48 小时任务时间轴：每条已计划/执行中的任务是一条按 AOS-LOS 定位的横条。 */
export default function MissionTimeline({
  missions,
  selectedId,
  onSelect,
}: {
  missions: MissionView[]
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const hits = useRef<{ id: string; x0: number; x1: number; lane: number }[]>([])

  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const ctx = cv.getContext('2d')!
    const W = cv.width
    const H = cv.height
    const ctxStyle = getComputedStyle(document.documentElement)
    void ctxStyle

    ctx.fillStyle = '#0c1016'
    ctx.fillRect(0, 0, W, H)

    const t0 = Date.now()
    const t1 = t0 + HOURS * 3600_000
    const x = (t: number) => 46 + ((t - t0) / (t1 - t0)) * (W - 60)
    const nowY = 18

    // 小时刻度：每 6h 一格
    ctx.font = '10px monospace'
    ctx.fillStyle = '#8b98ab'
    ctx.textAlign = 'center'
    for (let h = 0; h <= HOURS; h += 6) {
      const px = x(t0 + h * 3600_000)
      ctx.fillStyle = '#1a2230'
      ctx.fillRect(px, nowY, 1, H - nowY - 14)
      ctx.fillStyle = '#5a6478'
      ctx.fillText(h === 0 ? '现在' : `+${h}h`, px, H - 3)
    }

    // 现在线
    ctx.fillStyle = '#3fd6e8'
    ctx.fillRect(x(t0), nowY - 4, 1.5, H - nowY - 10)

    // 泳道排布（时间重叠的任务放不同行）
    const relevant = missions
      .filter((m) => ['planned', 'active', 'scheduled'].includes(m.status) && m.aos && m.los)
      .sort((a, b) => new Date(a.aos!).getTime() - new Date(b.aos!).getTime())
    const lanes: number[] = []
    const placed = relevant.map((m) => {
      const s = new Date(m.aos!).getTime()
      const e = new Date(m.los!).getTime()
      let lane = lanes.findIndex((le) => le <= s)
      if (lane === -1) {
        lanes.push(e)
        lane = lanes.length - 1
      } else lanes[lane] = e
      return { m, s, e, lane }
    })

    hits.current = []
    const rowH = 18
    for (const { m, s, e, lane } of placed) {
      const x0 = Math.max(x(s), 46)
      const x1 = Math.min(x(e), W - 14)
      if (x1 <= x0) continue
      const y = nowY + 6 + lane * rowH
      if (y > H - 20) continue
      const isSel = m.id === selectedId
      // 横条
      ctx.fillStyle =
        m.status === 'active' ? 'rgba(74,222,128,.85)' : isSel ? 'rgba(63,214,232,.95)' : 'rgba(63,214,232,.4)'
      ctx.beginPath()
      ctx.roundRect(x0, y, Math.max(6, x1 - x0), 12, 3)
      ctx.fill()
      // 标签（放得下才画）
      if (x1 - x0 > 70) {
        ctx.fillStyle = '#0c1016'
        ctx.font = '9px sans-serif'
        ctx.textAlign = 'left'
        ctx.fillText(m.satellite_name.slice(0, 14), x0 + 4, y + 9)
      }
      hits.current.push({ id: m.id, x0, x1, lane: y })
    }

    if (!placed.length) {
      ctx.fillStyle = '#5a6478'
      ctx.font = '12px sans-serif'
      ctx.textAlign = 'left'
      ctx.fillText('48 小时内没有已计划的任务 —— 创建一个，或使用右侧自动调度。', 52, 44)
    }
  }, [missions, selectedId])

  return (
    <canvas
      ref={ref}
      width={1200}
      height={140}
      className="w-full h-[140px] cursor-pointer"
      data-testid="mission-timeline"
      onClick={(e) => {
        const rect = e.currentTarget.getBoundingClientRect()
        const px = ((e.clientX - rect.left) / rect.width) * 1200
        const py = ((e.clientY - rect.top) / rect.height) * 140
        const hit = hits.current.find((h) => px >= h.x0 - 3 && px <= h.x1 + 3 && py >= h.lane - 2 && py <= h.lane + 16)
        if (hit) onSelect(hit.id)
      }}
    />
  )
}
