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

export const useGameStore = create<GameStore>((set, get) => ({
  ...initial,
  // 恢复上次活跃存档（页面刷新后保持上下文；数值仍以服务器为准）
  ...(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('sh-save') || 'null')
      if (typeof saved?.saveId === 'string' && saved.saveId) {
        return { saveId: saved.saveId, saveName: typeof saved.saveName === 'string' ? saved.saveName : null }
      }
    } catch {
      /* ignore */
    }
    return {}
  })(),
  setSession: (s) => {
    const previous = get()
    set(s)
    const st = get()
    if (st.saveId && (st.saveId !== previous.saveId || st.saveName !== previous.saveName)) {
      try {
        localStorage.setItem(
          'sh-save',
          JSON.stringify({ saveId: st.saveId, saveName: st.saveName }),
        )
      } catch {
        /* ignore storage quota/privacy errors */
      }
    }
  },
  reset: () => {
    try {
      localStorage.removeItem('sh-save')
    } catch {
      /* ignore */
    }
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

const initialTime = Date.now()

export const useTimeStore = create<TimeStore>((set, get) => ({
  anchorReal: initialTime,
  anchorSim: initialTime,
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
  resetToReal: () => {
    const now = Date.now()
    set({ anchorSim: now, anchorReal: now, scale: 1, paused: false })
  },
}))

const CLOCK_PREFIX = 'sh-clock:'

export function checkpointClock(saveId: string) {
  const { anchorReal, anchorSim, paused, scale, now } = useTimeStore.getState()
  const key = CLOCK_PREFIX + saveId
  try {
    if (!paused && scale === 1 && anchorReal === anchorSim) {
      localStorage.removeItem(key)
    } else {
      localStorage.setItem(key, JSON.stringify({ time: now(), paused, scale }))
    }
  } catch {
    // The backend save still works when browser storage is unavailable.
  }
}

export function restoreClock(saveId: string) {
  try {
    const clock = JSON.parse(localStorage.getItem(CLOCK_PREFIX + saveId) ?? 'null')
    if (clock && typeof clock.paused === 'boolean' && Number.isFinite(clock.time)
      && Math.abs(clock.time) <= 8.64e15 && Number.isFinite(clock.scale) && clock.scale >= 1 && clock.scale <= 1000) {
      useTimeStore.setState({ anchorReal: Date.now(), anchorSim: clock.time, paused: clock.paused, scale: clock.scale })
      return
    }
  } catch {
    // Corrupt or inaccessible clock settings fall back to real time.
  }
  useTimeStore.getState().resetToReal()
}
