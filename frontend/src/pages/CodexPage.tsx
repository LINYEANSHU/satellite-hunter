import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { gameApi, type CollectionEntryView } from '../api/game'
import PageHeader from '../components/PageHeader'
import Icon from '../components/Icon'
import { useGameStore } from '../stores/gameStore'
import { useLang, fmt } from '../i18n'

const CATEGORY_KEYS = ['space_station', 'weather', 'communications', 'science', 'amateur', 'other'] as const

const STATUS_BADGE_CLS: Record<string, string> = {
  tracked: 'text-signal border-signal/40',
  received: 'text-ok border-ok/40',
  decoded: 'text-signal border-signal/40',
}

/** 卫星图鉴（需求 7.1/7.2）：分类、发现状态、收藏。 */
export default function CodexPage() {
  const nav = useNavigate()
  const saveId = useGameStore((s) => s.saveId)
  const [entries, setEntries] = useState<CollectionEntryView[]>([])
  const [filter, setFilter] = useState('')
  const [onlyFav, setOnlyFav] = useState(false)
  const { t } = useLang()

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

  const catLabel = (key: string, fallback?: string) =>
    (t.codex.cats as Record<string, string>)[key] ?? fallback ?? key
  const statusLabel = (key: string) =>
    key === 'received' ? t.codex.received : key === 'decoded' ? t.codex.decoded : t.codex.tracked

  if (!saveId) {
    return (
      <div className="h-full panel flex items-center justify-center text-sm text-ink-dim">
        {t.missions.noSave}
        <button className="btn ml-3" onClick={() => nav('/')}>
          {t.missions.backMenu}
        </button>
      </div>
    )
  }

  return (
    <div className="h-full overflow-auto">
      <div className="panel overflow-hidden relative mb-3 h-28 shrink-0">
        <img
          src="/photos/sts-134-international-space-station-after-undocking.jpg"
          alt={t.codex.heroAlt}
          className="absolute inset-0 w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-ground-0/50 flex items-end">
          <div className="px-4 pb-2.5">
            <div className="text-title font-semibold text-ink">{t.codex.title}</div>
            <div className="text-[12px] text-ink/90">
              {fmt(t.codex.summary, {
                n: entries.length,
                r: entries.filter((e) => e.status !== 'tracked').length,
              })}
            </div>
          </div>
        </div>
      </div>
      <PageHeader
        title={t.codex.section}
        subtitle={t.codex.subtitle}
        right={
          <>
            <button className={`chip cursor-pointer ${onlyFav ? 'text-warn border-warn/50' : ''}`} onClick={() => setOnlyFav(!onlyFav)}>
              {t.codex.onlyFav}
            </button>
            <select className="input !w-36" value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="">{t.codex.allCats}</option>
              {CATEGORY_KEYS.map((k) => (
                <option key={k} value={k}>
                  {catLabel(k)}
                </option>
              ))}
            </select>
          </>
        }
      />

      {entries.length === 0 && (
        <div className="panel p-6 text-sm text-ink-dim text-center">{t.codex.empty}</div>
      )}

      <div className="space-y-4 pb-6">
        {Object.entries(grouped).map(([cat, list]) => (
          <section key={cat}>
            <h3 className="text-xs text-ink-dim uppercase tracking-[0.2em] mb-2">
              {catLabel(cat)} · {list.length}
            </h3>
            <div className="grid grid-cols-4 gap-2">
              {list.map((e) => {
                const cls = STATUS_BADGE_CLS[e.status] ?? STATUS_BADGE_CLS.tracked
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
                        title={e.favorite ? t.codex.favRemove : t.codex.favAdd}
                      >
                        <Icon name="star" size={14} />
                      </button>
                    </div>
                    <div className="data text-[12px] text-ink-dim mt-1">#{e.satellite_id}</div>
                    <div className="flex items-center gap-1.5 mt-2">
                      <span className={`chip ${cls}`}>{statusLabel(e.status)}</span>
                      {e.successful_missions > 0 && (
                        <span className="chip text-signal">{fmt(t.codex.success, { n: e.successful_missions })}</span>
                      )}
                    </div>
                    {e.first_observed_at && (
                      <div className="text-[12px] text-ink-dim mt-1.5 data">
                        {fmt(t.codex.firstObs, { date: new Date(e.first_observed_at).toLocaleDateString() })}
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
