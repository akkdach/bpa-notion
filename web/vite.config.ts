import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    // ─────────────────────────────────────────────────────────────────────
    //  dev เท่านั้น: proxy ให้เบราว์เซอร์เห็น origin เดียวเหมือนตอน production
    //  (ที่ nginx ทำหน้าที่นี้) → ไม่ต้องเจอ CORS ต่างกันระหว่าง dev/prod
    //
    //  ws: true จำเป็นสำหรับ SignalR — ถ้าไม่ใส่ WebSocket จะ downgrade
    //  ไปเป็น long-polling เงียบ ๆ แล้ว collab จะรู้สึกหน่วงแบบหาสาเหตุไม่เจอ
    // ─────────────────────────────────────────────────────────────────────
    proxy: {
      '/api': {
        target: 'http://localhost:5080',
        changeOrigin: true,
      },
      '/hubs': {
        target: 'http://localhost:5080',
        changeOrigin: true,
        ws: true,
      },
    },
  },
})
