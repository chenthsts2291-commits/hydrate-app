// vite.config.js
import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [svelte()],
  
  // ★これを追加してください！
  // '/好きなリポジトリ名/' (前後にスラッシュが必要です)
  base: '/hydrate-app/', 
})