import { create } from 'zustand'
import { gameApi as orbitGameApi, stationApi, type Station } from '../api/orbit'
import { gameApi } from '../api/game'
import { useGameStore } from './gameStore'

interface StationStore {
  saveId: string | null
  stations: Station[]
  /** 选中的站（过境预测与后续任务以此为参考站） */
  activeStationId: string | null
  placementMode: boolean
  /** 初始化：优先使用当前存档；无存档时引导默认存档 */
  bootstrap: () => Promise<void>
  loadStations: () => Promise<void>
  addStation: (s: { name: string; lat: number; lon: number; alt_m: number; min_elevation_deg: number }) => Promise<Station>
  removeStation: (id: string) => Promise<void>
  setActive: (id: string | null) => void
  setPlacementMode: (on: boolean) => void
  refreshCredits: () => Promise<void>
}

export const useStationStore = create<StationStore>((set, get) => ({
  saveId: null,
  stations: [],
  activeStationId: null,
  placementMode: false,

  bootstrap: async () => {
    const gameSaveId = useGameStore.getState().saveId
    if (gameSaveId) {
      // 已有活跃存档：直接使用
      if (get().saveId !== gameSaveId) {
        set({ saveId: gameSaveId, stations: [], activeStationId: null })
        await get().loadStations()
      }
      return
    }
    // 未进存档（直接访问探索页）：引导默认存档并同步到 gameStore
    const resp = await orbitGameApi.bootstrap()
    useGameStore.getState().setSession({
      saveId: resp.save.id,
      saveName: resp.save.name,
      credits: resp.player.credits,
      researchPoints: resp.player.research_points,
      level: resp.player.level,
      totalMissionsDone: resp.player.total_missions_done,
      satellitesDiscovered: resp.player.satellites_discovered,
    })
    set({ saveId: resp.save.id })
    await get().loadStations()
  },

  loadStations: async () => {
    const { saveId } = get()
    if (!saveId) return
    const stations = await stationApi.list(saveId)
    set({ stations })
    if (!get().activeStationId || !stations.some((s) => s.id === get().activeStationId)) {
      set({ activeStationId: stations[0]?.id ?? null })
    }
  },

  addStation: async (s) => {
    const { saveId } = get()
    if (!saveId) throw new Error('未初始化存档')
    const created = await stationApi.create({ save_id: saveId, ...s })
    await get().loadStations()
    set({ activeStationId: created.id })
    await get().refreshCredits()
    return created
  },

  removeStation: async (id) => {
    await stationApi.remove(id)
    await get().loadStations()
  },

  setActive: (id) => set({ activeStationId: id }),
  setPlacementMode: (on) => set({ placementMode: on }),

  refreshCredits: async () => {
    const sid = useGameStore.getState().saveId
    if (!sid) return
    const st = await gameApi.state(sid)
    useGameStore.getState().setSession({
      credits: st.player.credits,
      researchPoints: st.player.research_points,
      xp: st.player.xp,
      level: st.player.level,
      totalMissionsDone: st.player.total_missions_done,
      satellitesDiscovered: st.player.satellites_discovered,
    })
  },
}))
