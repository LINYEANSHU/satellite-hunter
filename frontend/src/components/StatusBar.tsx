import type { Capabilities } from '../api/client'
import { useGameStore } from '../stores/gameStore'

/** 顶栏右侧状态灯：后端连接、SatDump 可用性、存档资源。 */
export default function StatusBar({
  caps,
  backendDown,
}: {
  caps: Capabilities | null
  backendDown: boolean
}) {
  const { credits, researchPoints, level, saveName } = useGameStore()
  return (
    <div className="flex items-center gap-3 text-[10px] font-mono text-hud-dim">
      <span
        title={backendDown ? '后端未连接' : '后端在线'}
        className={`inline-flex items-center gap-1 ${backendDown ? 'text-hud-red' : 'text-hud-green'}`}
      >
        <span className={`w-1.5 h-1.5 rounded-full ${backendDown ? 'bg-hud-red' : 'bg-hud-green animate-pulseSoft'}`} />
        {backendDown ? 'OFFLINE' : 'ONLINE'}
      </span>
      {caps && (
        <span
          title={caps.satdump.note || 'SatDump 可用'}
          className={caps.satdump.installed ? 'text-hud-green' : 'text-hud-amber'}
        >
          SATDUMP {caps.satdump.installed ? (caps.satdump.version ?? 'OK') : 'N/A'}
        </span>
      )}
      {saveName && (
        <>
          <span className="text-hud-amber" title="Credits">₡{Math.round(credits).toLocaleString()}</span>
          <span title="研究点数">RP {Math.round(researchPoints)}</span>
          <span title="等级">Lv.{level}</span>
        </>
      )}
    </div>
  )
}
