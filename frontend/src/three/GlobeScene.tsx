import { Suspense, useCallback, useEffect } from 'react'
import { Canvas, type ThreeEvent } from '@react-three/fiber'
import { MapControls } from '@react-three/drei'
import Earth from './Earth'
import SatelliteLayer from './SatelliteLayer'
import OrbitPath from './OrbitPath'
import StationLayer from './StationLayer'
import FrameDriver from './FrameDriver'
import TrailLayer from './TrailLayer'
import SelectionMarker from './SelectionMarker'
import { sceneToLatLon } from './coords'
import { useCatalogStore } from '../stores/catalogStore'
import { useStationStore } from '../stores/stationStore'

/** 地球主交互区：拖拽旋转、滚轮缩放、点选卫星、放置地面站。 */
export default function GlobeScene() {
  // R3F 初始测量偶发竞态（StrictMode 下画布保持 300×150）：挂载后补发一次 resize
  useEffect(() => {
    const t = window.setTimeout(() => window.dispatchEvent(new Event('resize')), 80)
    const t2 = window.setTimeout(() => window.dispatchEvent(new Event('resize')), 400)
    return () => {
      window.clearTimeout(t)
      window.clearTimeout(t2)
    }
  }, [])

  const handleEarthPointer = useCallback((e: ThreeEvent<PointerEvent>) => {
    const { placementMode } = useStationStore.getState()
    if (!placementMode) return
    e.stopPropagation()
    const { lat, lon } = sceneToLatLon(e.point.clone())
    window.dispatchEvent(new CustomEvent('sh:place-station', { detail: { lat, lon } }))
  }, [])

  const handleSatPick = useCallback((id: number | null) => {
    const store = useCatalogStore.getState()
    if (id === null) return
    store.select(id === store.selectedId ? null : id)
  }, [])

  return (
    <Canvas
      camera={{ position: [0, 1.6, 3.2], fov: 45, near: 0.01, far: 100 }}
      frameloop="never"
      gl={{ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true }}
      dpr={[1, 2]}
      data-testid="globe-canvas"
    >
      <color attach="background" args={['#04070d']} />
      <ambientLight intensity={0.4} />
      <directionalLight position={[5, 3, 5]} intensity={1.2} />

      <Suspense fallback={null}>
        <FrameDriver hz={30} />
        <Earth onPointerDown={handleEarthPointer} />
        <SatelliteLayer onPick={handleSatPick} />
        <OrbitPath />
        <TrailLayer />
        <SelectionMarker />
        <StationLayer />
      </Suspense>

      <MapControls
        enablePan={false}
        minDistance={1.15}
        maxDistance={14}
        rotateSpeed={0.45}
        zoomSpeed={0.8}
        enableDamping
        dampingFactor={0.08}
      />
    </Canvas>
  )
}
