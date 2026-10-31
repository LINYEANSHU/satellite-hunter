import PageHeader from '../components/PageHeader'
import WipBadge from '../components/WipBadge'

/** 成就与研究（Phase 2）。 */
export default function AchievementsPage() {
  return (
    <div className="h-full flex flex-col">
      <PageHeader
        title="成就与研究"
        subtitle="成就解锁 · 研究点数 · 科技路线"
        right={<WipBadge phase="Phase 2" />}
      />
      <div className="flex-1 panel flex items-center justify-center text-hud-dim text-sm">
        <div className="text-center">
          <div className="text-5xl mb-3">🏆</div>
          <p>成就系统（≥30 项，事件驱动）与研究系统将在 Phase 2 交付。</p>
        </div>
      </div>
    </div>
  )
}
