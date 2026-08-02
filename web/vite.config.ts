import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

// https://vite.dev/config/
const apiTarget = process.env.API_PROXY_TARGET ?? 'http://localhost:5081'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        // ─────────────────────────────────────────────────────────────
        //  แยก chunk ตาม "จังหวะที่โหลด" ไม่ใช่ตามขนาด
        //
        //  editor (BlockNote + ProseMirror + Yjs) เป็นก้อนใหญ่ที่สุดและ
        //  ต้องใช้เฉพาะตอนเปิดหน้าเอกสาร — หน้า login ไม่ควรต้องโหลดมัน
        //
        //  แยกแบบนี้ยังทำให้ cache ใช้ได้ดีขึ้นมาก: แก้โค้ดแอปแล้ว vendor
        //  chunk ยังเป็นไฟล์เดิม เบราว์เซอร์ไม่ต้องโหลดซ้ำ
        // ─────────────────────────────────────────────────────────────
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          editor: ['@blocknote/core', '@blocknote/react', '@blocknote/shadcn'],
          // ⚠️ ไม่ใส่ y-protocols — แพ็กเกจนี้ไม่มี root export ("." ใน exports)
          //    มีแต่ subpath อย่าง y-protocols/awareness การใส่ชื่อเปล่า ๆ
          //    ทำให้ build ล้มด้วย "Missing '.' specifier"
          yjs: ['yjs', 'y-prosemirror', 'y-indexeddb'],
          // ⚠️ mermaid ถูกโหลดด้วย dynamic import เท่านั้น (mermaidPreview.ts)
          //    ก้อนนี้จึงไม่ถูกดึงมาตอนเปิดแอป มาเฉพาะตอนเจอ ```mermaid จริง ๆ
          //
          //    ระบุแค่ entry — mermaid แยก chunk ของ diagram แต่ละชนิดเองอยู่แล้ว
          //    การพยายามยัดทั้งหมดมารวมกันจะทำให้หน้าที่มีแค่ flowchart
          //    ต้องโหลด cytoscape กับ katex ไปด้วยโดยไม่ได้ใช้
          mermaid: ['mermaid'],
        },
      },
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
    // ⚠️ 5081 ไม่ใช่ 5080
    //
    //    5080 คือ container `pm-api` ที่ docker compose รันอยู่ ส่วน API ที่
    //    กำลังพัฒนา (scripts/dev-env.sh) ฟังที่ 5081 เพื่อไม่ให้ชนกัน
    //
    //    ถ้าชี้ผิดตัว อาการคือ 404 จาก endpoint ที่ container รุ่นเก่ายังไม่มี
    //    ซึ่งดูเหมือนโค้ดใหม่พังทั้งที่ไม่ได้ถูกเรียกเลย (เจอมาแล้วตอน Stage G)
    //
    //    ตั้ง API_PROXY_TARGET ถ้าอยากชี้ไปที่อื่น
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true },
      '/hubs': { target: apiTarget, changeOrigin: true, ws: true },
    },
  },
})
