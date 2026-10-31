import { create } from 'zustand'
import { gameApi, stationApi, type Station } from '../api/orbit'

interface StationStore {
  saveId: string | null
  saveName: string | null
  credits: number
  stations: Station[]
  /** 选中的站（过境预测与后续任务以此为参考站） */
  activeStationId: string | null
  placementMode: boolean
  bootstrap: () => Promise<void>
  loadStations: () => Promise<void>
  addStation: (s: { name: string; lat: number; lon: number; alt_m: number; min_elevation_deg: number }) => Promise<Station>
  removeStation: (id: string) => Promise<void>
  setActive: (id: string | null) => void
  setPlacementMode: (on: boolean) => void
}

export const useStationStore = create<StationStore>((set, get) => ({
  saveId: null,
  saveName: null,
  credits: 0,
  stations: [],
  activeStationId: null,
  placementMode: false,

  bootstrap: async () => {
    const resp = await gameApi.bootstrap()
    set({ saveId: resp.save.id, saveName: resp.save.name, credits: resp.player.credits })
    await get().loadStations()
  },

  loadStations: async () => {
    const { saveId } = get()
    if (!saveId) return
    const stations = await stationApi.list(saveId)
    set({ stations })
    if (!get().activeStationId && stations.length) {
      set({ activeStationId: stations[0].id })
    }
  },

  addStation: async (s) => {
    const { saveId } = get()
    if (!saveId) throw new Error('未初始化存档')
    const created = await stationApi.create({ save_id: saveId, ...s })
    await get().loadStations()
    set({ activeStationId: created.id })
    return created
  },

  removeStation: async (id) => {
    await stationApi.remove(id)
    await get().loadStations()
  },

  setActive: (id) => set({ activeStationId: id }),
  setPlacementMode: (on) => set({ placementMode: on }),
}))
