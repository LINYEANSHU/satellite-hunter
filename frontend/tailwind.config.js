/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // DESIGN.md：一地一墨一强调，表面靠明度阶梯分隔
        ground: {
          0: '#07090d',
          1: '#0c1016',
          2: '#121822',
          3: '#1a2230',
          4: '#242e40',
        },
        ink: {
          DEFAULT: '#e8edf4',
          dim: '#8b98ab',
          faint: '#77839b',
        },
        signal: {
          DEFAULT: '#3fd6e8',
          deep: '#1899aa',
        },
        ok: '#4ade80',
        warn: '#fbbf24',
        danger: '#f87171',
      },
      fontFamily: {
        sans: ['Inter', '"Noto Sans SC"', 'system-ui', 'sans-serif'],
        data: ['"JetBrains Mono"', '"Cascadia Mono"', 'Consolas', 'monospace'],
      },
      fontSize: {
        // 展示尺寸（主菜单/章节）与正文尺寸，两极分明
        display: ['clamp(2rem, 4vw, 2.75rem)', { lineHeight: '1.05', letterSpacing: '-0.02em' }],
        title: ['1.25rem', { lineHeight: '1.2', letterSpacing: '-0.01em' }],
      },
    },
  },
  plugins: [],
}
