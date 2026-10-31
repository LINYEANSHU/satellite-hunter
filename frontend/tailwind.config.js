/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Modern Space Mission Control 主题
        space: {
          950: '#070b12',
          900: '#0a0f18',
          850: '#0d1420',
          800: '#111a29',
          700: '#1a2536',
          600: '#243247',
          500: '#33455f',
        },
        hud: {
          cyan: '#22d3ee',
          blue: '#38bdf8',
          green: '#34d399',
          amber: '#fbbf24',
          red: '#f87171',
          violet: '#a78bfa',
          dim: '#5b6b82',
        },
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', '"Cascadia Mono"', 'Consolas', 'monospace'],
        display: ['"Rajdhani"', '"Noto Sans SC"', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        panel: '0 0 0 1px rgba(56,189,248,0.08), 0 8px 32px rgba(0,0,0,0.45)',
        glow: '0 0 12px rgba(34,211,238,0.25)',
      },
      keyframes: {
        pulseSoft: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.55' },
        },
      },
      animation: {
        pulseSoft: 'pulseSoft 2s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
