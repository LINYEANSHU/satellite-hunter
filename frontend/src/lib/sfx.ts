/** 轻量 WebAudio 反馈音（可静音，localStorage 记忆）。无外部资源。 */
let ctx: AudioContext | null = null
let muted = localStorage.getItem('sh-sfx-muted') === '1'

export function sfxMuted() {
  return muted
}

export function sfxToggleMute() {
  muted = !muted
  localStorage.setItem('sh-sfx-muted', muted ? '1' : '0')
  return muted
}

function tone(freq: number, t0: number, dur: number, gain = 0.05, type: OscillatorType = 'sine') {
  const ac = ctx ?? new AudioContext()
  if (!ctx) ctx = ac
  const osc = ac.createOscillator()
  const g = ac.createGain()
  osc.type = type
  osc.frequency.value = freq
  g.gain.setValueAtTime(0, ac.currentTime + t0)
  g.gain.linearRampToValueAtTime(gain, ac.currentTime + t0 + 0.01)
  g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + t0 + dur)
  osc.connect(g).connect(ac.destination)
  osc.start(ac.currentTime + t0)
  osc.stop(ac.currentTime + t0 + dur + 0.05)
}

export const sfx = {
  taskComplete() {
    if (muted) return
    tone(660, 0, 0.12)
    tone(880, 0.12, 0.18)
  },
  taskFailed() {
    if (muted) return
    tone(220, 0, 0.2, 0.06, 'triangle')
    tone(165, 0.15, 0.25, 0.06, 'triangle')
  },
  achievement() {
    if (muted) return
    ;[523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.09, 0.16, 0.045))
  },
  click() {
    if (muted) return
    tone(880, 0, 0.03, 0.02, 'square')
  },
  fault() {
    if (muted) return
    tone(140, 0, 0.3, 0.05, 'sawtooth')
  },
}
