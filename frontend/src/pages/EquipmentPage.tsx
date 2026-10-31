import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CATEGORY_LABELS, gameApi, type CatalogCategory } from '../api/game'
import PageHeader from '../components/PageHeader'
import { useGameStore } from '../stores/gameStore'

/** 设备管理：目录采购（需求 4.3/4.4）。 */
export default function EquipmentPage() {
  const nav = useNavigate()
  const saveId = useGameStore((s) => s.saveId)
  const credits = useGameStore((s) => s.credits)
  const [cats, setCats] = useState<CatalogCategory[]>([])
  const [meta, setMeta] = useState<Record<string, unknown>>({})
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    gameApi.catalog().then((c) => {
      setCats(c.categories)
      setMeta(c.meta)
    })
  }, [])

  const buy = async (catalogId: string, price: number) => {
    if (!saveId) return nav('/')
    setBusy(true)
    setMsg(null)
    try {
      await gameApi.buy(saveId, catalogId)
      setMsg(`已购买（₡${price}），可在地面站页面安装`)
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="h-full overflow-auto">
      <PageHeader
        title="设备管理"
        subtitle="设备目录采购 · 真实 RF 参数 + 游戏平衡数值分离"
        right={
          <>
            <span className="chip text-hud-amber border-hud-amber/40">₡ {Math.round(credits).toLocaleString()}</span>
            <button className="btn h-7 text-xs" onClick={() => nav('/station')}>
              前往安装 →
            </button>
          </>
        }
      />

      {msg && <div className="panel px-3 py-2 mb-3 text-xs text-hud-cyan max-w-2xl">{msg}</div>}
      {!saveId && <div className="panel p-4 mb-3 text-sm text-hud-dim">未进入存档——请先在主菜单进入。</div>}

      <div className="space-y-3 pb-6">
        {cats.map((cat) => (
          <section className="panel" key={cat.category}>
            <div className="panel-header">{CATEGORY_LABELS[cat.category] ?? cat.category}</div>
            <div className="grid grid-cols-3 gap-2 p-3">
              {cat.items.map((it) => (
                <div key={it.id} className="rounded border border-space-500/70 bg-space-800/50 p-3 flex flex-col" data-testid={`cat-${it.id}`}>
                  <div className="flex justify-between items-start">
                    <span className="text-slate-100 text-sm font-medium">{it.name}</span>
                    <span className={`chip ${(it.price ?? 0) === 0 ? '' : 'text-hud-amber border-hud-amber/40'}`}>
                      {(it.price ?? 0) === 0 ? '初始' : `₡${it.price}`}
                    </span>
                  </div>
                  <p className="text-[11px] text-hud-dim mt-1 leading-relaxed flex-1">{it.desc}</p>
                  <div className="mt-2 space-y-0.5 font-mono text-[10px] text-slate-400">
                    <SpecLine specs={it.specs} />
                  </div>
                  <button
                    className="btn btn-primary h-7 text-xs mt-2"
                    disabled={busy || !saveId}
                    onClick={() => void buy(it.id, it.price ?? 0)}
                    data-testid={`buy-${it.id}`}
                  >
                    采购
                  </button>
                </div>
              ))}
            </div>
          </section>
        ))}
        <div className="panel p-3 text-[10px] text-hud-dim leading-relaxed max-w-3xl">
          {typeof meta.说明 === 'string' ? meta.说明 : ''}
        </div>
      </div>
    </div>
  )
}

function SpecLine({ specs }: { specs: Record<string, unknown> }) {
  const entries = Object.entries(specs).filter(
    ([k]) => !['id', 'name', 'desc', 'price', 'category', 'polarization'].includes(k),
  )
  return (
    <>
      {entries.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-2">
          <span className="text-hud-dim">{SPEC_LABELS[k] ?? k}</span>
          <span>
            {Array.isArray(v) ? v.join('/') : String(v)}
          </span>
        </div>
      ))}
    </>
  )
}

const SPEC_LABELS: Record<string, string> = {
  gain_dbi: '增益 dBi',
  bands: '频段',
  directional: '定向',
  beamwidth_deg: '波束 °',
  requires_rotator: '需转台',
  freq_min_mhz: '频率下限 MHz',
  freq_max_mhz: '频率上限 MHz',
  sample_rate_msps: '采样率 Msps',
  noise_figure_db: '噪声系数 dB',
  max_bandwidth_khz: '带宽 kHz',
  gain_db: '增益 dB',
  passband_khz: '通带 kHz',
  insertion_loss_db: '插损 dB',
  center_mhz: '中心 MHz',
  az_range_deg: '方位范围 °',
  el_range_deg: '俯仰范围 °',
  max_speed_deg_s: '最大转速 °/s',
  pointing_accuracy_deg: '指向精度 °',
  concurrent_missions: '并发任务',
  processing_units: '处理能力',
  capacity_gb: '容量 GB',
}
