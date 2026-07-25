import { defineConfig, devices } from '@playwright/test'

// ═══════════════════════════════════════════════════════════════════════════
//  Playwright
//
//  Phase 1 ตรวจว่า "พิมพ์ → refresh → เนื้อหายังอยู่" ทำงานจริงในเบราว์เซอร์
//  Phase 2 จะเพิ่มเทสสองเบราว์เซอร์แก้พร้อมกัน + ออฟไลน์แล้วกลับมา
//
//  ⚠️ ต้องรัน API ไว้ที่ :5081 ก่อน
//     source scripts/dev-env.sh && cd api && dotnet run
//     vite dev server จะ proxy /api ไปให้เอง
// ═══════════════════════════════════════════════════════════════════════════
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['list']],

  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    // เนื้อหาทั้งระบบเป็นภาษาไทย — ตั้ง locale ให้ตรงกับผู้ใช้จริง
    locale: 'th-TH',
    timezoneId: 'Asia/Bangkok',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
