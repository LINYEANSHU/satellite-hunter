import Icon from './Icon'

/** 明确标记尚未实现的功能区域（需求 11.4）。 */
export default function WipBadge({ phase }: { phase: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 h-6 px-2 rounded text-[11px] bg-warn/10 text-warn"
      title="此功能区尚未实现，将在后续阶段交付"
    >
      <Icon name="clock" size={11} />
      后续阶段 · {phase}
    </span>
  )
}
