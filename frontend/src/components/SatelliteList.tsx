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
  const { t } = useLang()

  const [searchInput, setSearchInput] = useState(search)
  const debounceRef = useRef<number | null>(null)

  useEffect(() => {
    void loadGroups()
    void loadSatellites()
    startPolling()
    return () => useCatalogStore.getState().stopPolling()
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
          {stale && (
            <span className="text-warn" title={meta?.error ?? ''}>
              {t.satList.stale}
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
        <div className="flex items-center justify-between mt-1.5 text-[13px] text-ink-dim data">
          <span>
            {meta
              ? `${meta.age_hours !== null ? fmt(t.satList.dataAge, { h: meta.age_hours }) : t.satList.notLoaded} · ${fmt(t.satList.epoch, { d: meta.newest_epoch ? meta.newest_epoch.slice(0, 10) : '—' })}`
              : ''}
          </span>
          <button className="hover:text-signal" onClick={() => void refreshGroup()} title={t.satList.refreshTitle}>
            {t.satList.refresh}
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
