import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { gameApi, type CollectionEntryView } from '../api/game'
import PageHeader from '../components/PageHeader'
import Icon from '../components/Icon'
import { useGameStore } from '../stores/gameStore'

const CATEGORY_LABELS: Record<string, string> = {
  space_station: '空间站',
  weather: '气象卫星',
  communications: '通信卫星',
  science: '科学实验卫星',
  amateur: '业余无线电卫星',
  other: '其他航天器',
}

const STATUS_BADGES: Record<string, { label: string; cls: string }> = {
  tracked: { label: '已追踪', cls: 'text-signal border-signal/40' },
  received: { label: '已接收', cls: 'text-ok border-ok/40' },
  decoded: { label: '已解码', cls: 'text-signal border-signal/40' },
}

/** 卫星图鉴（需求 7.1/7.2）：分类、发现状态、收藏。 */
export default function CodexPage() {
  const nav = useNavigate()
  const saveId = useGameStore((s) => s.saveId)
  const [entries, setEntries] = useState<CollectionEntryView[]>([])
  const [filter, setFilter] = useState('')
  const [onlyFav, setOnlyFav] = useState(false)

  const reload = useCallback(async () => {
    if (!saveId) return
    setEntries(await gameApi.collection(saveId))
  }, [saveId])

  useEffect(() => {
    void reload()
  }, [reload])

  const grouped = useMemo(() => {
    let list = entries
    if (filter) list = list.filter((e) => e.category === filter)
    if (onlyFav) list = list.filter((e) => e.favorite)
    const g: Record<string, CollectionEntryView[]> = {}
    for (const e of list) (g[e.category] ??= []).push(e)
    return g
  }, [entries, filter, onlyFav])

  if (!saveId) {
    return (
      <div className="h-full panel flex items-center justify-center text-sm text-ink-dim">
        未进入存档
        <button className="btn ml-3" onClick={() => nav('/')}>
          返回主菜单
        </button>
      </div>
    )
  }

  return (
    <div className="h-full overflow-auto">
      <div className="panel overflow-hidden relative mb-3 h-28 shrink-0">
        <img
          src="/photos/sts-134-international-space-station-after-undocking.jpg"
          alt="国际空间站实拍（NASA STS-134 任务）"
          className="absolute inset-0 w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-ground-0/50 flex items-end">
          <div className="px-4 pb-2.5">
            <div className="text-title font-semibold text-ink">卫星图鉴</div>
            <div className="text-[12px] text-ink/90">
              发现 {entries.length} 颗 · 已接收 {entries.filter((e) => e.status !== 'tracked').length} 颗 ·
              页首影像：ISS（NASA，公有领域）
            </div>
          </div>
        </div>
      </div>
      <PageHeader
        title="收藏分类"
        subtitle="状态流转：已追踪 → 已接收 → 已解码"
        right={
          <>
            <button className={`chip cursor-pointer ${onlyFav ? 'text-warn border-warn/50' : ''}`} onClick={() => setOnlyFav(!onlyFav)}>
              只看收藏
            </button>
            <select className="input !w-36" value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="">全部类别</option>
              {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </>
        }
      />

      {entries.length === 0 && (
        <div className="panel p-6 text-sm text-ink-dim text-center">
          图鉴还是空的。在轨道探索页选择卫星或创建任务后，发现的卫星会记录在这里。
        </div>
      )}

      <div className="space-y-4 pb-6">
        {Object.entries(grouped).map(([cat, list]) => (
          <section key={cat}>
            <h3 className="text-xs text-ink-dim uppercase tracking-[0.2em] mb-2">
              {CATEGORY_LABELS[cat] ?? cat} · {list.length}
            </h3>
            <div className="grid grid-cols-4 gap-2">
              {list.map((e) => {
                const badge = STATUS_BADGES[e.status] ?? STATUS_BADGES.tracked
                return (
                  <div
                    key={e.satellite_id}
                    className="panel p-3 text-xs"
                    data-testid={`codex-${e.satellite_id}`}
                  >
                    <div className="flex justify-between items-start gap-1">
                      <span className="text-ink text-[13px] leading-tight">{e.satellite_name || `NORAD ${e.satellite_id}`}</span>
                      <button
                        className={`text-sm leading-none ${e.favorite ? 'text-warn' : 'text-space-500 hover:text-warn'}`}
                        onClick={async () => {
                          await gameApi.favorite(e.satellite_id, saveId)
                          void reload()
                        }}
                        title={e.favorite ? '取消收藏' : '收藏'}
                      >
                        <Icon name="star" size={14} />
                      </button>
                    </div>
                    <div className="data text-[12px] text-ink-dim mt-1">#{e.satellite_id}</div>
                    <div className="flex items-center gap-1.5 mt-2">
                      <span className={`chip ${badge.cls}`}>{badge.label}</span>
                      {e.successful_missions > 0 && (
                        <span className="chip text-signal">{e.successful_missions} 次成功</span>
                      )}
                    </div>
                    {e.first_observed_at && (
                      <div className="text-[12px] text-ink-dim mt-1.5 data">
                        首次观测 {new Date(e.first_observed_at).toLocaleDateString()}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
