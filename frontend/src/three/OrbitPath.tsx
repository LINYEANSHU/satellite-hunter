import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrameCallback } from './FrameDriver'
import { BufferGeometry, Float32BufferAttribute, Mesh } from 'three'
import { orbitApi, type TrackPoint } from '../api/orbit'
import { useCatalogStore } from '../stores/catalogStore'
import { useTimeStore } from '../stores/gameStore'
import { ecefToScene } from './coords'

/** 选中卫星：轨道线、地面投影、当前位置标记。 */
export default function OrbitPath() {
  const selectedId = useCatalogStore((s) => s.selectedId)
  const [points, setPoints] = useState<TrackPoint[]>([])
  const [center, setCenter] = useState(0)
  const markerRef = useRef<Mesh>(null)

  useEffect(() => {
    if (!selectedId) {
      setPoints([])
      return
    }
    const simT = useTimeStore.getState().now()
    orbitApi
      .track(selectedId, 95, 30, new Date(simT).toISOString())
      .then((r) => {
        setPoints(r.points)
        setCenter(simT)
      })
      .catch(() => setPoints([]))
  }, [selectedId])

  // 时间跳远后刷新轨道线
  useFrameCallback(() => {
    if (selectedId && points.length && Math.abs(useTimeStore.getState().now() - center) > 40 * 60 * 1000) {
      const sid = selectedId
      const simT = useTimeStore.getState().now()
      orbitApi
        .track(sid, 95, 30, new Date(simT).toISOString())
        .then((r) => {
          setPoints(r.points)
          setCenter(simT)
        })
        .catch(() => {})
    }
    // 位置标记跟随插值位置
    if (markerRef.current && selectedId !== null) {
      const pos = getInterpolatedEcef(selectedId)
      if (pos) {
        const v = ecefToScene(pos[0], pos[1], pos[2])
        markerRef.current.position.copy(v)
        markerRef.current.visible = true
      } else {
        markerRef.current.visible = false
      }
    }
  })

  const orbitGeom = useMemo(() => {
    if (!points.length) return null
    const verts = new Float32Array(points.length * 3)
    points.forEach((p, i) => {
      const v = ecefToScene(p.ecef_km[0], p.ecef_km[1], p.ecef_km[2])
      verts[i * 3] = v.x
      verts[i * 3 + 1] = v.y
      verts[i * 3 + 2] = v.z
    })
    const g = new BufferGeometry()
    g.setAttribute('position', new Float32BufferAttribute(verts, 3))
    return g
  }, [points])

  const trackGeom = useMemo(() => {
    if (!points.length) return null
    const verts = new Float32Array(points.length * 3)
    points.forEach((p, i) => {
      const v = ecefToScene(p.ecef_km[0], p.ecef_km[1], p.ecef_km[2])
      v.normalize().multiplyScalar(1.002)
      verts[i * 3] = v.x
      verts[i * 3 + 1] = v.y
      verts[i * 3 + 2] = v.z
    })
    const g = new BufferGeometry()
    g.setAttribute('position', new Float32BufferAttribute(verts, 3))
    return g
  }, [points])

  if (!selectedId) return null

  return (
    <group>
      {orbitGeom && (
        <line>
          <primitive object={orbitGeom} attach="geometry" />
          <lineBasicMaterial color="#22d3ee" transparent opacity={0.55} depthWrite={false} />
        </line>
      )}
      {trackGeom && (
        <line>
          <primitive object={trackGeom} attach="geometry" />
          <lineBasicMaterial color="#fbbf24" transparent opacity={0.8} depthWrite={false} />
        </line>
      )}
      {/* 当前位置标记 */}
      <mesh ref={markerRef}>
        <sphereGeometry args={[0.014, 12, 12]} />
        <meshBasicMaterial color="#f8fafc" />
      </mesh>
    </group>
  )
}

/** 与 SatelliteLayer 相同的插值逻辑，取选中卫星当前显示位置 */
export function getInterpolatedEcef(noradId: number): [number, number, number] | null {
  const { samples } = useCatalogStore.getState()
  if (!samples.length) return null
  const latest = samples[samples.length - 1]
  const prev = samples.length > 1 ? samples[0] : null
  const p1 = latest.byId.get(noradId)
  if (!p1) return null
  if (!prev) return p1
  const p0 = prev.byId.get(noradId)
  if (!p0) return p1
  const span = latest.t - prev.t
  const a = span > 0 ? Math.min(1, Math.max(0, (useTimeStore.getState().now() - prev.t) / span)) : 1
  return [p0[0] + (p1[0] - p0[0]) * a, p0[1] + (p1[1] - p0[1]) * a, p0[2] + (p1[2] - p0[2]) * a]
}
