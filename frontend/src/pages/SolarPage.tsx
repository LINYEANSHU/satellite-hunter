import { useEffect, useId, useState, type FormEvent } from 'react'
import { ApiError } from '../api/client'
import { solarApi, type SolarBody, type SolarCatalog, type SolarKind, type SolarTrajectory } from '../api/solar'
import Icon from '../components/Icon'
import PageHeader from '../components/PageHeader'
import { useLang, type Lang } from '../i18n'

const COPY = {
  en: {
    heading: 'Solar System', subtitle: 'Explore heliocentric trajectories from public JPL orbital elements.',
    catalog: 'Object catalog', kind: 'Object type', all: 'All objects',
    kinds: { planet: 'Planet', asteroid: 'Asteroid', comet: 'Comet' },
    search: 'Name or designation', previous: 'Previous', next: 'Next',
    loadingCatalog: 'Loading catalog…', noMatches: 'No objects match. Try a name or an exact designation.',
    catalogFailed: 'Could not load the local catalog.', retry: 'Retry',
    snapshot: 'Catalog snapshot', lookup: 'Look up and save a JPL object', designation: 'Exact JPL designation',
    find: 'Look up', looking: 'Looking up…', saved: 'Saved to the local catalog.',
    lookupFailed: 'JPL lookup failed. Try an exact designation again later.',
    lookupMissing: 'JPL did not find a unique match. Enter an exact designation.',
    lookupInvalid: 'Enter an exact designation without wildcards.',
    lookupRate: 'Wait a moment before trying another lookup.',
    trajectory: 'Heliocentric trajectory', choose: 'Select an object to view its trajectory.',
    loadingTrajectory: 'Computing trajectory…', trajectoryFailed: 'Could not load this trajectory.',
    at: 'Date and time (UTC)', now: 'Use current UTC', days: 'Window (days)', auto: 'Auto',
    update: 'Update trajectory', dateRange: 'Use a UTC date between 1800 and 2050.',
    spanRange: 'Enter a window between 1 and 73,050 days, or leave it blank for Auto.',
    sun: 'Sun', marker: 'Position at selected time', path: 'Sampled trajectory',
    frame: 'J2000 mean ecliptic · XY projection', vectors: 'Heliocentric position',
    distance: 'Distance from Sun', period: 'Estimated orbital period', openOrbit: 'Open trajectory',
    window: 'Sampled window', epoch: 'Elements epoch (JD TDB)', perihelion: 'Perihelion', eccentricity: 'Eccentricity',
    dayUnit: 'days', provenance: 'JPL data and method',
    planetModel: 'JPL approximate planetary elements', smallModel: 'JPL osculating elements · two-body propagation',
    planetDetail: 'Planetary positions use a fitted series of orbital elements.',
    smallDetail: 'The model propagates the published elements under the gravity of the Sun alone. Accuracy depends on time from the elements epoch.',
  },
  zh: {
    heading: '太阳系', subtitle: '使用 JPL 公开轨道要素探索日心轨迹。',
    catalog: '天体目录', kind: '天体类型', all: '全部天体',
    kinds: { planet: '行星', asteroid: '小行星', comet: '彗星' },
    search: '名称或编号', previous: '上一页', next: '下一页',
    loadingCatalog: '正在加载目录…', noMatches: '没有匹配的天体。可尝试输入名称或精确编号。',
    catalogFailed: '无法加载本地目录。', retry: '重试',
    snapshot: '目录快照', lookup: '查询并保存 JPL 天体', designation: 'JPL 精确编号',
    find: '查询', looking: '正在查询…', saved: '已保存到本地目录。',
    lookupFailed: 'JPL 查询失败。请稍后再用精确编号尝试。',
    lookupMissing: 'JPL 未找到唯一匹配。请输入精确编号。',
    lookupInvalid: '请输入精确编号，避免使用通配符。',
    lookupRate: '请稍候再查询另一个天体。',
    trajectory: '日心轨迹', choose: '选择一个天体以查看轨迹。',
    loadingTrajectory: '正在计算轨迹…', trajectoryFailed: '无法加载此天体的轨迹。',
    at: '日期与时间（UTC）', now: '使用当前 UTC', days: '时间窗（天）', auto: '自动',
    update: '更新轨迹', dateRange: '请选择 1800 至 2050 年之间的 UTC 日期。',
    spanRange: '请输入 1 至 73,050 天的时间窗，或留空使用自动范围。',
    sun: '太阳', marker: '所选时刻的位置', path: '采样轨迹',
    frame: 'J2000 平黄道坐标系 · XY 投影', vectors: '日心位置',
    distance: '距太阳距离', period: '估计公转周期', openOrbit: '开放轨迹',
    window: '采样时间窗', epoch: '轨道要素历元（JD TDB）', perihelion: '近日距', eccentricity: '偏心率',
    dayUnit: '天', provenance: 'JPL 数据和方法',
    planetModel: 'JPL 行星近似轨道要素', smallModel: 'JPL 密切轨道要素 · 二体传播',
    planetDetail: '行星位置由随时间变化的拟合轨道要素计算。',
    smallDetail: '小天体轨迹以太阳为唯一引力源，从公开轨道要素传播。精度受计算时刻和要素历元的时间差影响。',
  },
}

type Copy = (typeof COPY)[Lang]
type Result<T> = { status: 'loading' } | { status: 'error'; error: unknown } | { status: 'ready'; data: T }
type Epoch = { at: string; days?: number }
const PAGE_SIZE = 24
const KINDS: SolarKind[] = ['planet', 'asteroid', 'comet']
const MIN_TIME = '1800-01-01T00:00'
const MAX_TIME = '2050-12-31T23:59'

function bodyName(body: SolarBody, lang: Lang) {
  return (lang === 'zh' && body.name_zh) || body.name
}

function utcInput() {
  return new Date().toISOString().slice(0, 16)
}

function utcDisplay(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toISOString().replace('T', ' ').slice(0, 16) + ' UTC'
}

function axisStep(range: number) {
  const rough = range / 6
  const power = 10 ** Math.floor(Math.log10(rough))
  return ([1, 2, 5, 10].find(factor => factor * power >= rough) ?? 10) * power
}

function ticks(start: number, end: number, step: number) {
  const first = Math.ceil(start / step)
  const last = Math.floor(end / step)
  return Array.from({ length: last - first + 1 }, (_, i) => (first + i) * step)
}

function OrbitPlot({ data, labels, name }: { data: SolarTrajectory; labels: Copy; name: string }) {
  const title = useId()
  const width = 640, height = 424
  const left = 62, right = 609, top = 24, bottom = 369
  const plotW = right - left, plotH = bottom - top
  const xy = [...data.path_au, data.position_au]
  const xValues = xy.map(v => v[0]), yValues = xy.map(v => v[1])
  const minX = Math.min(0, ...xValues), maxX = Math.max(0, ...xValues)
  const minY = Math.min(0, ...yValues), maxY = Math.max(0, ...yValues)
  const centerX = (minX + maxX) / 2, centerY = (minY + maxY) / 2
  const scale = Math.min(plotW / Math.max(maxX - minX, 0.02), plotH / Math.max(maxY - minY, 0.02)) * 0.83
  const x = (value: number) => (left + right) / 2 + (value - centerX) * scale
  const y = (value: number) => (top + bottom) / 2 - (value - centerY) * scale
  const step = axisStep(plotW / scale)
  const tickLabel = (value: number) => Math.abs(value) >= 1e4 ? value.toExponential(1) : Number(value.toPrecision(4)).toString()
  const [px, py] = data.position_au
  const path = data.path_au.map(([a, b], i) => (i === 0 ? 'M' : 'L') + x(a).toFixed(2) + ',' + y(b).toFixed(2)).join(' ')

  return (
    <figure className="min-w-0">
      <svg className="block w-full max-h-[540px] bg-ground-0 rounded-md" viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby={title}>
        <title id={title}>{name} · {labels.frame} · {utcDisplay(data.at)}</title>
        <g className="text-ink-faint mono" fontSize="13">
          {ticks(centerX - plotW / (2 * scale), centerX + plotW / (2 * scale), step).map(value => (
            <g key={value}>
              <line x1={x(value)} y1={top} x2={x(value)} y2={bottom} stroke="currentColor" opacity={value === 0 ? '.58' : '.23'} />
              <text x={x(value)} y={bottom + 18} textAnchor="middle" fill="currentColor">{tickLabel(value)}</text>
            </g>
          ))}
          {ticks(centerY - plotH / (2 * scale), centerY + plotH / (2 * scale), step).map(value => (
            <g key={value}>
              <line x1={left} y1={y(value)} x2={right} y2={y(value)} stroke="currentColor" opacity={value === 0 ? '.58' : '.23'} />
              <text x={left - 9} y={y(value)} dy=".33em" textAnchor="end" fill="currentColor">{tickLabel(value)}</text>
            </g>
          ))}
          <text x={right} y={bottom + 36} textAnchor="end" fill="currentColor">X (AU)</text>
          <text x={left} y={16} fill="currentColor">Y (AU)</text>
        </g>
        <path d={path} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" vectorEffect="non-scaling-stroke" className="text-ok" />
        <g className="text-ink">
          <circle cx={x(0)} cy={y(0)} r="5" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d={`M${x(0) - 9} ${y(0)} h18 M${x(0)} ${y(0) - 9} v18`} stroke="currentColor" />
        </g>
        <circle cx={x(px)} cy={y(py)} r="5" fill="currentColor" strokeWidth="1.5" className="text-signal stroke-ground-0" />
      </svg>
      <figcaption className="flex flex-wrap gap-x-4 gap-y-1 pt-2 text-xs text-ink-dim">
        <span><span aria-hidden="true" className="inline-block w-3 h-px mr-1.5 align-middle bg-ok" />{labels.path}</span>
        <span><span aria-hidden="true" className="inline-block w-2 h-2 mr-1.5 align-middle rounded-full border border-ink" />{labels.sun}</span>
        <span><span aria-hidden="true" className="inline-block w-2 h-2 mr-1.5 align-middle rounded-full bg-signal" />{labels.marker}</span>
      </figcaption>
    </figure>
  )
}

function TrajectoryReadouts({ data, labels, lang }: { data: SolarTrajectory; labels: Copy; lang: Lang }) {
  const number = new Intl.NumberFormat(lang, { maximumFractionDigits: 3 })
  const coords = new Intl.NumberFormat(lang, { maximumFractionDigits: 6, useGrouping: false })
  const au = (value: number) => coords.format(value) + ' AU'
  const days = (value: number) => number.format(value) + ' ' + labels.dayUnit
  const readings = [
    [labels.distance, au(data.distance_au)],
    ...data.position_au.map((value, index) => [labels.vectors + ' ' + ['X', 'Y', 'Z'][index], au(value)]),
    [labels.window, days(data.span_days)],
    [labels.period, data.period_days == null ? labels.openOrbit : days(data.period_days)],
    [labels.epoch, coords.format(data.epoch_jd_tdb)],
    ...(data.object.perihelion_au == null ? [] : [[labels.perihelion, au(data.object.perihelion_au)]]),
    ...(data.object.eccentricity == null ? [] : [[labels.eccentricity, coords.format(data.object.eccentricity)]]),
  ]
  const planet = data.method === 'planetary-fit'
  return (
    <>
      <dl className="grid grid-cols-2 xl:grid-cols-3 mt-4 gap-x-4 gap-y-3">
        {readings.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-xs text-ink-dim">{label}</dt>
            <dd className="mono text-sm text-ink break-words mt-0.5">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-4 pt-3 border-t border-ground-3 text-xs text-ink-dim">
        <a className="text-signal underline underline-offset-2" href={data.source_url} target="_blank" rel="noreferrer">
          {labels.provenance}
        </a>
        <p className="mt-1 font-medium text-ink">{planet ? labels.planetModel : labels.smallModel}</p>
        <p className="mt-0.5">{planet ? labels.planetDetail : labels.smallDetail}</p>
      </div>
    </>
  )
}

export default function SolarPage() {
  const { lang } = useLang()
  const labels = COPY[lang]
  const number = new Intl.NumberFormat(lang)
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<SolarKind | ''>('')
  const [offset, setOffset] = useState(0)
  const [catalogVersion, setCatalogVersion] = useState(0)
  const [catalog, setCatalog] = useState<Result<SolarCatalog>>({ status: 'loading' })
  const [selected, setSelected] = useState<SolarBody>()
  const [draftAt, setDraftAt] = useState(utcInput)
  const [draftDays, setDraftDays] = useState('')
  const [epoch, setEpoch] = useState<Epoch>(() => ({ at: draftAt + 'Z' }))
  const [formError, setFormError] = useState<'dateRange' | 'spanRange'>()
  const [trajectory, setTrajectory] = useState<Result<SolarTrajectory>>({ status: 'loading' })
  const [retryCount, setRetryCount] = useState(0)
  const [designation, setDesignation] = useState('')
  const [lookup, setLookup] = useState<'idle' | 'loading' | 'saved' | 'lookupMissing' | 'lookupRate' | 'lookupFailed' | 'lookupInvalid'>('idle')

  useEffect(() => {
    const controller = new AbortController()
    setCatalog({ status: 'loading' })
    const timer = window.setTimeout(async () => {
      try {
        const data = await solarApi.catalog(kind, query, offset, PAGE_SIZE, controller.signal)
        if (controller.signal.aborted) return
        setCatalog({ status: 'ready', data })
        setSelected(current => current ?? data.items.find(item => item.id === 'planet-earth') ?? data.items[0])
      } catch (error) {
        if (!controller.signal.aborted) setCatalog({ status: 'error', error })
      }
    }, query ? 180 : 0)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [kind, offset, query, catalogVersion])

  const selectedId = selected?.id
  useEffect(() => {
    if (!selectedId) return
    const controller = new AbortController()
    setTrajectory({ status: 'loading' })
    solarApi.trajectory(selectedId, epoch.at, epoch.days, controller.signal).then(
      data => { if (!controller.signal.aborted) setTrajectory({ status: 'ready', data }) },
      error => { if (!controller.signal.aborted) setTrajectory({ status: 'error', error }) },
    )
    return () => controller.abort()
  }, [selectedId, epoch, retryCount])

  function applyEpoch(at: string, days: string) {
    if (!at || at < MIN_TIME || at > MAX_TIME || !Number.isFinite(Date.parse(at + 'Z'))) {
      setFormError('dateRange')
      return
    }
    const span = days.trim() ? Number(days) : undefined
    if (span !== undefined && (!Number.isFinite(span) || span < 1 || span > 73050)) {
      setFormError('spanRange')
      return
    }
    setFormError(undefined)
    setEpoch({ at: at + 'Z', days: span })
  }

  async function importBody(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!designation.trim() || lookup === 'loading') return
    setLookup('loading')
    try {
      const body = await solarApi.lookup(designation)
      setSelected(body)
      setKind(body.kind)
      setQuery(body.designation || designation.trim())
      setOffset(0)
      setCatalogVersion(current => current + 1)
      setDesignation('')
      setLookup('saved')
    } catch (error) {
      const code = error instanceof ApiError ? error.code : ''
      const states = { SOLAR_NOT_FOUND: 'lookupMissing', SOLAR_RATE: 'lookupRate', BAD_SOLAR_NAME: 'lookupInvalid' } as const
      setLookup(Object.hasOwn(states, code) ? states[code as keyof typeof states] : 'lookupFailed')
    }
  }

  const list = catalog.status === 'ready' ? catalog.data : undefined
  const result = trajectory.status === 'ready' && trajectory.data.object.id === selectedId ? trajectory.data : undefined
  const selectedName = selected ? bodyName(selected, lang) : ''
  const catalogCount = list
    ? number.format(offset + (list.items.length ? 1 : 0)) + '–' + number.format(offset + list.items.length) + ' / ' + number.format(list.total)
    : ''

  return (
    <div className="h-full min-w-0 overflow-y-auto pr-1">
      <PageHeader title={labels.heading} subtitle={labels.subtitle} />
      <div className="grid items-start gap-3 lg:grid-cols-[minmax(245px,300px)_minmax(0,1fr)]">
        <section className="panel min-w-0" aria-labelledby="solar-catalog">
          <h2 id="solar-catalog" className="panel-header">{labels.catalog}</h2>
          <div className="p-3 space-y-3">
            <div>
              <label className="block text-xs text-ink-dim mb-1" htmlFor="solar-kind">{labels.kind}</label>
              <select id="solar-kind" className="input" value={kind} onChange={e => { setKind(e.target.value as SolarKind | ''); setOffset(0) }}>
                <option value="">{labels.all}</option>
                {KINDS.map(value => (
                  <option key={value} value={value}>{labels.kinds[value]}{list ? ` (${number.format(list.counts[value])})` : ''}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-ink-dim mb-1" htmlFor="solar-search">{labels.search}</label>
              <input id="solar-search" className="input" value={query} type="search" maxLength={100}
                onChange={e => { setQuery(e.target.value); setOffset(0) }} />
            </div>
            {catalog.status === 'loading' && <p role="status" className="min-h-12 text-sm text-ink-dim">{labels.loadingCatalog}</p>}
            {catalog.status === 'error' && (
              <div className="flex items-center gap-2 text-sm">
                <p role="alert" className="text-danger">{labels.catalogFailed}</p>
                <button type="button" className="btn shrink-0" onClick={() => setCatalogVersion(current => current + 1)}>{labels.retry}</button>
              </div>
            )}
            {list && (
              <>
                {list.items.length === 0 && <p role="status" className="text-sm text-ink-dim">{labels.noMatches}</p>}
                <ul className="max-h-60 lg:max-h-[440px] overflow-y-auto space-y-0.5">
                  {list.items.map(body => {
                    const active = selectedId === body.id
                    return (
                      <li key={body.id}>
                        <button type="button" aria-pressed={active} onClick={() => setSelected(body)}
                          className={'w-full text-left px-2.5 py-2 rounded ' + (active
                            ? 'bg-ground-3 text-signal' : 'hover:bg-ground-2 text-ink')}>
                          <span className="block text-sm break-words">{bodyName(body, lang)}</span>
                          <span className="block text-xs text-ink-dim">
                            {labels.kinds[body.kind]}
                            {body.kind !== 'planet' && body.designation && <span className="mono"> · {body.designation}</span>}
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
                <div className="flex items-center justify-between gap-1 flex-wrap">
                  <button type="button" className="btn" disabled={offset === 0}
                    onClick={() => setOffset(n => Math.max(0, n - PAGE_SIZE))}>{labels.previous}</button>
                  <output className="text-xs text-ink-dim mono">{catalogCount}</output>
                  <button type="button" className="btn" disabled={offset + PAGE_SIZE >= list.total}
                    onClick={() => setOffset(n => n + PAGE_SIZE)}>{labels.next}</button>
                </div>
                {list.retrieved_at && <p className="text-xs text-ink-dim">{labels.snapshot} · {utcDisplay(list.retrieved_at)}</p>}
              </>
            )}
            <details className="pt-2 border-t border-ground-3">
              <summary className="text-sm text-signal cursor-pointer py-1">{labels.lookup}</summary>
              <form onSubmit={importBody} className="mt-2 space-y-2">
                <label className="block text-xs text-ink-dim" htmlFor="solar-designation">{labels.designation}</label>
                <div className="flex items-center gap-2">
                  <input id="solar-designation" className="input min-w-0" value={designation} maxLength={80}
                    onChange={event => { setDesignation(event.target.value); if (lookup !== 'loading') setLookup('idle') }} />
                  <button type="submit" className="btn shrink-0" disabled={!designation.trim() || lookup === 'loading'}>
                    {lookup === 'loading' ? labels.looking : labels.find}
                  </button>
                </div>
                {lookup !== 'idle' && lookup !== 'loading' && (
                  <p role={lookup === 'saved' ? 'status' : 'alert'} className={`text-xs ${lookup === 'saved' ? 'text-ok' : 'text-danger'}`}>{labels[lookup]}</p>
                )}
              </form>
            </details>
          </div>
        </section>

        <section className="panel min-w-0" aria-labelledby="solar-trajectory">
          <h2 id="solar-trajectory" className="panel-header h-auto min-h-10 py-2 gap-2">
            <span>{labels.trajectory}</span>
            {selected && <span className="text-xs text-ink-dim text-right break-words">{labels.kinds[selected.kind]}</span>}
          </h2>
          <div className="p-3 sm:p-4">
            <form aria-label={labels.update} noValidate className="flex flex-wrap items-end gap-3"
              onSubmit={e => { e.preventDefault(); applyEpoch(draftAt, draftDays) }}>
              <div className="flex-1 min-w-[210px]">
                <label className="block text-xs text-ink-dim mb-1" htmlFor="solar-date">{labels.at}</label>
                <input type="datetime-local" id="solar-date" min={MIN_TIME} max={MAX_TIME} className="input block [color-scheme:dark]"
                  value={draftAt} onChange={e => { setDraftAt(e.target.value); setFormError(undefined) }} />
              </div>
              <div className="w-28">
                <label className="block text-xs text-ink-dim mb-1" htmlFor="solar-days">{labels.days}</label>
                <input id="solar-days" type="number" inputMode="decimal" min={1} max={73050} step="any" className="input"
                  value={draftDays} placeholder={labels.auto} onChange={e => { setDraftDays(e.target.value); setFormError(undefined) }} />
              </div>
              <button type="submit" className="btn btn-solid" disabled={!selected}>{labels.update}</button>
              <button type="button" className="btn" disabled={!selected} onClick={() => {
                const time = utcInput()
                setDraftAt(time)
                applyEpoch(time, draftDays)
              }}>
                <Icon name="clock" size={15} />{labels.now}
              </button>
            </form>
            {formError && <p role="alert" className="mt-2 text-sm text-danger">{labels[formError]}</p>}
            <div className="mt-4">
              {!selected && <p role="status" className="text-sm text-ink-dim">{labels.choose}</p>}
              {selected && (
                <>
                  <h3 className="text-lg text-ink font-semibold break-words">{selectedName}</h3>
                  {trajectory.status === 'error' && (
                    <div role="alert" className="flex items-center gap-3 mt-2 text-sm text-danger">
                      {trajectory.error instanceof ApiError && trajectory.error.code === 'SOLAR_RANGE' ? labels.dateRange : labels.trajectoryFailed}
                      <button className="btn" type="button" onClick={() => setRetryCount(n => n + 1)}>{labels.retry}</button>
                    </div>
                  )}
                  {!result && trajectory.status !== 'error' && <p role="status" className="mt-2 min-h-24 text-sm text-ink-dim">{labels.loadingTrajectory}</p>}
                  {result && (
                    <>
                      <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1 my-2 text-xs text-ink-dim">
                        <span>{labels.frame}</span>
                        <time className="mono" dateTime={result.at}>{utcDisplay(result.at)}</time>
                      </p>
                      <OrbitPlot data={result} labels={labels} name={selectedName} />
                      <TrajectoryReadouts data={result} labels={labels} lang={lang} />
                    </>
                  )}
                </>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
