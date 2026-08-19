import { defineConfig } from 'vite'

export default defineConfig({
  // GitHub Pagesではリポジトリ名の配下、それ以外ではドメイン直下で動かす。
  base: process.env.VITE_BASE_PATH || '/',
})
