import { useMemo, useRef } from 'react'
import type { ThreeEvent } from '@react-three/fiber'
import { useFrameCallback } from './FrameDriver'
import { BufferAttribute, BufferGeometry, DynamicDrawUsage, Points, Sphere, Vector3 } from 'three'
import { useCatalogStore } from '../stores/catalogStore'
import { useTimeStore } from '../stores/gameStore'

/** 按类别的卫星点颜色 */
const GROUP_COLORS: Record<string, string> = {
  stations: '#fbbf24',
  weather: '#38bdf8',
  amateur: '#34d399',
  science: '#fbbf24',
  visual: '#e2e8f0',
  geo: '#f472b6',
  active: '#38bdf8',
  user_imported: '#fbbf24',
}

/**
 * 卫星点层：单 Points + 动态 BufferGeometry。
 * 每帧在最近两个服务端采样间插值（显示用），真实轨道始终由后端 SGP4 计算。
 */
export default function SatelliteLayer({ onPick }: { onPick?: (noradId: number | null) => void }) {
  const pointsRef = useRef<Points>(null)
  const geomRef = useRef<BufferGeometry>(null)
  const currentGroup = useCatalogStore((s) => s.currentGroup)
  const baseColor = GROUP_COLORS[currentGroup] ?? '#38bdf8'

  const MAX = 2500
  const { geometry, positionsAttr } = useMemo(() => {
    const geometry = new BufferGeometry()
    const positionsAttr = new BufferAttribute(new Float32Array(MAX * 3), 3)
    positionsAttr.setUsage(DynamicDrawUsage)
    geometry.setAttribute('position', positionsAttr)
    // 固定包围球（场景单位：地球半径=1，最大视距 14）：该层 frustumCulled=false，
    // 包围球只影响拾取的快速剔除；若不预置，three 每帧都会 computeBoundingSphere
    // （O(N)），2500 点 × 60fps 纯属浪费。
    geometry.boundingSphere = new Sphere(new Vector3(0, 0, 0), 100)
    return { geometry, positionsAttr }
  }, [])

  useFrameCallback(() => {
    const { samples } = useCatalogStore.getState()
    if (!geomRef.current || samples.length === 0) return
    const simT = useTimeStore.getState().now()

    const latest = samples[samples.length - 1]
    const prev = samples.length > 1 ? samples[0] : null
    const span = prev ? latest.t - prev.t : 0

    let i = 0
    for (const [id, p1] of latest.byId) {
      if (i >= MAX) break
      let x = p1[0]
      let y = p1[1]
      let z = p1[2]
      if (prev) {
        const p0 = prev.byId.get(id)
        if (p0 && span > 0) {
          const a = Math.min(1, Math.max(0, (simT - prev.t) / span))
          x = p0[0] + (p1[0] - p0[0]) * a
          y = p0[1] + (p1[1] - p0[1]) * a
          z = p0[2] + (p1[2] - p0[2]) * a
        }
      }
      // ECEF(km) → 场景：缩放 + 轴映射 (x, y, z)_ecef → (x, z, -y)
      positionsAttr.setXYZ(i, x / 6371.0, z / 6371.0, -y / 6371.0)
      i++
    }
    geometry.setDrawRange(0, i)
    positionsAttr.needsUpdate = true
  })

  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (!onPick) return
    e.stopPropagation()
    const idx = e.index ?? -1
    if (idx < 0) return onPick(null)
    // 从 drawRange 内的可见集合还原 norad id：重新遍历与渲染相同顺序
    const { samples } = useCatalogStore.getState()
    const latest = samples[samples.length - 1]
    if (!latest) return
    let i = 0
    for (const id of latest.byId.keys()) {
      if (i === idx) {
        onPick(id)
        return
      }
      i++
    }
  }

  return (
    <points
      ref={pointsRef}
      geometry={geometry}
      onPointerDown={handlePointerDown}
      frustumCulled={false}
    >
      <pointsMaterial
        size={0.022}
        sizeAttenuation
        vertexColors={false}
        color={baseColor}
        transparent
        opacity={0.9}
        depthWrite={false}
      />
    </points>
  )
}
