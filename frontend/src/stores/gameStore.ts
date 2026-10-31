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

/**
 * 模拟时钟（锚点推导式）。
 *
 * simTime = paused ? anchorSim : anchorSim + (Date.now() - anchorReal) × scale
 *
 * 不依赖任何计时器推进：Date.now() 在标签页节流/遮挡下依然前进，
 * 时钟永远不会"冻结"；UI 只是按需重渲染。
 */
interface TimeStore {
  anchorReal: number
  anchorSim: number
  paused: boolean
  scale: number
  /** 当前仿真时间 (ms since epoch, UTC) */
  now: () => number
  setPaused: (p: boolean) => void
  setScale: (s: number) => void
  jumpTo: (ms: number) => void
  resetToReal: () => void
}

export const useTimeStore = create<TimeStore>((set, get) => ({
  anchorReal: Date.now(),
  anchorSim: Date.now(),
  paused: false,
  scale: 1,
  now: () => {
    const { paused, anchorSim, anchorReal, scale } = get()
    return paused ? anchorSim : anchorSim + (Date.now() - anchorReal) * scale
  },
  setPaused: (p) =>
    set((st) => (p === st.paused ? st : { anchorSim: st.now(), anchorReal: Date.now(), paused: p })),
  setScale: (s) =>
    set((st) => (s === st.scale ? st : { anchorSim: st.now(), anchorReal: Date.now(), scale: s, paused: false })),
  jumpTo: (ms) => set({ anchorSim: ms, anchorReal: Date.now() }),
  resetToReal: () => set({ anchorSim: Date.now(), anchorReal: Date.now(), scale: 1, paused: false }),
}))
