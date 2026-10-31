/** 后端 API 客户端。开发环境经 vite 代理；打包后由后端同源伺服。 */

export interface HealthInfo {
  status: string
  app: string
  version: string
  time_utc: string
  python: string
  platform: string
}

export interface SatdumpInfo {
  installed: boolean
  version: string | null
  source: 'windows' | 'wsl' | null
  bin: string | null
  note: string
}

export interface Capabilities {
  app: { name: string; version: string; python: string; platform: string }
  satdump: SatdumpInfo
  disk: { free_gb: number; total_gb: number }
  orbit: {
    cache_dir: string
    cached_groups: string[]
    cache_ttl_hours: number
    configured_groups: string[]
  }
  frontend_built: boolean
  data_dir: string
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message)
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let resp: Response
  try {
    resp = await fetch(path, {
      headers: { 'Content-Type': 'application/json' },
      ...init,
    })
  } catch (e) {
    throw new ApiError(0, 'NETWORK', '无法连接后端服务 (127.0.0.1:8000)。请确认后端已启动。')
  }
  if (!resp.ok) {
    let code = 'HTTP_ERROR'
    let message = `HTTP ${resp.status}`
    try {
      const body = await resp.json()
      if (body?.error) {
        code = body.error.code ?? code
        message = body.error.message ?? message
      }
    } catch {
      /* 非 JSON 错误体 */
    }
    throw new ApiError(resp.status, code, message)
  }
  return resp.json() as Promise<T>
}

export const api = {
  health: () => request<HealthInfo>('/api/health'),
  capabilities: () => request<Capabilities>('/api/system/capabilities'),
}
