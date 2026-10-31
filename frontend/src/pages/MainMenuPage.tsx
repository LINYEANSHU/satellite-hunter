import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, type Capabilities } from '../api/client'

/** 主菜单：存档管理在 Phase 2 接入后端；当前提供真实的连接检测与进入入口。 */
export default function MainMenuPage() {
  const nav = useNavigate()
  const [caps, setCaps] = useState<Capabilities | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api
      .capabilities()
      .then(setCaps)
      .catch((e) => setError(e.message))
  }, [])

  return (
    <div className="h-full flex flex-col items-center justify-center bg-[radial-gradient(ellipse_at_top,#0d1420_0%,#070b12_65%)]">
      <div className="text-center mb-10">
        <div className="text-6xl text-hud-cyan mb-4 animate-pulseSoft">◉</div>
        <h1 className="text-3xl font-semibold tracking-[0.25em] text-slate-100">SATELLITE HUNTER</h1>
        <p className="mt-2 text-hud-dim tracking-[0.4em] text-sm">GROUND STATION</p>
        <p className="mt-4 text-sm text-slate-400 max-w-xl mx-auto">
          从一台简易接收机开始，追踪真实卫星轨道，建设全球地面站网络，捕捉来自太空的信号。
        </p>
      </div>

      <div className="flex flex-col gap-3 w-72">
        <button
          className="btn btn-primary h-11 text-base"
          onClick={() => nav('/explorer')}
          data-testid="enter-explorer"
        >
          ▶ 进入轨道探索
        </button>
        <button className="btn h-10 opacity-60" disabled title="Phase 2 交付：多存档管理">
          存档管理（Phase 2）
        </button>
      </div>

      <div className="mt-10 panel px-4 py-3 w-96 text-xs font-mono text-hud-dim">
        <div className="flex justify-between py-0.5">
          <span>后端连接</span>
          <span className={error ? 'text-hud-red' : 'text-hud-green'}>
            {error ? 'FAIL' : 'OK'}
          </span>
        </div>
        <div className="flex justify-between py-0.5">
          <span>后端版本</span>
          <span className="text-slate-400">{caps?.app.version ?? '—'}</span>
        </div>
        <div className="flex justify-between py-0.5">
          <span>SatDump 解码</span>
          <span className={caps?.satdump.installed ? 'text-hud-green' : 'text-hud-amber'}>
            {caps ? (caps.satdump.installed ? `OK (${caps.satdump.source})` : '未安装') : '—'}
          </span>
        </div>
      </div>

      {error && <p className="mt-4 text-xs text-hud-red">{error}</p>}
    </div>
  )
}
