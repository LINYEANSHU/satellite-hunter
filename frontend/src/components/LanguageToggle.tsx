import { useLang } from '../i18n'

/** 顶栏语言切换按钮：🌐 中·EN。 */
export default function LanguageToggle({ className = '' }: { className?: string }) {
  const { lang, setLang, t } = useLang()
  const next: 'zh' | 'en' = lang === 'zh' ? 'en' : 'zh'
  return (
    <button
      className={`text-ink-dim hover:text-ink p-1.5 rounded-md hover:bg-ground-2 transition-colors inline-flex items-center gap-1 ${className}`}
      title={t.langToggle.title}
      onClick={() => setLang(next)}
      data-testid="lang-toggle"
    >
      <span aria-hidden className="text-[13px] leading-none">🌐</span>
      <span className="text-[12px] font-medium tracking-wide">{t.langToggle.label}</span>
    </button>
  )
}
