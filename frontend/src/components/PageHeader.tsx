import type { ReactNode } from 'react'

export default function PageHeader({
  title,
  subtitle,
  right,
}: {
  title: string
  subtitle?: string
  right?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
      <div>
        <h1 className="text-title font-semibold text-ink">{title}</h1>
        {subtitle && <p className="text-[12px] text-ink-dim mt-0.5">{subtitle}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">{right}</div>
    </div>
  )
}
