import { Navigate, type RouteObject } from 'react-router-dom'
import { RequireAuth } from '@/app/RequireAuth'
import { LoginPage } from '@/page/LoginPage'
import { WorkspacePage } from '@/page/WorkspacePage'
import { SettingsPage } from '@/page/SettingsPage'
import { TrashPage } from '@/page/TrashPage'
import { HealthPage } from '@/page/HealthPage'

export const routes: RouteObject[] = [
  { path: '/login', element: <LoginPage /> },

  { path: '/', element: <RequireAuth><WorkspacePage /></RequireAuth> },
  { path: '/p/:pageId', element: <RequireAuth><WorkspacePage /></RequireAuth> },

  // หมวดอยู่ใน URL เพื่อให้ปุ่มย้อนกลับของเบราว์เซอร์ทำงานและส่งลิงก์ต่อได้
  { path: '/settings', element: <RequireAuth><SettingsPage /></RequireAuth> },
  { path: '/settings/:section', element: <RequireAuth><SettingsPage /></RequireAuth> },

  { path: '/trash', element: <RequireAuth><TrashPage /></RequireAuth> },

  // หน้าตรวจสุขภาพระบบจาก Phase 0 — ยังมีประโยชน์ตอน deploy
  { path: '/health', element: <HealthPage /> },

  { path: '*', element: <Navigate to="/" replace /> },
]
