/** 轨道与地面站 API 客户端 */
import { request } from './client'

export interface SatelliteItem {
  norad_id: number
  name: string
  epoch: string | null
  origin: string
  source: string
}

export interface SatelliteListResp {
  group: string
  label: string
  stale: boolean
  fetched_at: number
  total: number
  items: SatelliteItem[]
}

export interface GroupStatus {
  group: string
  label: string
  count: number
  fetched_at: number | null
  age_hours: number | null
  stale: boolean
  error: string | null
  newest_epoch: string | null
}

export interface Position {
  norad_id: number
  error: number
  error_msg?: string
  lat?: number
  lon?: number
  alt_km?: number
  speed_km_s?: number
  ecef_km?: number[]
  velocity_km_s?: number[]
}

export interface SatelliteDetail extends SatelliteItem {
  groups: string[]
  omm: Record<string, string | null>
  position: Position | null
  data_age_hours: number | null
}

export interface TrackPoint {
  t: string
  ecef_km: number[]
  lat: number
  lon: number
  alt_km: number
}

export interface PassInfo {
  satellite_id: number
  aos: string
  los: string
  tca: string
  max_elevation_deg: number
  aos_azimuth_deg: number
  los_azimuth_deg: number
  tca_azimuth_deg: number
  duration_s: number
  min_elevation_deg: number
}

export interface Station {
  id: string
  save_id: string
  name: string
  lat: number
  lon: number
  alt_m: number
  min_elevation_deg: number
  status: string
  is_virtual: boolean
  maintenance: number
  created_at: string | null
}

export interface BootstrapResp {
  created: boolean
  save: { id: string; name: string; sim_time_mode: string; sim_time_scale: number; sim_time_offset_s: number }
  player: { credits: number; research_points: number; level: number; xp: number; total_missions_done: number; satellites_discovered: number }
}

export const orbitApi = {
  groups: () => request<GroupStatus[]>('/api/satellites/groups'),
  refreshGroup: (group: string) =>
    request<GroupStatus>('/api/satellites/refresh', { method: 'POST', body: JSON.stringify({ group }) }),
  list: (group: string, q = '', limit = 500, offset = 0) =>
    request<SatelliteListResp>(
      `/api/satellites?group=${encodeURIComponent(group)}&q=${encodeURIComponent(q)}&limit=${limit}&offset=${offset}`,
    ),
  detail: (noradId: number) => request<SatelliteDetail>(`/api/satellites/${noradId}`),
  track: (noradId: number, minutes: number, stepS: number, at: string) =>
    request<{ norad_id: number; points: TrackPoint[] }>(
      `/api/satellites/${noradId}/track?minutes=${minutes}&step_s=${stepS}&at=${encodeURIComponent(at)}`,
    ),
  passes: (noradId: number, stationId: string, hours = 48, at?: string) =>
    request<{ passes: PassInfo[] }>(
      `/api/satellites/${noradId}/passes?station_id=${stationId}&hours=${hours}${at ? `&at=${encodeURIComponent(at)}` : ''}`,
    ),
  importTle: (text: string) =>
    request<{ imported: number; items: { norad_id: number; name: string }[] }>(
      '/api/satellites/import_tle',
      { method: 'POST', body: JSON.stringify({ text }) },
    ),
}

export const stationApi = {
  list: (saveId: string) => request<Station[]>(`/api/stations?save_id=${saveId}`),
  create: (body: { save_id: string; name: string; lat: number; lon: number; alt_m: number; min_elevation_deg: number }) =>
    request<Station>('/api/stations', { method: 'POST', body: JSON.stringify(body) }),
  update: (id: string, body: Partial<Station>) =>
    request<Station>(`/api/stations/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  remove: (id: string) => request<{ deleted: string }>(`/api/stations/${id}`, { method: 'DELETE' }),
  passes: (id: string, group: string, hours = 48) =>
    request<{ passes: (PassInfo & { satellite_id: number })[] }>(
      `/api/stations/${id}/passes?group=${group}&hours=${hours}`,
    ),
}

export const gameApi = {
  bootstrap: () => request<BootstrapResp>('/api/game/bootstrap', { method: 'POST' }),
}

/** 批量位置：[[id, x, y, z], ...] */
export async function fetchPositions(group: string, atIso: string, ids?: number[]): Promise<{ t: number; items: [number, number, number, number][] }> {
  const idParam = ids && ids.length ? `&ids=${ids.join(',')}` : ''
  const resp = await fetch(`/api/satellites/positions?group=${encodeURIComponent(group)}&at=${encodeURIComponent(atIso)}${idParam}`)
  if (!resp.ok) throw new Error(`positions HTTP ${resp.status}`)
  return resp.json()
}
