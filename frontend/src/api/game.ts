/** Phase 2 游戏 API 客户端：存档/设备/任务/图鉴/成就 */
import { request } from './client'

export interface SaveInfo {
  id: string
  name: string
  last_played_at: string | null
  credits: number
  research_points: number
  level: number
  total_missions_done: number
  satellites_discovered: number
}

export interface GameState {
  save: { id: string; name: string; created_at: string }
  player: {
    credits: number
    research_points: number
    xp: number
    level: number
    total_missions_done: number
    satellites_discovered: number
  }
  stations_count: number
}

export interface EquipmentItem {
  id: string
  catalog_id: string
  name: string
  desc: string
  category: string | null
  price: number | null
  specs: Record<string, unknown>
  station_id: string | null
  status: string
  condition: number
}

export interface CatalogCategory {
  category: string
  items: (EquipmentItem & { id?: string })[]
}

export interface MissionView {
  id: string
  save_id: string
  station_id: string
  satellite_id: number
  satellite_name: string
  type: string
  status: string
  priority: number
  aos: string | null
  los: string | null
  max_elevation_deg: number
  frequency_hz: number | null
  planned_duration_s: number
  estimated_data_mb: number
  reward_credits: number
  reward_rp: number
  reward_xp: number
  auto: boolean
  result: Record<string, unknown> | null
  failure_reason: string
  data_produced_mb: number
}

export interface Telemetry {
  status: string
  phase: string
  progress?: number
  azimuth_deg?: number
  elevation_deg?: number
  range_km?: number
  snr_db?: number
  margin_db?: number
  doppler_hz?: number
  quality?: number
  data_mb?: number
  frequency_mhz?: number
  modulation?: string
  source?: string
  seconds_to_aos?: number
  mission: MissionView
  achievements_unlocked?: string[]
}

export interface CollectionEntryView {
  satellite_id: number
  satellite_name: string
  category: string
  status: string
  first_observed_at: string | null
  successful_missions: number
  favorite: boolean
  notes: string
}

export interface AchievementView {
  id: string
  name: string
  desc: string
  icon: string
  unlocked: boolean
  unlocked_at: string | null
}

export const gameApi = {
  saves: () => request<SaveInfo[]>('/api/saves'),
  createSave: (name: string) =>
    request<{ id: string; name: string }>('/api/saves', { method: 'POST', body: JSON.stringify({ name }) }),
  deleteSave: (id: string) => request<{ deleted: string }>(`/api/saves/${id}`, { method: 'DELETE' }),
  state: (saveId: string) => request<GameState>(`/api/game/state?save_id=${saveId}`),

  catalog: () => request<{ categories: CatalogCategory[]; meta: Record<string, unknown> }>('/api/equipment/catalog'),
  equipment: (saveId: string) => request<EquipmentItem[]>(`/api/equipment?save_id=${saveId}`),
  buy: (saveId: string, catalogId: string) =>
    request<EquipmentItem>('/api/equipment/buy', { method: 'POST', body: JSON.stringify({ save_id: saveId, catalog_id: catalogId }) }),
  install: (equipmentId: string, saveId: string, stationId: string) =>
    request<EquipmentItem>(`/api/equipment/${equipmentId}/install`, {
      method: 'POST',
      body: JSON.stringify({ save_id: saveId, station_id: stationId }),
    }),
  unequip: (equipmentId: string, saveId: string, stationId: string) =>
    request<EquipmentItem>(`/api/equipment/${equipmentId}/unequip`, {
      method: 'POST',
      body: JSON.stringify({ save_id: saveId, station_id: stationId }),
    }),
  sell: (equipmentId: string, saveId: string) =>
    request<{ refund: number }>(`/api/equipment/${equipmentId}?save_id=${saveId}`, { method: 'DELETE' }),

  missions: (saveId: string, status = '') =>
    request<MissionView[]>(`/api/missions?save_id=${saveId}${status ? `&status=${status}` : ''}`),
  createMission: (body: {
    save_id: string
    station_id: string
    satellite_id: number
    type: string
    priority?: number
    at?: string
    auto?: boolean
  }) => request<MissionView>('/api/missions', { method: 'POST', body: JSON.stringify(body) }),
  startMission: (id: string) => request<MissionView>(`/api/missions/${id}/start`, { method: 'POST' }),
  cancelMission: (id: string) => request<MissionView>(`/api/missions/${id}/cancel`, { method: 'POST' }),
  telemetry: (id: string, atIso: string) =>
    request<Telemetry>(`/api/missions/${id}/telemetry?at=${encodeURIComponent(atIso)}`),

  collection: (saveId: string) => request<CollectionEntryView[]>(`/api/collection?save_id=${saveId}`),
  favorite: (satelliteId: number, saveId: string) =>
    request<{ favorite: boolean; achievements_unlocked: string[] }>(
      `/api/collection/${satelliteId}/favorite?save_id=${saveId}`,
      { method: 'POST' },
    ),
  achievements: (saveId: string) =>
    request<{ total: number; unlocked: number; items: AchievementView[] }>(`/api/achievements?save_id=${saveId}`),
}

export const CATEGORY_LABELS: Record<string, string> = {
  antenna: '天线',
  sdr: 'SDR 接收机',
  amplifier: '低噪放大器',
  filter: '滤波器',
  rotator: '转台',
  computer: '计算机',
  storage: '存储',
}

export const MISSION_TYPE_LABELS: Record<string, string> = {
  tutorial: '新手观测',
  track: '卫星追踪',
  plan: '过境规划',
  capture: '信号捕获',
  decode: '真实解码',
  auto: '自动任务',
  collection: '收藏发现',
}

export function stationName(stations: { id: string; name: string }[], id: string | null | undefined): string {
  return stations.find((s) => s.id === id)?.name ?? (id ? id.slice(0, 8) : '—')
}
