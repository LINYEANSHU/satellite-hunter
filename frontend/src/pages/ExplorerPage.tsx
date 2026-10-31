import PageHeader from '../components/PageHeader'
import WipBadge from '../components/WipBadge'

/** 3D 地球卫星探索（Phase 1 主战场）。 */
export default function ExplorerPage() {
  return (
    <div className="h-full flex flex-col">
      <PageHeader
        title="轨道探索"
        subtitle="3D 地球 · 真实卫星 · 过境预测"
        right={<WipBadge phase="Phase 1" />}
      />
      <div className="flex-1 panel flex items-center justify-center">
        <div className="text-center text-hud-dim">
          <div className="text-5xl mb-3">🌍</div>
          <p className="text-sm">3D 地球引擎将在 Phase 1 交付：</p>
          <ul className="mt-2 text-xs space-y-1 text-left inline-block list-disc">
            <li>CelesTrak GP 轨道数据 + SGP4 实时传播</li>
            <li>可拖拽/缩放的三维地球（昼夜、大气）</li>
            <li>卫星筛选、轨道线、地面投影轨迹</li>
            <li>地面站选址与过境预测（AOS/LOS）</li>
            <li>时间控制（1×/10×/100×/自定义）</li>
          </ul>
        </div>
      </div>
    </div>
  )
}
