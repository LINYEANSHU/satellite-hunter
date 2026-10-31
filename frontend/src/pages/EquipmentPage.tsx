import PageHeader from '../components/PageHeader'
import WipBadge from '../components/WipBadge'

/** 设备管理（Phase 2）。 */
export default function EquipmentPage() {
  return (
    <div className="h-full flex flex-col">
      <PageHeader
        title="设备管理"
        subtitle="天线 · SDR · 放大器 · 滤波器 · 转台 · 计算机 · 存储"
        right={<WipBadge phase="Phase 2" />}
      />
      <div className="flex-1 panel flex items-center justify-center text-hud-dim text-sm">
        <div className="text-center">
          <div className="text-5xl mb-3">🔧</div>
          <p>设备购买 / 安装 / 升级 / 拆卸将在 Phase 2 交付。</p>
        </div>
      </div>
    </div>
  )
}
