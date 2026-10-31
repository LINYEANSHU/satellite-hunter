import { describe, expect, it } from 'vitest'
import { useTimeStore } from './gameStore'

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
})
