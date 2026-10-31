import PageHeader from '../components/PageHeader'
import WipBadge from '../components/WipBadge'

/** 信号分析实验室（Phase 3）。 */
export default function SignalLabPage() {
  return (
    <div className="h-full flex flex-col">
      <PageHeader
        title="信号实验室"
        subtitle="频谱 · 瀑布图 · IQ 分析 · SatDump 解码"
        right={<WipBadge phase="Phase 3" />}
      />
      <div className="flex-1 panel flex items-center justify-center text-hud-dim text-sm">
        <div className="text-center">
          <div className="text-5xl mb-3">📈</div>
          <p>IQ 导入、频谱/瀑布图与 SatDump 离线解码将在 Phase 3 交付。</p>
        </div>
      </div>
    </div>
  )
}
