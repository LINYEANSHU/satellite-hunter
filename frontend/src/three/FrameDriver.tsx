import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'

/**
 * 混合帧驱动：替代 R3F 内置 rAF 循环（frameloop="never"）。
 *
 * rAF 可用（正常前台浏览器）→ 60fps 全速渲染；
 * rAF 被节流/暂停（遮挡标签页、某些嵌入环境）→ 自动降级为 setInterval 渲染，
 * 保证场景永不黑屏。渲染回调通过 useFrameCallback 注册。
 */
const callbacks = new Set<() => void>()

export function useFrameCallback(cb: () => void) {
  useEffect(() => {
    callbacks.add(cb)
    return () => {
      callbacks.delete(cb)
    }
  })
}

export default function FrameDriver({ hz = 20 }: { hz?: number }) {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)

  useEffect(() => {
    let raf = 0
    let rafFired = false
    let unmounted = false

    const tick = () => {
      if (unmounted) return
      callbacks.forEach((fn) => {
        try {
          fn()
        } catch (e) {
          // 单个回调失败不阻塞渲染
        }
      })
      gl.render(scene, camera)
    }

    const loop = () => {
      if (unmounted) return
      rafFired = true
      tick()
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)

    // rAF 节流检测：一个间隔内 rAF 没触发 → 手动 tick
    const iv = window.setInterval(() => {
      if (!rafFired) tick()
      rafFired = false
    }, 1000 / hz)

    return () => {
      unmounted = true
      cancelAnimationFrame(raf)
      window.clearInterval(iv)
    }
  }, [gl, scene, camera, hz])

  return null
}
