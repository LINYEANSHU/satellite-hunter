export default function PageHeader({
  title,
  subtitle,
  right,
}: {
  title: string
  subtitle?: string
  right?: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between mb-3">
      <div>
        <h1 className="text-lg font-semibold tracking-wide text-slate-100">{title}</h1>
        {subtitle && <p className="text-xs text-hud-dim mt-0.5">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-2">{right}</div>
    </div>
  )
}
