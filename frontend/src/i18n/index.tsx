/** 轻量 i18n：LanguageContext + localStorage 记忆 + 浏览器语言探测。 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import zhDict from './zh'
import enDict from './en'

export type Lang = 'zh' | 'en'
export type Dict = typeof zhDict

const DICTS: Record<Lang, Dict> = { zh: zhDict, en: enDict }
const STORAGE_KEY = 'sh-lang'

let currentLang: Lang = 'zh'

/** 非 React 环境（API 层等）获取当前语言。 */
export function getLang(): Lang {
  return currentLang
}

function detectLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'zh' || saved === 'en') return saved
  } catch {
    /* 无 localStorage 时走浏览器语言 */
  }
  const nav = typeof navigator !== 'undefined' ? navigator.language || '' : ''
  return nav.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

// 模块加载时同步初始值（Provider 挂载前也可能抛错文案）
currentLang = detectLang()

interface LangContextValue {
  lang: Lang
  setLang: (l: Lang) => void
  t: Dict
}

const LangContext = createContext<LangContextValue | null>(null)

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(detectLang)

  const setLang = useCallback((l: Lang) => {
    setLangState(l)
    currentLang = l
    try {
      localStorage.setItem(STORAGE_KEY, l)
    } catch {
      /* 忽略持久化失败 */
    }
    document.documentElement.lang = l === 'zh' ? 'zh-CN' : 'en'
  }, [])

  const value = useMemo(() => ({ lang, setLang, t: DICTS[lang] }), [lang, setLang])

  return <LangContext.Provider value={value}>{children}</LangContext.Provider>
}

export function useLang(): LangContextValue {
  const ctx = useContext(LangContext)
  if (!ctx) throw new Error('useLang must be used within LanguageProvider')
  return ctx
}

/** 简易插值：fmt('{n} 颗', { n: 3 }) → '3 颗'。 */
export function fmt(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) =>
    Object.prototype.hasOwnProperty.call(params, k) ? String(params[k]) : `{${k}}`,
  )
}

/** 后端错误 → 当前语言文案：优先按错误码映射，保留原文兜底。 */
export function translateError(lang: Lang, message: string, code?: string): string {
  if (code) {
    const mapped = (DICTS[lang].errors.codes as Record<string, string>)[code]
    if (mapped) return mapped
  }
  return message
}

/** 在组件 catch 中直接使用：按当前语言翻译 ApiError / Error。 */
export function tr(e: unknown): string {
  if (e && typeof e === 'object') {
    const err = e as { message?: string; code?: string }
    if (err.message) return translateError(currentLang, err.message, err.code)
  }
  return String(e)
}

/** 任务失败原因（后端中文，可能以「；」连接）→ 当前语言。 */
export function translateFailure(lang: Lang, reason: string): string {
  if (!reason || lang === 'zh') return reason
  const zhReasons = DICTS.zh.errors.failReasons
  const enReasons = DICTS.en.errors.failReasons
  const zhList = Object.values(zhReasons) as string[]
  const parts = reason.split(/；|;/)
  const translated = parts.map((p) => {
    const trimmed = p.trim()
    const idx = zhList.indexOf(trimmed)
    return idx >= 0 ? (Object.values(enReasons) as string[])[idx] : trimmed
  })
  return translated.join('; ')
}
