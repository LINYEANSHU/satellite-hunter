import PageHeader from '../components/PageHeader'
import WipBadge from '../components/WipBadge'

/** 卫星图鉴（Phase 2）。 */
export default function CodexPage() {
  return (
    <div className="h-full flex flex-col">
      <PageHeader
        title="卫星图鉴"
        subtitle="分类收藏 · 发现记录 · 数据收藏"
        right={<WipBadge phase="Phase 2" />}
      />
      <div className="flex-1 panel flex items-center justify-center text-hud-dim text-sm">
        <div className="text-center">
          <div className="text-5xl mb-3">📖</div>
          <p>卫星图鉴与数据收藏将在 Phase 2 交付。</p>
        </div>
      </div>
    </div>
  )
}
