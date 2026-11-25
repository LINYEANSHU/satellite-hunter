import { request } from './client'

export type SolarKind = 'planet' | 'asteroid' | 'comet'
export type SolarVector = [x: number, y: number, z: number]

export interface SolarBody {
  id: string
  name: string
  name_zh?: string
  kind: SolarKind
  designation?: string
  epoch_jd_tdb?: number
  perihelion_au?: number
  eccentricity?: number
}

export interface SolarCatalog {
  items: SolarBody[]
  total: number
  counts: Record<SolarKind, number>
  retrieved_at?: string
}

export interface SolarTrajectory {
  object: SolarBody
  at: string
  frame: string
  center: string
  position_au: SolarVector
  path_au: SolarVector[]
  distance_au: number
  epoch_jd_tdb: number
  method: 'planetary-fit' | 'osculating-two-body'
  source_url: string
  period_days: number | null
  span_days: number
}

export const solarApi = {
  catalog(kind: SolarKind | '', query: string, offset: number, limit: number, signal?: AbortSignal) {
    const params = new URLSearchParams({ kind, q: query.trim(), offset: String(offset), limit: String(limit) })
    return request<SolarCatalog>('/api/solar/catalog?' + params, { signal })
  },
  trajectory(id: string, at: string, days?: number, signal?: AbortSignal) {
    const params = new URLSearchParams({ at, points: '240' })
    if (days !== undefined) params.set('days', String(days))
    return request<SolarTrajectory>('/api/solar/trajectory/' + encodeURIComponent(id) + '?' + params, { signal })
  },
  lookup(designation: string) {
    return request<SolarBody>('/api/solar/lookup', {
      method: 'POST',
      body: JSON.stringify({ designation: designation.trim() }),
    })
  },
}
