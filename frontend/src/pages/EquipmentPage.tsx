import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { gameApi, type CatalogCategory } from '../api/game'
import PageHeader from '../components/PageHeader'
import { useGameStore } from '../stores/gameStore'
import { useLang, fmt, tr } from '../i18n'

/** 设备管理：目录采购（需求 4.3/4.4）。 */
export default function EquipmentPage() {
  const nav = useNavigate()
  const saveId = useGameStore((s) => s.saveId)
  const credits = useGameStore((s) => s.credits)
  const [cats, setCats] = useState<CatalogCategory[]>([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const { t } = useLang()

  useEffect(() => {
    gameApi.catalog().then((c) => {
      setCats(c.categories)
    })
  }, [])

  const buy = async (catalogId: string, price: number) => {
    if (!saveId) return nav('/')
    setBusy(true)
    setMsg(null)
    try {
      await gameApi.buy(saveId, catalogId)
      setMsg(fmt(t.equip.bought, { price }))
    } catch (e) {
      setMsg(tr(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="h-full overflow-auto">
      <PageHeader
        title={t.equip.title}
        subtitle={t.equip.subtitle}
        right={
          <>
            <span className="chip text-warn border-warn/40">₡ {Math.round(credits).toLocaleString()}</span>
            <button className="btn h-7 text-xs" onClick={() => nav('/station')}>
              {t.equip.goInstall}
            </button>
          </>
        }
      />

      {msg && <div className="panel px-3 py-2 mb-3 text-xs text-signal max-w-2xl">{msg}</div>}
      {!saveId && <div className="panel p-4 mb-3 text-sm text-ink-dim">{t.equip.noSave}</div>}

      <div className="space-y-3 pb-6">
        {cats.map((cat) => (
          <section className="panel" key={cat.category}>
            <div className="panel-header">
              {(t.equip.cats as Record<string, string>)[cat.category] ?? cat.category}
            </div>
            <div className="grid grid-cols-3 gap-2 p-3">
              {cat.items.map((it) => (
                <div key={it.id} className="rounded border  bg-ground-2/50 p-3 flex flex-col" data-testid={`cat-${it.id}`}>
                  <div className="flex justify-between items-start">
                    <span className="text-ink text-sm font-medium">{catalogItem(it.catalog_id ?? it.id ?? '', it.name, t).name}</span>
                    <span className={`chip ${(it.price ?? 0) === 0 ? '' : 'text-warn border-warn/40'}`}>
                      {(it.price ?? 0) === 0 ? t.equip.initial : `₡${it.price}`}
                    </span>
                  </div>
                  <p className="text-[12.5px] text-ink-dim mt-1 leading-relaxed flex-1">
                    {catalogItem(it.catalog_id ?? it.id ?? '', it.desc, t).desc}
                  </p>
                  <div className="mt-2 space-y-0.5 data text-[12px] text-ink-dim">
                    <SpecLine specs={it.specs} t={t} />
                  </div>
                  <button
                    className="btn btn-primary h-7 text-xs mt-2"
                    disabled={busy || !saveId}
                    onClick={() => void buy(it.id ?? '', it.price ?? 0)}
                    data-testid={`buy-${it.id}`}
                  >
                    {t.equip.buy}
                  </button>
                </div>
              ))}
            </div>
          </section>
        ))}
        <div className="panel p-3 text-[12px] text-ink-dim leading-relaxed max-w-3xl">{t.equip.note}</div>
      </div>
    </div>
  )
}

/** 目录条目文本：按 catalog_id 映射当前语言，未收录条目回落到后端原文。 */
function catalogItem(
  catalogId: string,
  fallback: string,
  t: ReturnType<typeof useLang>['t'],
): { name: string; desc: string } {
  const entry = (t.equip.items as Record<string, { name: string; desc: string }>)[catalogId]
  if (!entry) return { name: fallback, desc: fallback }
  return entry
}

function SpecLine({ specs, t }: { specs: Record<string, unknown>; t: ReturnType<typeof useLang>['t'] }) {
  const entries = Object.entries(specs).filter(
    ([k]) => !['id', 'name', 'desc', 'price', 'category', 'polarization'].includes(k),
  )
  return (
    <>
      {entries.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-2">
          <span className="text-ink-dim">
            {(t.equip.specs as Record<string, string>)[k] ?? k}
          </span>
          <span>{Array.isArray(v) ? v.join('/') : String(v)}</span>
        </div>
      ))}
    </>
  )
}
