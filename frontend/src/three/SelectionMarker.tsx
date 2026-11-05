import { useMemo, useRef } from 'react'
import { useThree } from '@react-three/fiber'
import { useFrameCallback } from './FrameDriver'
import { CanvasTexture, Group, Mesh } from 'three'
import { useCatalogStore } from '../stores/catalogStore'
import { ecefToScene } from './coords'
import { getInterpolatedEcef } from './OrbitPath'

/**
 * 选中卫星标记（精进阶段 F1）：脉冲圆环 + 名称标签。
 * - 圆环：RingGeometry billboard（每帧 quaternion 对齐相机，Three.js 常规做法），
 *   尺寸随时间正弦脉冲，始终贴在插值位置；
 * - 标签：Canvas 绘制文字 → CanvasTexture → Sprite（深度测试关闭，保证可读）。
 */
export default function SelectionMarker() {
  const selectedId = useCatalogStore((s) => s.selectedId)
  const satellites = useCatalogStore((s) => s.satellites)
  const camera = useThree((s) => s.camera)
  const groupRef = useRef<Group>(null)
  const ringRef = useRef<Mesh>(null)

  const sat = useMemo(
    () => (selectedId === null ? null : satellites.find((x) => x.norad_id === selectedId) ?? null),
    [selectedId, satellites],
  )

  const { texture, aspect } = useMemo(() => {
    // 无 DOM 环境保护（单测/SSR 不建纹理）
    if (typeof document === 'undefined') return { texture: null, aspect: 4 }
    const label = sat ? (sat.name.length > 22 ? sat.name.slice(0, 21) + '…' : sat.name) : ''
    const text = `${label} · ${selectedId ?? ''}`.trim()
    const canvas = document.createElement('canvas')
    canvas.width = 512
    canvas.height = 128
    const ctx = canvas.getContext('2d')
    if (!ctx) return { texture: null, aspect: 4 }
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = 'rgba(7,12,20,0.72)'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.strokeStyle = 'rgba(34,211,238,0.6)'
    ctx.lineWidth = 4
    ctx.strokeRect(2, 2, canvas.width - 4, canvas.height - 4)
    ctx.fillStyle = '#22d3ee'
    ctx.font = '600 52px ui-monospace, Consolas, monospace'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 2)
    return { texture: new CanvasTexture(canvas), aspect: canvas.width / canvas.height }
  }, [sat?.name, selectedId])

  useFrameCallback(() => {
    const g = groupRef.current
    if (!g || selectedId === null) return
    const pos = getInterpolatedEcef(selectedId)
    if (!pos) {
      g.visible = false
      return
    }
    g.visible = true
    const v = ecefToScene(pos[0], pos[1], pos[2])
    g.position.copy(v)
    if (ringRef.current) {
      // billboard：环面始终朝向相机；轻微脉冲
      ringRef.current.quaternion.copy(camera.quaternion)
      const pulse = 1 + 0.14 * Math.sin(performance.now() / 280)
      ringRef.current.scale.setScalar(pulse)
    }
  })

  if (selectedId === null) return null
  return (
    <group ref={groupRef} frustumCulled={false}>
      <mesh ref={ringRef}>
        <ringGeometry args={[0.045, 0.06, 40]} />
        <meshBasicMaterial color="#22d3ee" transparent opacity={0.9} depthWrite={false} side={2} />
      </mesh>
      {texture && (
        <sprite position={[0, 0.085, 0]} scale={[0.19 * aspect * 0.35, 0.19 * 0.35, 1]}>
          <spriteMaterial map={texture} transparent depthTest={false} />
        </sprite>
      )}
    </group>
  )
}
