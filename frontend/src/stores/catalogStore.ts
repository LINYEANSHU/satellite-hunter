import { create } from 'zustand'
import { fetchPositions, orbitApi, type GroupStatus, type SatelliteItem, type SatelliteListResp } from '../api/orbit'
import { useTimeStore } from './gameStore'

/** 位置采样：一次批量请求的快照。渲染层在相邻两采样间插值获得平滑显示。 */
export interface PositionSample {
  t: number // 采样时刻 (ms, UTC 仿真时间)
  byId: Map<number, [number, number, number]> // ECEF km
}

interface CatalogStore {
  groups: GroupStatus[]
  currentGroup: string
  satellites: SatelliteItem[]
  total: number
  stale: boolean
  loading: boolean
  refreshing: boolean
  sourceInfo: Pick<SatelliteListResp, 'fetched_at' | 'source' | 'bundled' | 'newest_epoch' | 'error'> | null
  error: string | null
  search: string
  selectedId: number | null
  samples: PositionSample[] // 最近两个采样
  pollTimer: number | null
  _polling: boolean

  loadGroups: (syncList?: boolean) => Promise<void>
  setGroup: (g: string) => void
  setSearch: (q: string) => void
  loadSatellites: () => Promise<void>
  select: (noradId: number | null) => void
  startPolling: () => void
  stopPolling: () => void
  refreshGroup: () => Promise<void>
}

async function doFetch(group: string, search: string): Promise<PositionSample> {
  const simT = useTimeStore.getState().now()
  const atIso = new Date(simT).toISOString() // 位置按当前仿真时间计算（时间控制生效）
  // 目录列表已由 loadSatellites 保存在 store：轮询热路径（800ms/次）不再重复
  // 请求 /api/satellites 列表接口。搜索态用 store 中列表的目录号过滤位置请求。
  const ids = search ? useCatalogStore.getState().satellites.map((i) => i.norad_id) : undefined
  const { t, items: pos } = await fetchPositions(group, atIso, ids)
  const byId = new Map<number, [number, number, number]>()
  for (const [id, x, y, z] of pos) byId.set(id, [x, y, z])
  return { t, byId }
}

let listRequest = 0
let pollGeneration = 0

export const useCatalogStore = create<CatalogStore>((set, get) => ({
  groups: [],
  currentGroup: 'stations',
  satellites: [],
  total: 0,
  stale: false,
  loading: false,
  refreshing: false,
  sourceInfo: null,
  error: null,
  search: '',
  selectedId: null,
  samples: [],
  pollTimer: null,
  _polling: false,

  loadGroups: async (syncList = false) => {
    try {
      const groups = await orbitApi.groups()
      set({ groups })
      const { currentGroup, sourceInfo, loading } = get()
      const visible = groups.find(group => group.group === currentGroup)
      if (syncList && !loading && visible?.fetched_at && visible.fetched_at !== sourceInfo?.fetched_at) {
        await get().loadSatellites()
      } else if (syncList && visible) {
        set({ stale: visible.stale })
      }
    } catch (e) {
      if (!syncList) set({ error: String(e) })
    }
  },

  setGroup: (g) => {
    if (g === get().currentGroup) return
    set({ currentGroup: g, satellites: [], samples: [], selectedId: null, total: 0, stale: false, sourceInfo: null })
    void get().loadSatellites()
  },

  setSearch: (q) => {
    set({ search: q, samples: [] })
    void get().loadSatellites()
  },

  loadSatellites: async () => {
    const { currentGroup, search } = get()
    const request = ++listRequest
    set({ loading: true, error: null })
    try {
      const resp = await orbitApi.list(currentGroup, search, 2000, 0)
      if (request !== listRequest) return
      set({
        satellites: resp.items,
        total: resp.total,
        stale: resp.stale,
        sourceInfo: {
          fetched_at: resp.fetched_at, source: resp.source, bundled: resp.bundled,
          newest_epoch: resp.newest_epoch, error: resp.error,
        },
        loading: false,
        samples: [],
      })
    } catch (e) {
      if (request === listRequest) set({ loading: false, error: e instanceof Error ? e.message : String(e) })
    }
  },

  select: (id) => set({ selectedId: id }),

  refreshGroup: async () => {
    const { currentGroup } = get()
    if (get().refreshing) return
    set({ refreshing: true, error: null })
    try {
      await orbitApi.refreshGroup(currentGroup)
      await get().loadGroups()
      if (currentGroup === get().currentGroup) await get().loadSatellites()
    } catch (e) {
      if (currentGroup === get().currentGroup) set({ error: e instanceof Error ? e.message : String(e) })
    } finally {
      set({ refreshing: false })
    }
  },

  startPolling: () => {
    if (get()._polling) return
    const generation = ++pollGeneration
    set({ _polling: true })
    const tick = async () => {
      if (!get()._polling || generation !== pollGeneration) return
      const ts = useTimeStore.getState()
      const lastT = get().samples[get().samples.length - 1]?.t ?? 0
      // 暂停时位置不变：仅当时间被跳转（与最后采样差 > 1.5s）时重新计算
      const needFetch = (!get().search || !get().loading) && (!ts.paused || Math.abs(ts.now() - lastT) > 1500)
      if (needFetch) {
        const { currentGroup, search } = get()
        try {
          const sample = await doFetch(currentGroup, search)
          if (generation === pollGeneration && currentGroup === get().currentGroup && search === get().search) {
            set({ samples: [...get().samples, sample].slice(-2) })
          }
        } catch {
          /* 轮询失败静默，下一轮重试 */
        }
      }
      if (!get()._polling || generation !== pollGeneration) return
      const timer = window.setTimeout(tick, ts.paused ? 300 : 800)
      set({ pollTimer: timer })
    }
    void tick()
  },

  stopPolling: () => {
    pollGeneration++
    const { pollTimer } = get()
    if (pollTimer) window.clearTimeout(pollTimer)
    set({ _polling: false, pollTimer: null })
  },
}))
