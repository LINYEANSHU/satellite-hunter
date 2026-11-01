/** 浏览器端站心观察角计算（WGS84，与后端 transforms.py 同一算法）。 */
const WGS84_A = 6378.137
const WGS84_E2 = (1 / 298.257223563) * (2 - 1 / 298.257223563)
const DEG = Math.PI / 180

export function geodeticToEcef(latDeg: number, lonDeg: number, altKm: number): [number, number, number] {
  const lat = latDeg * DEG
  const lon = lonDeg * DEG
  const n = WGS84_A / Math.sqrt(1 - WGS84_E2 * Math.sin(lat) ** 2)
  return [
    (n + altKm) * Math.cos(lat) * Math.cos(lon),
    (n + altKm) * Math.cos(lat) * Math.sin(lon),
    (n * (1 - WGS84_E2) + altKm) * Math.sin(lat),
  ]
}

/** 站心观察角：方位角(0=北)、仰角、距离 km */
export function lookAngles(
  stationLat: number,
  stationLon: number,
  stationAltKm: number,
  ecef: [number, number, number],
): { az: number; el: number; range: number } {
  const [sx, sy, sz] = geodeticToEcef(stationLat, stationLon, stationAltKm)
  const dx = ecef[0] - sx
  const dy = ecef[1] - sy
  const dz = ecef[2] - sz
  const lat = stationLat * DEG
  const lon = stationLon * DEG
  // ENU 分量
  const e = -Math.sin(lon) * dx + Math.cos(lon) * dy
  const n =
    -Math.sin(lat) * Math.cos(lon) * dx - Math.sin(lat) * Math.sin(lon) * dy + Math.cos(lat) * dz
  const u = Math.cos(lat) * Math.cos(lon) * dx + Math.cos(lat) * Math.sin(lon) * dy + Math.sin(lat) * dz
  const range = Math.sqrt(e * e + n * n + u * u)
  const az = ((Math.atan2(e, n) / DEG) + 360) % 360
  const el = Math.asin(Math.max(-1, Math.min(1, u / Math.max(range, 1e-9)))) / DEG
  return { az, el, range }
}
