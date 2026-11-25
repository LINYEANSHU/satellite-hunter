import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, type Capabilities } from '../api/client'
import { gameApi, type SaveInfo } from '../api/game'
import { useGameStore } from '../stores/gameStore'
import Icon from '../components/Icon'
import LanguageToggle from '../components/LanguageToggle'
import { useLang, fmt, tr } from '../i18n'
import { sfx } from '../lib/sfx'

/** 主菜单：唯一的 Persuade 门面 —— 地球实拍 + 存档管理。 */
export default function MainMenuPage() {
  const nav = useNavigate()
  const [caps, setCaps] = useState<Capabilities | null>(null)
  const [saves, setSaves] = useState<SaveInfo[]>([])
  const [newName, setNewName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [savesStatus, setSavesStatus] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [backendDown, setBackendDown] = useState(false)
  const [creating, setCreating] = useState(false)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const setSession = useGameStore((s) => s.setSession)
  const { t } = useLang()
  const busy = creating || pendingId !== null
  const recent = saves[0]

  const refreshSaves = useCallback(async () => {
    setSavesStatus('loading')
    try {
      setSaves(await gameApi.saves())
      setSavesStatus('ready')
    } catch (e) {
      setSavesStatus('failed')
      setError(tr(e))
    }
  }, [])

  useEffect(() => { void refreshSaves() }, [refreshSaves])
  useEffect(() => {
    api.capabilities().then(setCaps).catch(() => setBackendDown(true))
  }, [])

  const enter = async (id: string) => {
    const { save, player } = await gameApi.resumeSave(id)
    sfx.click()
    setSession({
      saveId: save.id,
      saveName: save.name,
      credits: player.credits,
      researchPoints: player.research_points,
      xp: player.xp,
      level: player.level,
      totalMissionsDone: player.total_missions_done,
      satellitesDiscovered: player.satellites_discovered,
    })
    nav('/explorer')
  }

  const open = async (id: string) => {
    if (busy) return
    setPendingId(id)
    setError(null)
    try {
      await enter(id)
    } catch (e) {
      setError(tr(e))
    } finally {
      setPendingId(null)
    }
  }

  const explore = () => {
    const active = useGameStore.getState()
    if (active.saveId && savesStatus === 'ready') {
      if (saves.some((s) => s.id === active.saveId)) {
        void open(active.saveId)
        return
      }
      active.reset()
    }
    nav('/explorer')
  }

  const create = async () => {
    if (!newName.trim() || busy) return
    setCreating(true)
    setError(null)
    try {
      const s = await gameApi.createSave(newName.trim())
      setNewName('')
      await enter(s.id)
    } catch (e) {
      await refreshSaves()
      setError(tr(e))
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="h-full flex flex-col bg-ground-0 overflow-auto">
      {/* 语言切换（主菜单在 Shell 之外，自带悬浮入口） */}
      <div className="fixed top-3 right-4 z-40">
        <div className="panel flex items-center px-1 py-0.5">
          <LanguageToggle />
        </div>
      </div>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-5 min-h-[440px]">
        {/* 左：主张与行动 */}
        <div className="lg:col-span-3 flex flex-col justify-center px-8 lg:px-14 py-10">
          <h1
            className="font-semibold text-ink rise"
            style={{ fontSize: 'clamp(2rem, 6vw, 4.5rem)', lineHeight: 1.02, letterSpacing: '-0.02em' }}
          >
            {t.menu.title1}
            <br />
            {t.menu.title2}
          </h1>
          <p className="mt-6 text-[16px] text-ink-dim leading-relaxed max-w-lg rise" style={{ animationDelay: '80ms' }}>
            {t.menu.body}
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-4 rise" style={{ animationDelay: '160ms' }}>
            {recent && (
              <button className="btn-solid min-h-11 max-w-full px-6 text-[15px] truncate" title={recent.name}
                disabled={busy || savesStatus !== 'ready'} onClick={() => void open(recent.id)} data-testid="resume-save">
                {fmt(t.menu.resume, { name: recent.name })}
              </button>
            )}
            <button className={`${recent ? 'btn' : 'btn-solid'} h-11 px-6 text-[15px]`} disabled={busy}
              onClick={explore} data-testid="enter-explorer">
              {t.menu.enter}
            </button>
            <span className="text-[13px] text-ink-dim">{t.menu.noHardware}</span>
          </div>

          <div
            className="mt-9 flex flex-wrap items-center gap-5 text-[13px] text-ink-dim rise"
            style={{ animationDelay: '240ms' }}
          >
            <span className="inline-flex items-center gap-1.5">
              <span className={`status-dot ${backendDown ? 'bg-danger' : caps ? 'bg-ok' : 'bg-ink-dim'}`} />
              {t.menu.svc} {backendDown ? t.menu.svcDown : caps ? t.menu.svcOk : t.common.loading}
            </span>
            <span className="inline-flex items-center gap-1.5">
              SatDump
              <span className={caps?.satdump.installed ? 'text-ok' : 'text-warn'}>
                {caps ? (caps.satdump.installed ? t.menu.satdumpReady : t.menu.satdumpMissing) : '—'}
              </span>
            </span>
            {caps && <span className="data">v{caps.app.version}</span>}
          </div>
          {error && <p role="alert" className="mt-2 text-[13px] text-danger">{error}</p>}
        </div>

        {/* 右：地球实拍（NASA 公有领域），占满右列 */}
        <div className="lg:col-span-2 relative min-h-[320px] overflow-hidden">
          <img
            src="/photos/blue-marble-western-hemisphere.jpg"
            alt={t.menu.photoBlueMarble}
            className="absolute inset-0 w-full h-full object-cover"
          />
        </div>
      </div>

      {/* 真实世界影像带 */}
      <div className="px-8 lg:px-14 pt-4 bg-ground-0 grid grid-cols-3 gap-3">
        {[
          { src: '/photos/sts-134-international-space-station-after-undocking.jpg', alt: t.menu.photoISS, label: t.menu.photoISSLabel },
          { src: '/photos/erdfunkstelle-raisting-2.jpg', alt: t.menu.photoDish, label: t.menu.photoDishLabel },
          { src: '/photos/antennas-at-awarua-satellite-ground-station.jpg', alt: t.menu.photoAwarua, label: t.menu.photoAwaruaLabel },
        ].map((ph, i) => (
          <div key={ph.src} className="relative rounded-lg overflow-hidden h-24 lg:h-28 rise" style={{ animationDelay: `${i * 70}ms` }}>
            <img src={ph.src} alt={ph.alt} className="absolute inset-0 w-full h-full object-cover" />
            <div className="absolute bottom-0 inset-x-0 bg-ground-0/60 px-2.5 py-1 text-[13px] text-ink/90">{ph.label}</div>
          </div>
        ))}
      </div>

      {/* 存档：行式列表 */}
      <div className="px-8 lg:px-14 pb-3 pt-6 bg-ground-0">
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
          <div className="lg:col-span-3">
            <div className="flex items-baseline justify-between mb-3">
              <h2 className="text-[17px] font-semibold text-ink">{t.menu.saves}</h2>
              <span className="text-[13px] text-ink-dim">{fmt(t.menu.savesN, { n: saves.length })}</span>
            </div>
            {savesStatus === 'loading' && <p role="status" className="text-sm text-ink-dim py-3">{t.common.loading}</p>}
            {savesStatus === 'failed' && (
              <button className="btn" onClick={() => { setError(null); void refreshSaves() }}>{t.menu.retrySaves}</button>
            )}
            {savesStatus === 'ready' && saves.length === 0 && (
              <p className="text-[14px] text-ink-dim py-3">{t.menu.savesEmpty}</p>
            )}
            {saves.map((s, i) => (
              <div
                key={s.id}
                className="row rounded-md mb-1 bg-ground-1 rise"
                style={{ animationDelay: `${i * 60}ms` }}
                data-testid={`save-${s.name}`}
              >
                <div className="flex-1 min-w-0">
                  <div className="text-[15px] text-ink truncate" title={s.name}>{s.name}</div>
                  <div className="text-[13px] text-ink-dim mt-0.5">
                    <span className="data">Lv.{s.level}</span> ·{' '}
                    <span className="data text-warn">₡{Math.round(s.credits).toLocaleString()}</span> ·{' '}
                    {fmt(t.menu.missionsN, { n: s.total_missions_done })} ·{' '}
                    {fmt(t.menu.discoveredN, { n: s.satellites_discovered })}
                    {s.last_played_at &&
                      ` · ${fmt(t.menu.lastPlayed, { date: new Date(s.last_played_at).toLocaleDateString() })}`}
                  </div>
                </div>
                <button className="btn btn-primary h-8 text-[13px]" disabled={busy} onClick={() => void open(s.id)}>
                  {t.common.enter}
                </button>
                <button
                  className="btn btn-danger w-9 px-0 h-8"
                  title={t.menu.deleteTitle}
                  aria-label={t.menu.deleteTitle}
                  disabled={busy}
                  onClick={async () => {
                    if (confirm(fmt(t.menu.deleteConfirm, { name: s.name }))) {
                      setPendingId(s.id)
                      setError(null)
                      try {
                        await gameApi.deleteSave(s.id)
                        const active = useGameStore.getState()
                        if (active.saveId === s.id) active.reset()
                        await refreshSaves()
                      } catch (e) {
                        setError(tr(e))
                      } finally {
                        setPendingId(null)
                      }
                    }
                  }}
                >
                  <Icon name="trash" size={14} />
                </button>
              </div>
            ))}
            <div className="flex gap-2 mt-3">
              <input
                className="input max-w-xs !h-9"
                placeholder={t.menu.newSavePh}
                aria-label={t.menu.newSavePh}
                maxLength={64}
                disabled={busy}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void create()}
                data-testid="new-save-input"
              />
              <button className="btn !h-9" disabled={busy || !newName.trim()} onClick={() => void create()} data-testid="create-save">
                <Icon name="plus" size={14} />
                {creating ? t.common.loading : t.menu.create}
              </button>
            </div>
          </div>

          <div className="lg:col-span-2 flex flex-col justify-center">
            <h3 className="text-[17px] font-semibold text-ink mb-2">{t.menu.whyTitle}</h3>
            <p className="text-[15px] text-ink-dim leading-relaxed">{t.menu.whyBody}</p>
          </div>
        </div>
      </div>

      {/* 照片署名（许可要求） */}
      <footer className="px-8 lg:px-14 pb-4 pt-3 text-[13px] text-ink-dim">
        {t.menu.credit}
        <a
          className="hover:text-ink"
          href="https://commons.wikimedia.org/wiki/File:Blue_Marble_Western_Hemisphere.jpg"
          target="_blank"
          rel="noreferrer"
        >
          Blue Marble
        </a>{' '}
        {t.menu.creditNasa} ·{' '}
        <a
          className="hover:text-ink"
          href="https://commons.wikimedia.org/wiki/File:Antennas_at_Awarua_Satellite_Ground_Station.jpg"
          target="_blank"
          rel="noreferrer"
        >
          Awarua Ground Station
        </a>{' '}
        {t.menu.creditCc}
      </footer>
    </div>
  )
}
