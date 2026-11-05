import { useMemo, useRef } from 'react'
import { useFrameCallback } from './FrameDriver'
import {
  BufferAttribute,
  BufferGeometry,
  DynamicDrawUsage,
  Line,
  LineBasicMaterial,
} from 'three'
import { useCatalogStore } from '../stores/catalogStore'
import { useTimeStore } from '../stores/gameStore'
import { ecefToScene } from './coords'
import { getInterpolatedEcef } from './OrbitPath'

const MAX_POINTS = 120
/** 尾迹采样间隔（仿真时间毫秒）：1× 时每 30s 一点（≈1 小时尾迹），加速时按比例缩短实时间隔 */
const TRAIL_STEP_MS = 30_000
const HEAD_COLOR = { r: 0.13, g: 0.83, b: 0.93 } // #22d3ee 尾迹头部（当前时刻）
const TAIL_COLOR = { r: 0.09, g: 0.2, b: 0.3 } // 接近背景的暗青（视觉渐隐）

/**
 * 选中卫星轨迹尾迹（精进阶段 F1）。
 * 常规 Three.js 做法：命令式 Line（动态 BufferGeometry + 顶点颜色渐隐），
 * 经 <primitive> 挂入场景（避开 JSX <line> 与 SVG DOM 类型冲突）。
 * 每帧从与 SatelliteLayer 相同的插值逻辑取当前显示位置，按仿真时间步长采样。
 * 暂停时仿真时间不推进 → 尾迹静止；时间倒流/大跳转时清空重建。
 */
export default function TrailLayer() {
  const selectedId = useCatalogStore((s) => s.selectedId)
  const currentId = useRef<number | null>(null)
  const trail = useRef<{ simT: number; pos: [number, number, number] }[]>([])
  const lastSimT = useRef(-Infinity)

  const lineObj = useMemo(() => {
    const geometry = new BufferGeometry()
    const pos = new BufferAttribute(new Float32Array(MAX_POINTS * 3), 3)
    const col = new BufferAttribute(new Float32Array(MAX_POINTS * 3), 3)
    pos.setUsage(DynamicDrawUsage)
    col.setUsage(DynamicDrawUsage)
    geometry.setAttribute('position', pos)
    geometry.setAttribute('color', col)
    geometry.setDrawRange(0, 0)
    const material = new LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false })
    const line = new Line(geometry, material)
    line.frustumCulled = false
    return line
  }, [])

  useFrameCallback(() => {
    const geom = lineObj.geometry
    const simT = useTimeStore.getState().now()

    // 换选中目标 / 时间倒流或大跳转 → 清空尾迹
    if (selectedId !== currentId.current || simT < lastSimT.current - 1500) {
      trail.current = []
      currentId.current = selectedId
      lastSimT.current = simT
      geom.setDrawRange(0, 0)
    }
    if (selectedId === null) return

    const pos = getInterpolatedEcef(selectedId)
    if (!pos) {
      geom.setDrawRange(0, 0)
      return
    }
    const last = trail.current[trail.current.length - 1]
    if (!last || simT - last.simT >= TRAIL_STEP_MS) {
      trail.current.push({ simT, pos })
      if (trail.current.length > MAX_POINTS) trail.current.shift()
      lastSimT.current = simT

      const posAttr = geom.getAttribute('position') as BufferAttribute
      const colAttr = geom.getAttribute('color') as BufferAttribute
      const n = trail.current.length
      for (let i = 0; i < n; i++) {
        const p = ecefToScene(trail.current[i].pos[0], trail.current[i].pos[1], trail.current[i].pos[2])
        posAttr.setXYZ(i, p.x, p.y, p.z)
        // 越旧越暗（线性渐隐）
        const a = n <= 1 ? 1 : i / (n - 1)
        colAttr.setXYZ(
          i,
          TAIL_COLOR.r + (HEAD_COLOR.r - TAIL_COLOR.r) * a,
          TAIL_COLOR.g + (HEAD_COLOR.g - TAIL_COLOR.g) * a,
          TAIL_COLOR.b + (HEAD_COLOR.b - TAIL_COLOR.b) * a,
        )
      }
      posAttr.needsUpdate = true
      colAttr.needsUpdate = true
      geom.setDrawRange(0, n)
    }
  })

  if (selectedId === null) return null
  return <primitive object={lineObj} />
}
