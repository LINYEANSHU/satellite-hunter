import type { Capabilities } from '../api/client'
import { useGameStore } from '../stores/gameStore'

/** 顶栏右侧：后端连接、SatDump、存档资源。 */
export default function StatusBar({
  caps,
  backendDown,
}: {
  caps: Capabilities | null
  backendDown: boolean
}) {
  const { credits, researchPoints, level, saveName } = useGameStore()
  return (
    <div className="flex items-center gap-4 text-[12px] text-ink-dim">
      <span className={`inline-flex items-center gap-1.5 ${backendDown ? 'text-danger' : 'text-ok'}`}>
        <span className={`status-dot ${backendDown ? 'bg-danger' : 'bg-ok'}`} />
        {backendDown ? '离线' : '在线'}
      </span>
      {caps && (
        <span
          title={caps.satdump.note || 'SatDump 可用'}
          className={`inline-flex items-center gap-1 ${caps.satdump.installed ? 'text-ok' : 'text-warn'}`}
        >
          SatDump {caps.satdump.installed ? (caps.satdump.version ?? '') : '未安装'}
        </span>
      )}
      {saveName && (
        <>
          <span className="text-warn data" title="Credits">
            ₡{Math.round(credits).toLocaleString()}
          </span>
          <span className="data" title="研究点数">RP {Math.round(researchPoints)}</span>
          <span title="等级">Lv.{level}</span>
        </>
      )}
    </div>
  )
}
