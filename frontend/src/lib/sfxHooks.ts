import { useEffect, useRef } from 'react'
import { sfx } from './sfx'

export { sfx }

/** 任务执行面板音效挂钩：结算瞬间播放一次。 */
export function useMissionSfx(status: string | undefined, phase: string | undefined) {
  const prev = useRef<string>('')
  useEffect(() => {
    if (!status || !phase) return
    const key = `${status}:${phase}`
    if (prev.current === key) return
    const wasDone = prev.current.endsWith(':done')
    prev.current = key
    if (wasDone) return
    if (key === 'completed:done') sfx.taskComplete()
    else if (key === 'failed:done') sfx.taskFailed()
  }, [status, phase])
}

/** 成就解锁音效：集合增大时响一次。 */
export function useAchievementSfx(unlockedCount: number | undefined) {
  const prev = useRef<number>(0)
  useEffect(() => {
    if (unlockedCount === undefined) return
    if (unlockedCount > prev.current && prev.current > 0) sfx.achievement()
    prev.current = Math.max(prev.current, unlockedCount)
  }, [unlockedCount])
}
