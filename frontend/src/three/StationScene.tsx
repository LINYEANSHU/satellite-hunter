import { Suspense, useEffect, useMemo, useRef } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { Group } from 'three'
import { useCatalogStore } from '../stores/catalogStore'
import { getInterpolatedEcef } from './OrbitPath'
import { lookAngles } from '../lib/lookangles'
import type { EquipmentItem } from '../api/game'
import * as THREE from 'three'
import FrameDriver, { useFrameCallback } from './FrameDriver'

/**
 * 地面站 3D 场景（需求 4.2）：天线随设备档位变形、转台实时指向选中卫星、
 * 机房/状态屏/设备位。所有模型由图元构建（示意图语言，非照片拟真）。
 */

const GROUND = '#1c2432'
const METAL = '#7d8aa0'
const METAL_DARK = '#39424f'
const ACCENT = '#3fd6e8'

/** 转台组：az/el 实时跟踪选中卫星 */
function TrackingPedestal({ children }: { children: React.ReactNode }) {
  const azGroup = useRef<Group>(null)
  const elGroup = useRef<Group>(null)

  useFrameCallback(() => {
    const { selectedId } = useCatalogStore.getState()
    const st = (window as unknown as { __activeStation?: { lat: number; lon: number; alt_m?: number } }).__activeStation
    if (!azGroup.current || !elGroup.current || !st) return
    let targetAz = 0
    let targetEl = 20
    if (selectedId) {
      const ecef = getInterpolatedEcef(selectedId)
      if (ecef) {
        const la = lookAngles(st.lat, st.lon, (st.alt_m ?? 0) / 1000, ecef as [number, number, number])
        if (la.el > 0) {
          targetAz = la.az
          targetEl = Math.min(88, la.el)
        }
      }
    }
    // 平滑转向（角度环绕处理）
    const cur = azGroup.current.rotation.y
    let diff = ((-targetAz * Math.PI) / 180 - cur) % (Math.PI * 2)
    if (diff > Math.PI) diff -= Math.PI * 2
    if (diff < -Math.PI) diff += Math.PI * 2
    azGroup.current.rotation.y = cur + diff * 0.06
    elGroup.current.rotation.z = THREE.MathUtils.lerp(
      elGroup.current.rotation.z,
      (-targetEl * Math.PI) / 180,
      0.06,
    )
  })

  return (
    <group position={[0, 0.35, 0]}>
      {/* 方位轴基座 */}
      <mesh position={[0, 0.1, 0]}>
        <cylinderGeometry args={[0.42, 0.5, 0.22, 24]} />
        <meshStandardMaterial color={METAL_DARK} />
      </mesh>
      <group ref={azGroup} position={[0, 0.22, 0]}>
        <mesh>
          <cylinderGeometry args={[0.2, 0.24, 0.34, 16]} />
          <meshStandardMaterial color={METAL} metalness={0.6} roughness={0.4} />
        </mesh>
        <group ref={elGroup} position={[0, 0.3, 0]}>
          {children}
        </group>
      </group>
    </group>
  )
}

/** 天线：按设备目录档位变形 */
function AntennaModel({ catalogId }: { catalogId: string | undefined }) {
  if (!catalogId) {
    return (
      <mesh position={[0, 0.06, 0]}>
        <boxGeometry args={[0.5, 0.12, 0.5]} />
        <meshStandardMaterial color="#2a3240" />
      </mesh>
    )
  }
  if (catalogId === 'ant_whip') {
    return (
      <group>
        <mesh position={[0, 0.45, 0]}>
          <cylinderGeometry args={[0.012, 0.02, 0.9, 8]} />
          <meshStandardMaterial color={METAL} />
        </mesh>
        <mesh position={[0, 0.92, 0]}>
          <sphereGeometry args={[0.03, 8, 8]} />
          <meshStandardMaterial color={ACCENT} emissive={ACCENT} emissiveIntensity={0.6} />
        </mesh>
      </group>
    )
  }
  if (catalogId === 'ant_turnstile') {
    return (
      <group position={[0, 0.15, 0]}>
        {[0, Math.PI / 2].map((rot, i) => (
          <mesh key={i} rotation={[Math.PI / 2, 0, rot]}>
            <cylinderGeometry args={[0.012, 0.012, 1.1, 8]} />
            <meshStandardMaterial color={METAL} />
          </mesh>
        ))}
      </group>
    )
  }
  if (catalogId === 'ant_yagi_vhf' || catalogId === 'ant_yagi_uhf') {
    const n = catalogId === 'ant_yagi_uhf' ? 9 : 7
    return (
      <group position={[0, 0.12, 0]}>
        {/* 主梁 */}
        <mesh position={[0, 0.55, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.02, 0.02, 1.3, 8]} />
          <meshStandardMaterial color={METAL_DARK} />
        </mesh>
        {/* 振子 */}
        {Array.from({ length: n }).map((_, i) => (
          <mesh key={i} position={[-0.6 + (1.2 * i) / (n - 1), 0.55, 0]}>
            <boxGeometry args={[0.02, 0.02, 0.75 - Math.abs(i - 2) * 0.06]} />
            <meshStandardMaterial color={METAL} />
          </mesh>
        ))}
      </group>
    )
  }
  // 抛物面（S 波段等高端）
  return (
    <group position={[0, 0.25, 0]}>
      <mesh rotation={[0, 0, 0]}>
        <sphereGeometry args={[0.75, 24, 12, 0, Math.PI * 2, 0, 0.55]} />
        <meshStandardMaterial color="#c8d2df" side={THREE.DoubleSide} metalness={0.3} roughness={0.5} />
      </mesh>
      <mesh position={[0, 0.28, 0]}>
        <cylinderGeometry args={[0.015, 0.015, 0.55, 8]} />
        <meshStandardMaterial color={METAL_DARK} />
      </mesh>
      <mesh position={[0, 0.55, 0]}>
        <boxGeometry args={[0.08, 0.08, 0.08]} />
        <meshStandardMaterial color={ACCENT} emissive={ACCENT} emissiveIntensity={0.5} />
      </mesh>
    </group>
  )
}

function Scene({ equipment }: { equipment: Record<string, EquipmentItem | undefined> }) {
  const grid = useMemo(() => {
    const tex = new THREE.CanvasTexture(makeGridCanvas())
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping
    tex.repeat.set(8, 8)
    return tex
  }, [])

  return (
    <>
      <color attach="background" args={['#05070b']} />
      <ambientLight intensity={0.35} />
      <hemisphereLight intensity={0.9} groundColor="#141a24" />
      <directionalLight position={[6, 10, 4]} intensity={2.4} />
      <directionalLight position={[-4, 6, -6]} intensity={0.8} color="#7dd3fc" />
      {/* 地面 */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
        <planeGeometry args={[24, 24]} />
        <meshStandardMaterial map={grid} color={GROUND} />
      </mesh>
      {/* 场站地坪 */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 0]}>
        <circleGeometry args={[3.2, 48]} />
        <meshStandardMaterial color="#232c3b" />
      </mesh>

      <TrackingPedestal>
        <AntennaModel catalogId={equipment.antenna?.catalog_id} />
      </TrackingPedestal>

      {/* 机房 */}
      <group position={[-2.2, 0, 1.4]} rotation={[0, 0.5, 0]}>
        <mesh position={[0, 0.35, 0]}>
          <boxGeometry args={[1.4, 0.7, 1.0]} />
          <meshStandardMaterial color="#2a323f" />
        </mesh>
        <mesh position={[0, 0.71, 0]}>
          <boxGeometry args={[1.5, 0.05, 1.1]} />
          <meshStandardMaterial color="#1d242e" />
        </mesh>
        {/* 状态屏 */}
        <mesh position={[0, 0.42, -0.51]}>
          <planeGeometry args={[0.8, 0.32]} />
          <meshStandardMaterial color="#0b1420" emissive={ACCENT} emissiveIntensity={0.35} />
        </mesh>
      </group>

      {/* SDR / 计算机 / 存储：机房旁的设备架 */}
      <group position={[2.0, 0, 1.2]}>
        <mesh position={[0, 0.5, 0]}>
          <boxGeometry args={[0.7, 1.0, 0.6]} />
          <meshStandardMaterial color="#232b37" />
        </mesh>
        {[0.25, 0.5, 0.75].map((y, i) => {
          const has = i === 0 ? equipment.sdr : i === 1 ? equipment.computer : equipment.storage
          return (
            <mesh key={i} position={[0, y, 0.31]}>
              <planeGeometry args={[0.5, 0.16]} />
              <meshStandardMaterial
                color={has ? '#0d1a22' : '#12161d'}
                emissive={has ? ACCENT : '#000000'}
                emissiveIntensity={has ? 0.5 : 0}
              />
            </mesh>
          )
        })}
      </group>

      {/* 天线馈线：从转台到机房 */}
      <mesh position={[-1.1, 0.03, 0.7]} rotation={[0, 0.6, 0]}>
        <boxGeometry args={[2.3, 0.02, 0.06]} />
        <meshStandardMaterial color={METAL_DARK} />
      </mesh>

      <OrbitControls
        target={[0, 0.6, 0]}
        minDistance={2.2}
        maxDistance={12}
        maxPolarAngle={Math.PI / 2.05}
        enableDamping
        dampingFactor={0.08}
      />
    </>
  )
}

function makeGridCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#10151d'
  ctx.fillRect(0, 0, 128, 128)
  ctx.strokeStyle = '#1c2431'
  ctx.lineWidth = 2
  ctx.strokeRect(0, 0, 128, 128)
  return c
}

/** 导出：给场景传当前活动站坐标（避免 prop 链穿 useFrame） */
export function setSceneStation(st: { lat: number; lon: number; alt_m: number } | null) {
  ;(window as unknown as { __activeStation?: { lat: number; lon: number; alt_m: number } }).__activeStation =
    st ?? undefined
}

export default function StationScene({ equipment }: { equipment: Record<string, EquipmentItem | undefined> }) {
  // R3F 初始测量竞态兜底（同 GlobeScene）
  useEffect(() => {
    const t1 = window.setTimeout(() => window.dispatchEvent(new Event('resize')), 80)
    const t2 = window.setTimeout(() => window.dispatchEvent(new Event('resize')), 450)
    return () => {
      window.clearTimeout(t1)
      window.clearTimeout(t2)
    }
  }, [])
  return (
    <Canvas
      camera={{ position: [4.2, 2.6, 4.6], fov: 42, near: 0.05, far: 100 }}
      frameloop="never"
      dpr={[1, 2]}
      gl={{ antialias: true, preserveDrawingBuffer: true }}
      onCreated={({ scene, gl }) => {
        ;(window as unknown as { __threeDebug: unknown }).__threeDebug = {
          children: scene.children.map((c) => ({ type: c.type, name: c.name, visible: c.visible, pos: c.position.toArray() })),
          info: gl.info.render,
        }
      }}
      data-testid="station-scene"
    >
      <Suspense fallback={null}>
        <FrameDriver hz={20} />
        <Scene equipment={equipment} />
      </Suspense>
    </Canvas>
  )
}
// touch 1793499467
