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

// ---------------------------------------------------------------- 信号实验室
export interface RecordingInfo {
  id: string
  save_id: string
  filename: string
  size_bytes: number
  format: string
  sample_rate_hz: number
  center_frequency_hz: number
  satellite_id: number | null
  source: string
  notes: string
  created_at: string | null
  samples?: number
  duration_s?: number | null
  error?: string
}

export const uploadRecording = async (
  saveId: string,
  file: File,
  meta: { format: string; sample_rate_hz: number; center_frequency_hz: number; satellite_id?: number | null; notes?: string },
): Promise<RecordingInfo> => {
  const fd = new FormData()
  fd.append('save_id', saveId)
  fd.append('file', file)
  fd.append('format', meta.format)
  fd.append('sample_rate_hz', String(meta.sample_rate_hz || 0))
  fd.append('center_frequency_hz', String(meta.center_frequency_hz || 0))
  if (meta.satellite_id) fd.append('satellite_id', String(meta.satellite_id))
  fd.append('notes', meta.notes ?? '')
  const resp = await fetch('/api/recordings/import', { method: 'POST', body: fd })
  if (!resp.ok) {
    const body = await resp.json().catch(() => null)
    throw new Error(body?.error?.message ?? `HTTP ${resp.status}`)
  }
  return resp.json()
}

export const signalApi = {
  detail: (id: string) => request<RecordingInfo>(`/api/recordings/${id}`),
  list: (saveId: string) => request<RecordingInfo[]>(`/api/recordings?save_id=${saveId}`),
  remove: (id: string) => request<{ deleted: string }>(`/api/recordings/${id}`, { method: 'DELETE' }),
  stats: (id: string, offset = 0, n = 65536) =>
    request<Record<string, number>>(`/api/recordings/${id}/stats?offset=${offset}&n=${n}`),
  spectrum: (id: string, offset = 0, n = 65536, fft = 1024, avg = 8) =>
    request<{ fft_size: number; db: number[]; freq_span_hz: number | null; center_frequency_hz: number }>(
      `/api/recordings/${id}/spectrum?offset=${offset}&n=${n}&fft=${fft}&avg=${avg}`,
    ),
  waterfall: (id: string, rows = 128, fft = 256, t0 = 0, t1 = 1) =>
    request<{ rows: number; fft_size: number; db: number[][]; db_min: number; db_max: number; freq_span_hz: number | null }>(
      `/api/recordings/${id}/waterfall?rows=${rows}&fft=${fft}&t0=${t0}&t1=${t1}`,
    ),
  constellation: (id: string, offset = 0, n = 2000) =>
    request<{ points: [number, number][] }>(`/api/recordings/${id}/constellation?offset=${offset}&n=${n}`),
  waveform: (id: string, offset = 0, n = 2000) =>
    request<{ i: number[]; q: number[] }>(`/api/recordings/${id}/waveform?offset=${offset}&n=${n}`),

  satdumpStatus: () =>
    request<{ installed: boolean; version: string | null; source: string | null; note: string; pipelines_count?: number; pipelines_note?: string }>(
      '/api/satdump/status',
    ),
  satdumpPipelines: () =>
    request<{ pipelines: { name: string; desc: string }[]; note: string }>('/api/satdump/pipelines', { method: 'POST' }),
  satdumpCreateJob: (body: {
    save_id: string
    recording_id: string
    pipeline: string
    samplerate?: number
    frequency?: number
    baseband_format?: string
    sat_name?: string
  }) => request<SatdumpJobView>('/api/satdump/jobs', { method: 'POST', body: JSON.stringify(body) }),
  satdumpJobs: (saveId: string) => request<SatdumpJobView[]>(`/api/satdump/jobs?save_id=${saveId}`),
  satdumpJob: (id: string) => request<SatdumpJobView>(`/api/satdump/jobs/${id}`),
  satdumpLog: (id: string) => request<{ log: string }>(`/api/satdump/jobs/${id}/log`),
  satdumpCancel: (id: string) => request<{ cancelled: boolean }>(`/api/satdump/jobs/${id}/cancel`, { method: 'POST' }),
  satdumpCollect: (id: string, body: { save_id: string; title: string; notes?: string; satellite_id?: number | null }) =>
    request<{ id: string }>(`/api/satdump/jobs/${id}/collect`, { method: 'POST', body: JSON.stringify(body) }),
}

export interface SatdumpJobView {
  id: string
  recording_id: string
  pipeline: string
  params: Record<string, unknown>
  status: string
  progress: number
  error: string
  result_files: { path: string; size: number }[]
  log_path: string | null
  output_dir: string | null
  created_at: string | null
}

// ---------------------------------------------------------------- Phase 4
export interface ScheduleSuggestion {
  satellite_id: number
  satellite_name: string
  aos: string
  los: string
  max_elevation_deg: number
  frequency_mhz: number
  reward_credits: number
  score: number
  new_satellite: boolean
}

export interface ResearchItem {
  id: string
  name: string
  desc: string
  cost_rp: number
  requires: string[]
  unlocked: boolean
}

export interface GameEventView {
  ts: number
  kind: string
  source: string
  [k: string]: unknown
}

export const phase4Api = {
  schedulePlan: (body: {
    save_id: string
    station_id: string
    hours?: number
    rules?: Record<string, number | string>
    apply?: boolean
    at?: string
  }) =>
    request<{ applied: boolean; created: number; suggestions: ScheduleSuggestion[] }>(
      '/api/game/scheduler/plan',
      { method: 'POST', body: JSON.stringify(body) },
    ),
  events: (saveId: string) => request<GameEventView[]>(`/api/game/events?save_id=${saveId}`),
  eventsCheck: (saveId: string, at?: string) =>
    request<{ fired: GameEventView[] }>('/api/game/events/check', {
      method: 'POST',
      body: JSON.stringify({ save_id: saveId, at }),
    }),
  repair: (equipmentId: string, saveId: string) =>
    request<{ repaired: string; cost: number }>(`/api/game/equipment/${equipmentId}/repair`, {
      method: 'POST',
      body: JSON.stringify({ save_id: saveId }),
    }),
  research: (saveId: string) =>
    request<{ items: ResearchItem[]; effects: Record<string, number> }>(`/api/game/research?save_id=${saveId}`),
  researchUnlock: (researchId: string, saveId: string) =>
    request<{ unlocked: string; cost_rp: number }>(`/api/game/research/${researchId}/unlock`, {
      method: 'POST',
      body: JSON.stringify({ save_id: saveId }),
    }),
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
