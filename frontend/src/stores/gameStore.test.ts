import { describe, expect, it, vi } from 'vitest'
import { checkpointClock, restoreClock, useTimeStore } from './gameStore'

describe('timeStore（锚点推导式时钟）', () => {
  it('默认与现实时间同步、1×、未暂停', () => {
    const s = useTimeStore.getState()
    s.resetToReal()
    expect(s.scale).toBe(1)
    expect(s.paused).toBe(false)
    expect(Math.abs(s.now() - Date.now())).toBeLessThan(100)
  })

  it('now() 随真实时间自动推进（无计时器依赖）', () => {
    const s = useTimeStore.getState()
    s.resetToReal()
    const t1 = s.now()
    const elapsed = Date.now() - t1
    expect(Math.abs(elapsed)).toBeLessThan(100)
  })

  it('倍率缩放时间流速', () => {
    const s = useTimeStore.getState()
    s.resetToReal()
    s.setScale(100)
    const t1 = s.now()
    // 忙等 60ms 真实时间 → 应推进约 6s 仿真时间
    const busyStart = Date.now()
    while (Date.now() - busyStart < 60) {
      /* spin */
    }
    const delta = s.now() - t1
    expect(delta).toBeGreaterThan(60 * 60) // >60× 于真实流逝
    expect(delta).toBeLessThan(60 * 200)
    s.resetToReal()
  })

  it('暂停后时间冻结，恢复后继续', () => {
    const s = useTimeStore.getState()
    s.resetToReal()
    s.setPaused(true)
    const t1 = s.now()
    const busyStart = Date.now()
    while (Date.now() - busyStart < 30) {
      /* spin */
    }
    expect(s.now()).toBe(t1)
    s.setPaused(false)
    expect(s.now()).toBeGreaterThanOrEqual(t1)
    s.resetToReal()
  })

  it('跳转后从新锚点继续', () => {
    const s = useTimeStore.getState()
    const target = Date.parse('2027-01-15T12:00:00Z')
    s.jumpTo(target)
    expect(Math.abs(s.now() - target)).toBeLessThan(100)
    s.resetToReal()
  })

  it('各存档从各自的模拟时间、倍率和暂停状态继续', () => {
    const start = Date.parse('2027-01-15T12:00:00Z')
    vi.useFakeTimers({ now: start })
    try {
      const s = useTimeStore.getState()
      s.setScale(60)
      s.jumpTo(start + 3_600_000)
      s.setPaused(true)
      checkpointClock('paused-save')

      s.resetToReal()
      s.setScale(10)
      vi.advanceTimersByTime(2000)
      checkpointClock('running-save')
      vi.advanceTimersByTime(10000)

      restoreClock('paused-save')
      expect(useTimeStore.getState()).toMatchObject({ paused: true, scale: 60 })
      expect(s.now()).toBe(start + 3_600_000)

      restoreClock('running-save')
      expect(useTimeStore.getState()).toMatchObject({ paused: false, scale: 10 })
      expect(s.now()).toBe(start + 20_000)
      vi.advanceTimersByTime(1000)
      expect(s.now()).toBe(start + 30_000)

      restoreClock('new-save')
      expect(useTimeStore.getState()).toMatchObject({ paused: false, scale: 1 })
      expect(s.now()).toBe(Date.now())
    } finally {
      localStorage.clear()
      vi.useRealTimers()
      useTimeStore.getState().resetToReal()
    }
  })
})
