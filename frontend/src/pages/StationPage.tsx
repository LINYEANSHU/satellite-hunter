import PageHeader from '../components/PageHeader'
import WipBadge from '../components/WipBadge'

/** 地面站建设场景（Phase 2：3D 站景 + 设备槽位）。 */
export default function StationPage() {
  return (
    <div className="h-full flex flex-col">
      <PageHeader
        title="地面站"
        subtitle="站址管理 · 3D 场景 · 设备槽位"
        right={<WipBadge phase="Phase 2" />}
      />
      <div className="flex-1 panel flex items-center justify-center text-hud-dim text-sm">
        <div className="text-center">
          <div className="text-5xl mb-3">📡</div>
          <p>地面站建设与 3D 场景将在 Phase 2 交付。</p>
          <p className="text-xs mt-2">选址工具（地图点击）将随 Phase 1 的 3D 地球先行提供。</p>
        </div>
      </div>
    </div>
  )
}
