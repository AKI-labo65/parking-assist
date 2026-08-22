import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // GitHub Pagesではリポジトリ名の配下、それ以外ではドメイン直下で動かす。
  base: process.env.VITE_BASE_PATH || '/',
  plugins: [react()],
  test: {
    // 報告文は端末のローカル時刻で組み立てるため、テストは日本時間に固定する。
    env: { TZ: 'Asia/Tokyo' },
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.js'],
    include: ['src/**/*.test.{js,jsx}'],
    restoreMocks: true,
  },
})
