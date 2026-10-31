import { create } from 'zustand'

/** 活跃存档会话状态（Phase 2 完整版）。 */

export interface GameSession {
  saveId: string | null
  saveName: string | null
  credits: number
  researchPoints: number
  xp: number
  level: number
  totalMissionsDone: number
  satellitesDiscovered: number
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
  xp: 0,
  level: 1,
  totalMissionsDone: 0,
  satellitesDiscovered: 0,
}

export const useGameStore = create<GameStore>((set) => ({
  // 恢复上次活跃存档（页面刷新后保持上下文；数值仍以服务器为准）
  ...(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('sh-save') || 'null')
      if (saved?.saveId) return saved
    } catch {
      /* ignore */
    }
    return {}
  })(),
  setSession: (s) => {
    set(s)
    const st = useGameStore.getState()
    if (st.saveId) {
      localStorage.setItem(
        'sh-save',
        JSON.stringify({ saveId: st.saveId, saveName: st.saveName }),
      )
    }
  },
  reset: () => {
    localStorage.removeItem('sh-save')
    set(initial)
  },
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
