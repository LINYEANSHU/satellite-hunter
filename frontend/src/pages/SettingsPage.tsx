import { useCallback, useEffect, useState } from 'react'
import { api, type Capabilities } from '../api/client'
import PageHeader from '../components/PageHeader'
import { useLang, fmt } from '../i18n'

/** 设置与系统状态：实时探测后端能力。 */
export default function SettingsPage() {
  const [caps, setCaps] = useState<Capabilities | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const { t } = useLang()

  const refresh = useCallback(() => {
    setLoading(true)
    api
      .capabilities()
      .then((c) => {
        setCaps(c)
        setError(null)
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(refresh, [refresh])

  return (
    <div className="h-full overflow-auto">
      <PageHeader
        title={t.settings.title}
        subtitle={t.settings.subtitle}
        right={
          <button className="btn" onClick={refresh} disabled={loading}>
            {loading ? t.settings.detecting : t.settings.refresh}
          </button>
        }
      />

      {error && <div className="panel p-3 mb-3 text-danger text-sm">{error}</div>}

      {caps && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-w-4xl">
          <section className="panel">
            <div className="panel-header">{t.settings.app}</div>
            <div className="p-3 text-sm space-y-1.5">
              <Row k={t.settings.name} v={caps.app.name} />
              <Row k={t.settings.version} v={caps.app.version} />
              <Row k={t.settings.python} v={caps.app.python} />
              <Row k={t.settings.platform} v={caps.app.platform} />
              <Row k={t.settings.dataDir} v={caps.data_dir} mono />
            </div>
          </section>

          <section className="panel">
            <div className="panel-header">{t.settings.satdumpSection}</div>
            <div className="p-3 text-sm space-y-1.5">
              <Row
                k={t.settings.status}
                v={caps.satdump.installed ? t.settings.installed : t.settings.notInstalled}
                cls={caps.satdump.installed ? 'text-ok' : 'text-warn'}
              />
              <Row k={t.settings.ver} v={caps.satdump.version ?? '—'} />
              <Row k={t.settings.source} v={caps.satdump.source ?? '—'} />
              {caps.satdump.installed && <Row k={t.settings.path} v={caps.satdump.bin ?? '—'} mono />}
              {!caps.satdump.installed && (
                <p className="text-xs text-ink-dim leading-relaxed pt-1  mt-1">
                  {caps.satdump.note}
                </p>
              )}
            </div>
          </section>

          <section className="panel">
            <div className="panel-header">{t.settings.orbit}</div>
            <div className="p-3 text-sm space-y-1.5">
              <Row k={t.settings.cacheDir} v={caps.orbit.cache_dir} mono />
              <Row k={t.settings.ttl} v={fmt(t.settings.hoursN, { n: caps.orbit.cache_ttl_hours })} />
              <Row k={t.settings.cachedGroups} v={caps.orbit.cached_groups.join(', ') || t.settings.emptyGroups} />
              <Row k={t.settings.configGroups} v={caps.orbit.configured_groups.join(', ')} />
            </div>
          </section>

          <section className="panel">
            <div className="panel-header">{t.settings.disk}</div>
            <div className="p-3 text-sm space-y-1.5">
              <Row k={t.settings.free} v={`${caps.disk.free_gb} GB`} />
              <Row k={t.settings.total} v={`${caps.disk.total_gb} GB`} />
              <Row k={t.settings.frontendBuild} v={caps.frontend_built ? t.settings.builtYes : t.settings.builtNo} />
            </div>
          </section>
        </div>
      )}
    </div>
  )
}

function Row({ k, v, cls, mono }: { k: string; v: string; cls?: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-ink-dim shrink-0">{k}</span>
      <span className={`${mono ? 'data text-xs break-all text-right' : ''} ${cls ?? 'text-ink'}`}>{v}</span>
    </div>
  )
}
