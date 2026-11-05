import type { Capabilities } from '../api/client'
import { useGameStore } from '../stores/gameStore'
import { useLang } from '../i18n'

/** 顶栏右侧：后端连接、SatDump、存档资源。 */
export default function StatusBar({
  caps,
  backendDown,
}: {
  caps: Capabilities | null
  backendDown: boolean
}) {
  const { credits, researchPoints, level, saveName } = useGameStore()
  const { t } = useLang()
  return (
    <div className="flex items-center gap-4 text-[12px] text-ink-dim">
      <span className={`inline-flex items-center gap-1.5 ${backendDown ? 'text-danger' : 'text-ok'}`}>
        <span className={`status-dot ${backendDown ? 'bg-danger' : 'bg-ok'}`} />
        {backendDown ? t.topbar.offline : t.topbar.online}
      </span>
      {caps && (
        <span
          title={caps.satdump.note || t.topbar.satdumpAvailable}
          className={`inline-flex items-center gap-1 ${caps.satdump.installed ? 'text-ok' : 'text-warn'}`}
        >
          SatDump {caps.satdump.installed ? (caps.satdump.version ?? '') : t.topbar.satdumpMissing}
        </span>
      )}
      {saveName && (
        <>
          <span className="text-warn data" title={t.topbar.creditsTitle}>
            ₡{Math.round(credits).toLocaleString()}
          </span>
          <span className="data" title={t.topbar.rpTitle}>RP {Math.round(researchPoints)}</span>
          <span title={t.topbar.levelTitle}>Lv.{level}</span>
        </>
      )}
    </div>
  )
}
