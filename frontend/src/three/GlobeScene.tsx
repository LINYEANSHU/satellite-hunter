import { Suspense, useCallback } from 'react'
import { Canvas, type ThreeEvent } from '@react-three/fiber'
import { MapControls } from '@react-three/drei'
import Earth from './Earth'
import SatelliteLayer from './SatelliteLayer'
import OrbitPath from './OrbitPath'
import StationLayer from './StationLayer'
import { sceneToLatLon } from './coords'
import { useCatalogStore } from '../stores/catalogStore'
import { useStationStore } from '../stores/stationStore'

/** 地球主交互区：拖拽旋转、滚轮缩放、点选卫星、放置地面站。 */
export default function GlobeScene() {
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
      gl={{ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true }}
      dpr={[1, 2]}
      data-testid="globe-canvas"
    >
      <color attach="background" args={['#04070d']} />
      <ambientLight intensity={0.4} />
      <directionalLight position={[5, 3, 5]} intensity={1.2} />

      <Suspense fallback={null}>
        <Earth onPointerDown={handleEarthPointer} />
        <SatelliteLayer onPick={handleSatPick} />
        <OrbitPath />
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
