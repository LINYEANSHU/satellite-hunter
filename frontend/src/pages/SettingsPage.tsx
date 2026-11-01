import { useCallback, useEffect, useState } from 'react'
import { api, type Capabilities } from '../api/client'
import PageHeader from '../components/PageHeader'

/** 设置与系统状态：实时探测后端能力。 */
export default function SettingsPage() {
  const [caps, setCaps] = useState<Capabilities | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

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
        title="系统状态与设置"
        subtitle="环境能力探测 · 数据目录 · 依赖状态"
        right={
          <button className="btn" onClick={refresh} disabled={loading}>
            {loading ? '检测中…' : '↻ 重新检测'}
          </button>
        }
      />

      {error && <div className="panel p-3 mb-3 text-danger text-sm">{error}</div>}

      {caps && (
        <div className="grid grid-cols-2 gap-3 max-w-4xl">
          <section className="panel">
            <div className="panel-header">应用</div>
            <div className="p-3 text-sm space-y-1.5">
              <Row k="名称" v={caps.app.name} />
              <Row k="后端版本" v={caps.app.version} />
              <Row k="Python" v={caps.app.python} />
              <Row k="平台" v={caps.app.platform} />
              <Row k="数据目录" v={caps.data_dir} mono />
            </div>
          </section>

          <section className="panel">
            <div className="panel-header">SatDump（卫星解码）</div>
            <div className="p-3 text-sm space-y-1.5">
              <Row
                k="状态"
                v={caps.satdump.installed ? '已安装' : '未安装'}
                cls={caps.satdump.installed ? 'text-ok' : 'text-warn'}
              />
              <Row k="版本" v={caps.satdump.version ?? '—'} />
              <Row k="来源" v={caps.satdump.source ?? '—'} />
              {caps.satdump.installed && <Row k="路径" v={caps.satdump.bin ?? '—'} mono />}
              {!caps.satdump.installed && (
                <p className="text-xs text-ink-dim leading-relaxed pt-1  mt-1">
                  {caps.satdump.note}
                </p>
              )}
            </div>
          </section>

          <section className="panel">
            <div className="panel-header">轨道数据</div>
            <div className="p-3 text-sm space-y-1.5">
              <Row k="缓存目录" v={caps.orbit.cache_dir} mono />
              <Row k="缓存刷新间隔" v={`${caps.orbit.cache_ttl_hours} 小时`} />
              <Row k="已缓存分组" v={caps.orbit.cached_groups.join(', ') || '（空）'} />
              <Row k="配置分组" v={caps.orbit.configured_groups.join(', ')} />
            </div>
          </section>

          <section className="panel">
            <div className="panel-header">磁盘</div>
            <div className="p-3 text-sm space-y-1.5">
              <Row k="剩余" v={`${caps.disk.free_gb} GB`} />
              <Row k="总容量" v={`${caps.disk.total_gb} GB`} />
              <Row k="前端构建产物" v={caps.frontend_built ? '存在（单端口模式可用）' : '未构建'} />
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
