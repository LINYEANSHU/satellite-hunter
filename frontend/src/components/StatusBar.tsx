import type { Capabilities } from '../api/client'

/** 顶栏右侧状态灯：后端连接、SatDump 可用性、磁盘。 */
export default function StatusBar({
  caps,
  backendDown,
}: {
  caps: Capabilities | null
  backendDown: boolean
}) {
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
        <>
          <span
            title={caps.satdump.note || 'SatDump 可用'}
            className={caps.satdump.installed ? 'text-hud-green' : 'text-hud-amber'}
          >
            SATDUMP {caps.satdump.installed ? (caps.satdump.version ?? 'OK') : 'N/A'}
          </span>
          <span title="磁盘剩余空间">DISK {caps.disk.free_gb}G</span>
        </>
      )}
    </div>
  )
}
