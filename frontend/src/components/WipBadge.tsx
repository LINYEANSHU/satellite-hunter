/** 明确标记尚未实现的功能区域（需求 11.4：不得伪装成已实现）。 */
export default function WipBadge({ phase }: { phase: string }) {
  return (
    <span
      className="inline-flex items-center h-5 px-2 rounded text-[10px] font-mono
        border border-hud-amber/40 bg-hud-amber/10 text-hud-amber"
      title="此功能区尚未实现，将在后续阶段交付"
    >
      PLAN · {phase}
    </span>
  )
}
