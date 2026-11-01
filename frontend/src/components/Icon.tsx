import type { ReactNode } from 'react'

/** 统一线性图标（1.5px 描边、24 网格、圆线帽）——替代 emoji 图标。 */
const paths: Record<string, ReactNode> = {
  satellite: (
    <>
      {/* 卫星主体+两侧太阳板 */}
      <rect x="9" y="9" width="6" height="6" rx="1" />
      <path d="M3.5 10.5h4M16.5 10.5h4M3.5 13.5h4M16.5 13.5h4" />
      <path d="M2 9.5h6M16 9.5h6" opacity="0" />
      {/* 波束 */}
      <path d="M12 15.5c0 2.5-2 4.5-4.5 4.5M12 15.5c0 2.5 2 4.5 4.5 4.5" opacity=".55" />
    </>
  ),
  dish: (
    <>
      <path d="M5 12a8 8 0 0 0 13 6.2L6.8 7A8 8 0 0 0 5 12Z" />
      <path d="M6.8 7 13 4.5M14.5 10.5l3 3M17.5 13.5 21 10" />
      <circle cx="14.2" cy="9.8" r="1.2" />
    </>
  ),
  wrench: <path d="M14.7 6.3a4.5 4.5 0 0 0-6 5.6L3 17.6V21h3.4l5.7-5.7a4.5 4.5 0 0 0 5.6-6L14.5 12l-2.5-2.5 2.7-3.2Z" />,
  route: (
    <>
      <circle cx="5.5" cy="18.5" r="2" />
      <circle cx="18.5" cy="5.5" r="2" />
      <path d="M7.5 18.5H15a3.5 3.5 0 0 0 0-7H9a3.5 3.5 0 0 1 0-7h7.5" strokeDasharray="0" />
    </>
  ),
  wave: (
    <>
      <path d="M2 12h3l2.5-7 4 14 3.5-10 2 3h5" strokeLinejoin="round" strokeLinecap="round" />
    </>
  ),
  book: (
    <>
      <path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v17.5H6.5A2.5 2.5 0 0 0 4 22V4.5Z" />
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
    </>
  ),
  trophy: (
    <>
      <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4Z" />
      <path d="M7 6H4a1 1 0 0 0-1 1c0 2.2 1.8 4 4 4M17 6h3a1 1 0 0 1 1 1c0 2.2-1.8 4-4 4" />
    </>
  ),
  gear: (
    <>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2.8v2.6M12 18.6v2.6M4.5 7.6l2.3 1.3M17.2 15.1l2.3 1.3M4.5 16.4l2.3-1.3M17.2 8.9l2.3-1.3M2.8 12h2.6M18.6 12h2.6" />
      <circle cx="12" cy="12" r="7.2" opacity=".55" />
    </>
  ),
  home: <path d="M4 11 12 4l8 7v8a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1v-8Z" />,
  play: <path d="M7 4.5v15l13-7.5-13-7.5Z" />,
  pause: (
    <>
      <path d="M7 4.5v15M17 4.5v15" strokeWidth="2.4" />
    </>
  ),
  star: <path d="m12 3 2.7 5.7 6.3.8-4.6 4.3 1.2 6.2-5.6-3-5.6 3 1.2-6.2L3 9.5l6.3-.8L12 3Z" />,
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m20 20-4.4-4.4" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  refresh: <path d="M20 11a8 8 0 1 0-2.3 6.3M20 5v6h-6" />,
  alert: (
    <>
      <path d="M12 3 2.5 20h19L12 3Z" strokeLinejoin="round" />
      <path d="M12 9.5V14M12 16.8v.4" />
    </>
  ),
  check: <path d="m4.5 12.5 5 5L19.5 7" />,
  signal: (
    <>
      <path d="M5 18v-4M10 18v-8M15 18v-12M20 18V4" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16M9 7V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V7M6.5 7 7.5 21h9L17.5 7" />
    </>
  ),
  zap: <path d="M13 2 4.5 13.5H11L9.5 22 19 10h-6.5L13 2Z" strokeLinejoin="round" />,
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.7 2.6 4 5.8 4 9s-1.3 6.4-4 9c-2.7-2.6-4-5.8-4-9s1.3-6.4 4-9Z" />
    </>
  ),
  archive: (
    <>
      <rect x="3" y="4" width="18" height="5" rx="1" />
      <path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9M10 13h4" />
    </>
  ),
  sound: (
    <>
      <path d="M4 9.5v5h3.5L12 19V5L7.5 9.5H4Z" strokeLinejoin="round" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7M18 6a8.5 8.5 0 0 1 0 12" />
    </>
  ),
  mute: (
    <>
      <path d="M4 9.5v5h3.5L12 19V5L7.5 9.5H4Z" strokeLinejoin="round" />
      <path d="m16 9.5 5 5M21 9.5l-5 5" />
    </>
  ),
  chart: (
    <>
      <path d="M4 20V4M4 20h16" />
      <path d="M8 16v-5M12.5 16V8M17 16v-3" strokeWidth="2.2" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4.5" />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
    </>
  ),
}

export default function Icon({
  name,
  size = 18,
  className = '',
}: {
  name: keyof typeof paths | string
  size?: number
  className?: string
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {paths[name] ?? null}
    </svg>
  )
}
