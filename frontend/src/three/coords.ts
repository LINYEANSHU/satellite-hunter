import { Vector3 } from 'three'

/** 场景坐标约定：地球半径 R=1；ECEF x→x, y→-z, z→y（右手系一致）。 */

export const EARTH_R_KM = 6371.0
export const KM_TO_UNIT = 1.0 / EARTH_R_KM
const DEG2RAD = Math.PI / 180

/** 大地坐标 → 场景坐标（与 THREE.SphereGeometry 的等距圆柱贴图 UV 对齐） */
export function latLonToVec3(lat: number, lon: number, r: number): Vector3 {
  const phi = (90 - lat) * DEG2RAD
  const theta = (lon + 180) * DEG2RAD
  return new Vector3(
    -r * Math.sin(phi) * Math.cos(theta),
    r * Math.cos(phi),
    r * Math.sin(phi) * Math.sin(theta),
  )
}

/** ECEF(km) → 场景坐标 */
export function ecefToScene(x: number, y: number, z: number): Vector3 {
  return new Vector3(x * KM_TO_UNIT, z * KM_TO_UNIT, -y * KM_TO_UNIT)
}

/** 场景坐标 → 大地坐标（球面近似，用于地表拾取） */
export function sceneToLatLon(v: Vector3): { lat: number; lon: number } {
  const r = v.length()
  const lat = 90 - Math.acos(v.y / r) / DEG2RAD
  let lon = Math.atan2(v.z, -v.x) / DEG2RAD - 180
  while (lon < -180) lon += 360
  while (lon > 180) lon -= 360
  return { lat, lon }
}

/** 太阳方向（单位向量，场景坐标系）。简化星历：赤纬精度 ~0.5°，视觉足够。 */
export function sunDirection(simTimeMs: number): Vector3 {
  const d = new Date(simTimeMs)
  const start = Date.UTC(d.getUTCFullYear(), 0, 0)
  const dayOfYear = (simTimeMs - start) / 86400000
  // 太阳赤纬
  const decl = 23.44 * Math.sin(((2 * Math.PI) / 365) * (dayOfYear - 81))
  // 太阳直射经度：12:00 UTC → 0°，每小时西移 15°（忽略均时差 ≤4min）
  const utcHours = d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600
  const subsolarLon = -15 * (utcHours - 12)
  return latLonToVec3(decl, subsolarLon, 1).normalize()
}
