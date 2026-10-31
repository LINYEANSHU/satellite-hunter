import { useMemo } from 'react'
import { BufferGeometry, Float32BufferAttribute } from 'three'
import { useStationStore } from '../stores/stationStore'
import { latLonToVec3 } from './coords'

/** 地面站覆盖圈（以参考轨道高度 550km 计算的可见角半径） */
function footprintCircle(lat: number, lon: number, segments = 96): BufferGeometry {
  const RE = 6371
  const h = 550
  const angular = Math.acos(RE / (RE + h)) // 可见地心角半径 ≈ 22.6°
  const verts = new Float32Array((segments + 1) * 3)
  const latR = (lat * Math.PI) / 180
  const lonR = (lon * Math.PI) / 180
  for (let i = 0; i <= segments; i++) {
    const brg = (i / segments) * Math.PI * 2
    // 球面三角正解：给定起点、方位角、角距的目标点
    const lat2 = Math.asin(Math.sin(latR) * Math.cos(angular) + Math.cos(latR) * Math.sin(angular) * Math.cos(brg))
    const lon2 =
      lonR +
      Math.atan2(
        Math.sin(brg) * Math.sin(angular) * Math.cos(latR),
        Math.cos(angular) - Math.sin(latR) * Math.sin(lat2),
      )
    const v = latLonToVec3((lat2 * 180) / Math.PI, (lon2 * 180) / Math.PI, 1.004)
    verts[i * 3] = v.x
    verts[i * 3 + 1] = v.y
    verts[i * 3 + 2] = v.z
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute(verts, 3))
  return g
}

export default function StationLayer() {
  const stations = useStationStore((s) => s.stations)
  const activeId = useStationStore((s) => s.activeStationId)

  const markers = useMemo(
    () =>
      stations.map((st) => ({
        st,
        pos: latLonToVec3(st.lat, st.lon, 1.008),
        circleGeom: footprintCircle(st.lat, st.lon),
      })),
    [stations],
  )

  return (
    <group>
      {markers.map(({ st, pos, circleGeom }) => (
        <group key={st.id}>
          <group position={pos.toArray()}>
            {/* 天线标记：小四棱锥指向外 */}
            <mesh
              rotation={[Math.PI, 0, 0]}
              onPointerDown={(e) => {
                e.stopPropagation()
                useStationStore.getState().setActive(st.id)
              }}
            >
              <coneGeometry args={[0.018, 0.05, 4]} />
              <meshBasicMaterial color={st.id === activeId ? '#34d399' : '#94a3b8'} />
            </mesh>
            {/* 站杆：从地表到标记 */}
            <mesh position={[0, -0.02, 0]}>
              <cylinderGeometry args={[0.0015, 0.0015, 0.04, 6]} />
              <meshBasicMaterial color={st.id === activeId ? '#34d399' : '#64748b'} />
            </mesh>
          </group>
          <line>
            <primitive object={circleGeom} attach="geometry" />
            <lineBasicMaterial
              color={st.id === activeId ? '#34d399' : '#475569'}
              transparent
              opacity={st.id === activeId ? 0.7 : 0.35}
              depthWrite={false}
            />
          </line>
        </group>
      ))}
    </group>
  )
}
