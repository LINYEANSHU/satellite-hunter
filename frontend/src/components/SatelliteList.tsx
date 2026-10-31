import { useEffect, useMemo, useRef, useState } from 'react'
import { useCatalogStore } from '../stores/catalogStore'

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

  const [searchInput, setSearchInput] = useState(search)
  const debounceRef = useRef<number | null>(null)

  useEffect(() => {
    void loadGroups()
    void loadSatellites()
    startPolling()
    return () => useCatalogStore.getState().stopPolling()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const groupMeta = useMemo(
    () => Object.fromEntries(groups.map((g) => [g.group, g])),
    [groups],
  )
  const meta = groupMeta[currentGroup]

  const onSearchChange = (v: string) => {
    setSearchInput(v)
    if (debounceRef.current) window.clearTimeout(debounceRef.current)
    debounceRef.current = window.setTimeout(() => setSearch(v), 400)
  }

  return (
    <div className="panel flex flex-col h-full min-h-0" data-testid="satellite-list">
      <div className="panel-header">
        <span>卫星目录</span>
        <span className="font-mono normal-case tracking-normal">
          {total} 颗 {stale && <span className="text-hud-amber" title={meta?.error ?? ''}>·缓存过期</span>}
        </span>
      </div>

      {/* 分组 */}
      <div className="flex flex-wrap gap-1 p-2 border-b border-space-600/50">
        {groups.map((g) => (
          <button
            key={g.group}
            className={`chip cursor-pointer ${g.group === currentGroup ? 'text-hud-cyan border-hud-cyan/50' : 'hover:text-slate-300'}`}
            onClick={() => setGroup(g.group)}
            title={`${g.label}${g.count ? ` · ${g.count} 颗` : ''}${g.age_hours !== null ? ` · 数据 ${g.age_hours}h 前` : ''}`}
            data-testid={`group-${g.group}`}
          >
            {g.label}
          </button>
        ))}
      </div>

      {/* 搜索 */}
      <div className="p-2 border-b border-space-600/50">
        <input
          className="input"
          placeholder="搜索名称或目录号…"
          value={searchInput}
          onChange={(e) => onSearchChange(e.target.value)}
          data-testid="sat-search"
        />
        <div className="flex items-center justify-between mt-1.5 text-[10px] text-hud-dim font-mono">
          <span>
            {meta
              ? `数据 ${meta.age_hours !== null ? `${meta.age_hours}h 前` : '未加载'} · 历元 ${meta.newest_epoch ? meta.newest_epoch.slice(0, 10) : '—'}`
              : ''}
          </span>
          <button className="hover:text-hud-cyan" onClick={() => void refreshGroup()} title="从 CelesTrak 强制刷新（受 2 小时限速约束）">
            ↻ 刷新
          </button>
        </div>
      </div>

      {error && <div className="px-2 py-1 text-[11px] text-hud-red">{error}</div>}

      {/* 列表 */}
      <div className="flex-1 overflow-y-auto min-h-0" data-testid="sat-items">
        {loading && <div className="p-3 text-xs text-hud-dim">加载中…</div>}
        {!loading && satellites.length === 0 && (
          <div className="p-3 text-xs text-hud-dim">无匹配卫星</div>
        )}
        {satellites.map((s) => (
          <button
            key={s.norad_id}
            className={`w-full text-left px-2.5 py-1.5 border-b border-space-700/40 flex items-center justify-between gap-2 hover:bg-space-700/40 transition-colors ${
              selectedId === s.norad_id ? 'bg-hud-cyan/10 border-l-2 border-l-hud-cyan' : ''
            }`}
            onClick={() => select(selectedId === s.norad_id ? null : s.norad_id)}
            data-testid={`sat-${s.norad_id}`}
          >
            <span className="text-[13px] text-slate-300 truncate">{s.name || `NORAD ${s.norad_id}`}</span>
            <span className="font-mono text-[10px] text-hud-dim shrink-0">{s.norad_id}</span>
          </button>
        ))}
        {total > satellites.length && (
          <div className="p-2 text-[10px] text-hud-dim text-center font-mono">
            显示前 {satellites.length} 颗 / 共 {total} 颗 · 使用搜索缩小范围
          </div>
        )}
      </div>
    </div>
  )
}
