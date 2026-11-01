import { useMemo, useRef } from 'react'
import type { ThreeEvent } from '@react-three/fiber'
import { useFrameCallback } from './FrameDriver'
import { AdditiveBlending, BackSide, ShaderMaterial, TextureLoader, Vector3 } from 'three'
import { sunDirection } from './coords'
import { useTimeStore } from '../stores/gameStore'

const DAY_TEX = '/textures/earth-blue-marble.jpg'
const NIGHT_TEX = '/textures/earth-night.jpg'
const BUMP_TEX = '/textures/earth-topology.png'

const earthVert = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorldNormal;
  varying vec3 vViewDir;
  void main() {
    vUv = uv;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vViewDir = normalize(cameraPosition - worldPos.xyz);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const earthFrag = /* glsl */ `
  uniform sampler2D dayTex;
  uniform sampler2D nightTex;
  uniform vec3 sunDir;
  varying vec2 vUv;
  varying vec3 vWorldNormal;
  varying vec3 vViewDir;
  void main() {
    vec3 n = normalize(vWorldNormal);
    float sunDot = dot(n, sunDir);
    float dayMix = smoothstep(-0.10, 0.15, sunDot);

    vec3 day = texture2D(dayTex, vUv).rgb;
    vec3 night = texture2D(nightTex, vUv).rgb;

    // 白昼面随光照角度变暗，夜面显示城市灯光
    vec3 color = mix(night * 1.5 + day * 0.06, day * (0.25 + 0.95 * clamp(sunDot, 0.0, 1.0)), dayMix);

    // 大气边缘光（Fresnel），昼侧更亮
    float fres = pow(1.0 - clamp(dot(normalize(vViewDir), n), 0.0, 1.0), 2.5);
    color += vec3(0.25, 0.45, 0.85) * fres * (0.25 + 0.55 * dayMix);

    gl_FragColor = vec4(color, 1.0);
  }
`

const atmoVert = earthVert

const atmoFrag = /* glsl */ `
  uniform vec3 sunDir;
  varying vec3 vWorldNormal;
  varying vec3 vViewDir;
  void main() {
    vec3 n = normalize(-vWorldNormal); // 背面渲染，法线取反
    float sunDot = dot(n, sunDir);
    float dayMix = smoothstep(-0.3, 0.3, sunDot);
    float fres = pow(1.0 - clamp(dot(normalize(vViewDir), n), 0.0, 1.0), 3.0);
    vec3 col = vec3(0.3, 0.55, 1.0) * fres * (0.15 + 0.85 * dayMix);
    gl_FragColor = vec4(col, fres * (0.25 + 0.5 * dayMix));
  }
`

export default function Earth({ onPointerDown }: { onPointerDown?: (e: ThreeEvent<PointerEvent>) => void }) {
  const earthMat = useRef<ShaderMaterial>(null)
  const atmoMat = useRef<ShaderMaterial>(null)
  const sun = useMemo(() => new Vector3(1, 0, 0), [])

  const textures = useMemo(() => {
    const loader = new TextureLoader()
    return {
      day: loader.load(DAY_TEX),
      night: loader.load(NIGHT_TEX),
      bump: loader.load(BUMP_TEX),
    }
  }, [])

  const uniforms = useMemo(
    () => ({
      dayTex: { value: textures.day },
      nightTex: { value: textures.night },
      bumpTex: { value: textures.bump },
      sunDir: { value: sun },
    }),
    [textures, sun],
  )

  const atmoUniforms = useMemo(() => ({ sunDir: { value: sun } }), [sun])

  // 太阳方向随仿真时间更新（低频即可）
  const lastSunUpdate = useRef(0)
  useFrameCallback(() => {
    const now = performance.now()
    if (now - lastSunUpdate.current < 500) return
    lastSunUpdate.current = now
    sun.copy(sunDirection(useTimeStore.getState().now()))
  })

  return (
    <group>
      <mesh onPointerDown={onPointerDown}>
        <sphereGeometry args={[1, 96, 96]} />
        <shaderMaterial
          ref={earthMat}
          vertexShader={earthVert}
          fragmentShader={earthFrag}
          uniforms={uniforms}
        />
      </mesh>
      {/* 大气层：背面渲染的外壳 */}
      <mesh scale={1.025}>
        <sphereGeometry args={[1, 64, 64]} />
        <shaderMaterial
          ref={atmoMat}
          vertexShader={atmoVert}
          fragmentShader={atmoFrag}
          uniforms={atmoUniforms}
          transparent
          side={BackSide}
          depthWrite={false}
          blending={AdditiveBlending}
        />
      </mesh>
    </group>
  )
}
