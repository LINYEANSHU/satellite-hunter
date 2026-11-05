import Icon from './Icon'
import { useLang, fmt } from '../i18n'

/** 明确标记尚未实现的功能区域（需求 11.4）。 */
export default function WipBadge({ phase }: { phase: string }) {
  const { t } = useLang()
  return (
    <span
      className="inline-flex items-center gap-1 h-6 px-2 rounded text-[11px] bg-warn/10 text-warn"
      title={t.wip.title}
    >
      <Icon name="clock" size={11} />
      {fmt(t.wip.label, { phase })}
    </span>
  )
}
