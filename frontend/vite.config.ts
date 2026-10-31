import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// 后端运行在 8000；开发时代理 /api 与 /ws，避免 CORS 与 WebSocket 问题
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5273,
    strictPort: true,
    // Windows/G 盘下原生文件监听不可靠，使用轮询确保 HMR 及时生效
    watch: { usePolling: true, interval: 800 },
    proxy: {
      '/api': { target: 'http://127.0.0.1:8000', changeOrigin: true },
      '/ws': { target: 'ws://127.0.0.1:8000', ws: true },
      '/docs': { target: 'http://127.0.0.1:8000', changeOrigin: true },
      '/openapi.json': { target: 'http://127.0.0.1:8000', changeOrigin: true },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
  },
})
