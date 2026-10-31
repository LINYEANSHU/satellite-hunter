import PageHeader from '../components/PageHeader'
import WipBadge from '../components/WipBadge'

/** 任务控制中心（Phase 2）。 */
export default function MissionControlPage() {
  return (
    <div className="h-full flex flex-col">
      <PageHeader
        title="任务控制中心"
        subtitle="任务日历 · 过境规划 · 任务执行"
        right={<WipBadge phase="Phase 2" />}
      />
      <div className="flex-1 panel flex items-center justify-center text-hud-dim text-sm">
        <div className="text-center">
          <div className="text-5xl mb-3">🗺</div>
          <p>任务创建、规划与执行将在 Phase 2 交付。</p>
          <p className="text-xs mt-2">Phase 1 将先提供过境预测数据（AOS/LOS/最大仰角）。</p>
        </div>
      </div>
    </div>
  )
}
