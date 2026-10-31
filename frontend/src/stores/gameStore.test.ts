import { describe, expect, it } from 'vitest'
import { useTimeStore } from './gameStore'

describe('timeStore', () => {
  it('默认使用现实时间、1×、未暂停', () => {
    const s = useTimeStore.getState()
    expect(s.scale).toBe(1)
    expect(s.paused).toBe(false)
    expect(Math.abs(s.simTime - Date.now())).toBeLessThan(60000)
  })

  it('暂停与倍率可设置', () => {
    useTimeStore.getState().setPaused(true)
    useTimeStore.getState().setScale(100)
    const s = useTimeStore.getState()
    expect(s.paused).toBe(true)
    expect(s.scale).toBe(100)
    useTimeStore.getState().setPaused(false)
    useTimeStore.getState().setScale(1)
  })
})
