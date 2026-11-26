import { useEffect, useMemo, useRef, useState } from 'react'
import { useCatalogStore } from '../stores/catalogStore'
import { useLang, fmt } from '../i18n'

/** 左侧面板：分组切换 + 搜索 + 卫星列表。 */
export default function SatelliteList() {
  const {
    groups,
    currentGroup,
    satellites,
    total,
    stale,
    loading,
    refreshing,
    sourceInfo,
    error,
    search,
    selectedId,
    setGroup,
    setSearch,
    select,
    loadGroups,
    refreshGroup,
    startPolling,
    loadSatellites,
  } = useCatalogStore()
  const { t, lang } = useLang()

  const [searchInput, setSearchInput] = useState(search)
  const debounceRef = useRef<number | null>(null)

  useEffect(() => {
    void loadGroups()
    void loadSatellites()
    startPolling()
    const syncSources = () => {
      if (!document.hidden) void loadGroups(true)
    }
    const statusTimer = window.setInterval(syncSources, 30000)
    document.addEventListener('visibilitychange', syncSources)
    return () => {
      window.clearInterval(statusTimer)
      document.removeEventListener('visibilitychange', syncSources)
      useCatalogStore.getState().stopPolling()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => () => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current)
  }, [])

  const groupMeta = useMemo(
    () => Object.fromEntries(groups.map((g) => [g.group, g])),
    [groups],
  )
  const meta = groupMeta[currentGroup]
  const fetchedAt = sourceInfo?.fetched_at ?? meta?.fetched_at
  const epoch = sourceInfo?.newest_epoch ?? meta?.newest_epoch
  const source = sourceInfo?.source ?? meta?.source
  const bundled = sourceInfo?.bundled ?? meta?.bundled
  const localTimes = useMemo(() => {
    const clock = new Intl.DateTimeFormat(lang, { dateStyle: 'short', timeStyle: 'short' })
    const formatTime = (date: Date) => Number.isFinite(date.getTime()) ? clock.format(date) : '—'
    return {
      fetched: fetchedAt ? formatTime(new Date(fetchedAt * 1000)) : '—',
      epoch: epoch ? formatTime(new Date(/Z$|[+-]\d\d:\d\d$/.test(epoch) ? epoch : epoch + 'Z')) : '—',
    }
  }, [lang, fetchedAt, epoch])
  const groupLabel = (key: string, fallback: string) =>
    (t.groups as Record<string, string>)[key] ?? fallback

  const onSearchChange = (v: string) => {
    setSearchInput(v)
    if (debounceRef.current) window.clearTimeout(debounceRef.current)
    debounceRef.current = window.setTimeout(() => setSearch(v), 400)
  }

  return (
    <div className="panel flex flex-col h-full min-h-0" data-testid="satellite-list">
      <div className="panel-header">
        <span>{t.satList.title}</span>
        <span className="data normal-case tracking-normal">
          {fmt(t.satList.n, { n: total })}{' '}
          {(bundled || stale) && (
            <span className="text-warn" title={meta?.error || sourceInfo?.error || undefined}>
              · {bundled ? t.satList.bundled : t.satList.cached}
            </span>
          )}
        </span>
      </div>
      {/* 分组 */}
      <div className="flex flex-wrap gap-1 p-2 ">
        {groups.map((g) => (
          <button
            key={g.group}
            className={`chip cursor-pointer ${g.group === currentGroup ? 'text-signal border-signal/50' : 'hover:text-ink'}`}
            onClick={() => setGroup(g.group)}
            aria-pressed={g.group === currentGroup}
            title={fmt(t.satList.groupTip, {
              label: groupLabel(g.group, g.label),
              count: g.count ? fmt(t.satList.groupCount, { n: g.count }) : '',
              age: g.age_hours !== null ? fmt(t.satList.groupAge, { h: g.age_hours }) : '',
            })}
            data-testid={`group-${g.group}`}
          >
            {groupLabel(g.group, g.label)}
          </button>
        ))}
      </div>

      {/* 搜索 */}
      <div className="p-2 ">
        <input
          className="input"
          placeholder={t.satList.searchPh}
          aria-label={t.satList.searchPh}
          value={searchInput}
          onChange={(e) => onSearchChange(e.target.value)}
          data-testid="sat-search"
        />
        <div className="flex items-start justify-between gap-2 mt-2 text-xs text-ink-dim">
          <div data-testid="catalog-source" className="min-w-0 space-y-0.5">
            <div className="break-words">{source?.replace(' + local cache', t.satList.plusCache) ?? t.satList.notLoaded}</div>
            {fetchedAt != null && <div>{fmt(t.satList.fetched, { d: localTimes.fetched })}</div>}
            {epoch && <div>{fmt(t.satList.epoch, { d: localTimes.epoch })}</div>}
          </div>
          <button className="shrink-0 hover:text-signal disabled:opacity-50" onClick={() => void refreshGroup()}
            title={t.satList.refreshTitle} disabled={refreshing} aria-busy={refreshing}>
            {refreshing ? t.satList.refreshing : t.satList.refresh}
          </button>
        </div>
      </div>

      {error && <div className="px-2 py-1 text-[13px] text-danger">{error}</div>}

      {/* 列表 */}
      <div className="flex-1 overflow-y-auto min-h-0" data-testid="sat-items">
        {loading && <div className="p-3 text-xs text-ink-dim">{t.common.loading}</div>}
        {!loading && satellites.length === 0 && (
          <div className="p-3 text-xs text-ink-dim">{t.satList.noMatch}</div>
        )}
        {satellites.map((s) => (
          <button
            key={s.norad_id}
            className={`w-full text-left px-2.5 py-1.5  flex items-center justify-between gap-2 hover:bg-ground-2 transition-colors ${
              selectedId === s.norad_id ? 'bg-signal/10 border-l-2 border-l-signal' : ''
            }`}
            onClick={() => select(selectedId === s.norad_id ? null : s.norad_id)}
            data-testid={`sat-${s.norad_id}`}
          >
            <span className="text-[13px] text-ink truncate">{s.name || `NORAD ${s.norad_id}`}</span>
            <span className="data text-[13px] text-ink-dim shrink-0">{s.norad_id}</span>
          </button>
        ))}
        {total > satellites.length && (
          <div className="p-2 text-[13px] text-ink-dim text-center data">
            {fmt(t.satList.showing, { a: satellites.length, b: total })}
          </div>
        )}
      </div>
    </div>
  )
}
