/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // DESIGN.md：一地一墨一强调，表面靠明度阶梯分隔
        ground: {
          0: '#091c29',
          1: '#102e3b',
          2: '#183e4a',
          3: '#23515a',
          4: '#28565f',
        },
        ink: {
          DEFAULT: '#f6f0df',
          dim: '#b7cec9',
          faint: '#9ebdb7',
        },
        signal: {
          DEFAULT: '#edbb70',
          deep: '#c89446',
        },
        ok: '#83d7b2',
        warn: '#edbb70',
        danger: '#f39882',
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
