import { create } from 'zustand'

/** 当前活跃存档的会话状态。Phase 2 接入后端存档系统。 */

export interface GameSession {
  saveId: string | null
  saveName: string | null
  credits: number
  researchPoints: number
  level: number
}

interface GameStore extends GameSession {
  setSession: (s: Partial<GameSession>) => void
  reset: () => void
}

const initial: GameSession = {
  saveId: null,
  saveName: null,
  credits: 0,
  researchPoints: 0,
  level: 1,
}

export const useGameStore = create<GameStore>((set) => ({
  ...initial,
  setSession: (s) => set(s),
  reset: () => set(initial),
}))

/** 模拟时钟：UTC 毫秒 + 时间倍率。Phase 1 由时间控制面板操作。 */
interface TimeStore {
  /** 当前仿真时间 (ms since epoch, UTC) */
  simTime: number
  paused: boolean
  scale: number
  setSimTime: (t: number) => void
  setPaused: (p: boolean) => void
  setScale: (s: number) => void
}

export const useTimeStore = create<TimeStore>((set) => ({
  simTime: Date.now(),
  paused: false,
  scale: 1,
  setSimTime: (t) => set({ simTime: t }),
  setPaused: (p) => set({ paused: p }),
  setScale: (s) => set({ scale: s }),
}))

// 全局时钟推进器：应用启动一次，所有订阅者共享
let tickerStarted = false
export function startTimeTicker() {
  if (tickerStarted) return
  tickerStarted = true
  let last = performance.now()
  const tick = () => {
    const now = performance.now()
    const dt = now - last
    last = now
    const { paused, scale, simTime } = useTimeStore.getState()
    if (!paused) {
      useTimeStore.setState({ simTime: simTime + dt * scale })
    }
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}
