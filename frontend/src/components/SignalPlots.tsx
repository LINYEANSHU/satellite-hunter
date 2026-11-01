import { useEffect, useRef } from 'react'

const GRID = '#1a2536'
const AXIS = '#5b6b82'
const CYAN = '#22d3ee'
const VIOLET = '#fbbf24'
const AMBER = '#fbbf24'

/** 功率谱折线图（dB） */
export function SpectrumPlot({
  db,
  freqSpanHz,
  centerHz,
}: {
  db: number[]
  freqSpanHz: number | null
  centerHz: number
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const cv = ref.current
    if (!cv || !db.length) return
    const ctx = cv.getContext('2d')!
    const W = cv.width
    const H = cv.height
    ctx.fillStyle = '#0a0f18'
    ctx.fillRect(0, 0, W, H)

    const padL = 44
    const padB = 22
    const lo = Math.min(...db) - 2
    const hi = Math.max(...db) + 2
    const x = (i: number) => padL + (i / (db.length - 1)) * (W - padL - 8)
    const y = (v: number) => 8 + (1 - (v - lo) / (hi - lo)) * (H - padB - 8)

    // 网格与 dB 轴
    ctx.strokeStyle = GRID
    ctx.fillStyle = AXIS
    ctx.font = '10px monospace'
    ctx.textAlign = 'right'
    for (let g = 0; g <= 4; g++) {
      const v = lo + ((hi - lo) * g) / 4
      ctx.beginPath()
      ctx.moveTo(padL, y(v))
      ctx.lineTo(W - 8, y(v))
      ctx.stroke()
      ctx.fillText(v.toFixed(0), padL - 4, y(v) + 3)
    }
    // 频率轴
    ctx.textAlign = 'center'
    if (freqSpanHz) {
      for (let g = 0; g <= 4; g++) {
        const frac = g / 4
        const f = centerHz + (frac - 0.5) * freqSpanHz
        ctx.beginPath()
        ctx.moveTo(padL + frac * (W - padL - 8), 8)
        ctx.lineTo(padL + frac * (W - padL - 8), H - padB)
        ctx.stroke()
        ctx.fillText(formatHz(f), padL + frac * (W - padL - 8), H - 6)
      }
    }

    ctx.strokeStyle = CYAN
    ctx.lineWidth = 1
    ctx.beginPath()
    db.forEach((v, i) => {
      const px = x(i)
      const py = y(v)
      if (i === 0) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    })
    ctx.stroke()
  }, [db, freqSpanHz, centerHz])
  return <canvas ref={ref} width={860} height={320} className="w-full h-auto" data-testid="spectrum-plot" />
}

/** 瀑布图（色映射） */
export function WaterfallPlot({
  db,
  dbMin,
  dbMax,
  freqSpanHz,
  centerHz,
}: {
  db: number[][]
  dbMin: number
  dbMax: number
  freqSpanHz: number | null
  centerHz: number
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const cv = ref.current
    if (!cv || !db.length) return
    const ctx = cv.getContext('2d')!
    const W = cv.width
    const H = cv.height
    const padL = 44
    const rows = db.length
    const cols = db[0].length

    // 画到离屏 imgdata
    const img = ctx.createImageData(cols, rows)
    const rng = Math.max(1e-6, dbMax - dbMin)
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const t = (db[r][c] - dbMin) / rng
        const [R, G, B] = colorMap(t)
        img.data[(r * cols + c) * 4] = R
        img.data[(r * cols + c) * 4 + 1] = G
        img.data[(r * cols + c) * 4 + 2] = B
        img.data[(r * cols + c) * 4 + 3] = 255
      }
    }
    // 离屏 → 拉伸到主画布
    const off = document.createElement('canvas')
    off.width = cols
    off.height = rows
    off.getContext('2d')!.putImageData(img, 0, 0)
    ctx.fillStyle = '#0a0f18'
    ctx.fillRect(0, 0, W, H)
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(off, padL, 8, W - padL - 8, H - 30)

    // 轴
    ctx.fillStyle = AXIS
    ctx.font = '10px monospace'
    ctx.textAlign = 'center'
    if (freqSpanHz) {
      for (let g = 0; g <= 4; g++) {
        const frac = g / 4
        ctx.fillText(formatHz(centerHz + (frac - 0.5) * freqSpanHz), padL + frac * (W - padL - 8), H - 6)
      }
    }
    ctx.save()
    ctx.translate(10, H / 2)
    ctx.rotate(-Math.PI / 2)
    ctx.textAlign = 'center'
    ctx.fillText('时间 →', 0, 0)
    ctx.restore()
  }, [db, dbMin, dbMax, freqSpanHz, centerHz])
  return <canvas ref={ref} width={860} height={320} className="w-full h-auto" data-testid="waterfall-plot" />
}

/** 频谱色映射（暗蓝→青→黄→白） */
function colorMap(t: number): [number, number, number] {
  t = Math.max(0, Math.min(1, t))
  if (t < 0.4) {
    const k = t / 0.4
    return [Math.round(10 + 20 * k), Math.round(20 + 60 * k), Math.round(60 + 140 * k)]
  }
  if (t < 0.75) {
    const k = (t - 0.4) / 0.35
    return [Math.round(30 + 200 * k), Math.round(80 + 180 * k), Math.round(200)]
  }
  const k = (t - 0.75) / 0.25
  return [Math.round(230 + 25 * k), Math.round(255), Math.round(200 + 55 * k)]
}

/** IQ 星座图 */
export function ConstellationPlot({ points }: { points: [number, number][] }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const ctx = cv.getContext('2d')!
    ctx.fillStyle = '#0a0f18'
    ctx.fillRect(0, 0, cv.width, cv.height)
    const c = cv.width / 2
    let maxAbs = 0.01
    for (const [i, q] of points) maxAbs = Math.max(maxAbs, Math.abs(i), Math.abs(q))
    const scale = (c - 12) / maxAbs

    ctx.strokeStyle = GRID
    ctx.beginPath()
    ctx.moveTo(8, c)
    ctx.lineTo(cv.width - 8, c)
    ctx.moveTo(c, 8)
    ctx.lineTo(c, cv.height - 8)
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(c, c, scale, 0, Math.PI * 2)
    ctx.stroke()

    ctx.fillStyle = VIOLET
    for (const [i, q] of points) {
      ctx.fillRect(c + i * scale - 1, c - q * scale - 1, 2, 2)
    }
    ctx.fillStyle = AXIS
    ctx.font = '10px monospace'
    ctx.fillText(`I/Q ±${maxAbs.toFixed(2)}`, c - 30, cv.height - 6)
  }, [points])
  return <canvas ref={ref} width={430} height={320} className="w-full h-auto" data-testid="constellation-plot" />
}

/** IQ 时域波形 */
export function WaveformPlot({ i, q }: { i: number[]; q: number[] }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const cv = ref.current
    if (!cv || !i.length) return
    const ctx = cv.getContext('2d')!
    ctx.fillStyle = '#0a0f18'
    ctx.fillRect(0, 0, cv.width, cv.height)
    const c = cv.height / 2
    let maxAbs = 0.01
    for (let k = 0; k < i.length; k++) maxAbs = Math.max(maxAbs, Math.abs(i[k]), Math.abs(q[k]))
    const sx = (cv.width - 16) / i.length
    const sy = (c - 10) / maxAbs

    ctx.strokeStyle = GRID
    ctx.beginPath()
    ctx.moveTo(8, c)
    ctx.lineTo(cv.width - 8, c)
    ctx.stroke()

    const trace = (arr: number[], color: string) => {
      ctx.strokeStyle = color
      ctx.beginPath()
      arr.forEach((v, k) => {
        const x = 8 + k * sx
        const y = c - v * sy
        if (k === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      })
      ctx.stroke()
    }
    trace(i, CYAN)
    trace(q, AMBER)
    ctx.fillStyle = AXIS
    ctx.font = '10px monospace'
    ctx.fillText('I', 12, 14)
    ctx.fillStyle = AMBER
    ctx.fillText('Q', 26, 14)
  }, [i, q])
  return <canvas ref={ref} width={430} height={320} className="w-full h-auto" data-testid="waveform-plot" />
}

function formatHz(f: number): string {
  const a = Math.abs(f)
  if (a >= 1e9) return (f / 1e9).toFixed(2) + 'G'
  if (a >= 1e6) return (f / 1e6).toFixed(2) + 'M'
  if (a >= 1e3) return (f / 1e3).toFixed(1) + 'k'
  return f.toFixed(0)
}
